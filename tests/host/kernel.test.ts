// 内核测试：CAS、状态机拒绝、事件先落盘、replay 与快照一致。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { Store } from '../../src/host/cards/store'
import { Journal } from '../../src/host/kernel/journal'
import { migrateCards } from '../../src/host/kernel/migrate'
import { applyTransition, newTraceId } from '../../src/host/kernel/transition'
import { replay } from '../../src/shared/case'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-kernel-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const journal = new Journal(path.join(dir, 'journal'))
  let seq = 0
  const deps = {
    cards,
    journal,
    now: () => 1_700_000_000_000 + seq,
    nextId: () => `e-${++seq}`,
  }
  return { dir, cards, journal, deps }
}

async function seed(cards: Store) {
  return cards.create('跑测试并提交 feat/scheduler 分支', {
    kind: 'decision',
    source: 'agent',
    origin: { sessionId: 's-7d31', turn: 2 },
  })
}

describe('内核迁移', () => {
  it('合法迁移：事件先落盘，卡快照同步前进，decisionSeq 递增', async () => {
    const { cards, journal, deps } = setup()
    const card = await seed(cards)
    const out = await applyTransition(deps, {
      cardId: card.id,
      to: 'waiting',
      actor: 'scheduler',
      authority: 'system',
      reason: '计划入队',
      waitReason: 'awaiting-decision',
    })
    expect(out.card.deliveryState).toBe('waiting')
    expect(out.card.decisionSeq).toBe(1)
    expect(out.card.waitReason).toBe('awaiting-decision')
    expect(out.event.phase).toBe('decide')

    const { events, badLines } = await journal.read(card.id)
    expect(badLines).toBe(0)
    expect(events).toHaveLength(1)
    expect(events[0]?.to).toBe('waiting')
    expect(replay(events).deliveryState).toBe('waiting')
  })

  it('CAS 不匹配直接 409，且不写事件、不改卡', async () => {
    const { cards, journal, deps } = setup()
    const card = await seed(cards)
    await expect(
      applyTransition(deps, {
        cardId: card.id,
        to: 'waiting',
        actor: 'scheduler',
        authority: 'system',
        reason: '过期票',
        expectedSeq: 5,
      }),
    ).rejects.toMatchObject({ code: 'CAS_CONFLICT' })

    expect((await journal.read(card.id)).events).toHaveLength(0)
    expect(cards.find(card.id)?.deliveryState).toBeUndefined()
  })

  it('状态与预期不符也 409（两个标签页同时点批准）', async () => {
    const { cards, deps } = setup()
    const card = await seed(cards)
    await applyTransition(deps, {
      cardId: card.id,
      to: 'waiting',
      actor: 'scheduler',
      authority: 'system',
      reason: '入队',
    })
    await expect(
      applyTransition(deps, {
        cardId: card.id,
        to: 'leased',
        actor: 'scheduler',
        authority: 'system',
        reason: '第二次点',
        expectedState: 'idle',
      }),
    ).rejects.toMatchObject({ code: 'CAS_CONFLICT' })
  })

  it('非法迁移与越权被状态机拒绝', async () => {
    const { cards, deps } = setup()
    const card = await seed(cards)
    await expect(
      applyTransition(deps, {
        cardId: card.id,
        to: 'confirmed',
        actor: 'system',
        authority: 'system',
        reason: '跳步',
      }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' })
  })

  it('对账失效走系统角色，写原因；用户可重开', async () => {
    const { cards, deps } = setup()
    const card = await seed(cards)
    const invalid = await applyTransition(deps, {
      cardId: card.id,
      to: 'invalidated',
      actor: 'system',
      authority: 'system',
      reason: '产物已存在（commit 9f2ac1）',
      evidenceRefs: ['git:9f2ac1'],
    })
    expect(invalid.card.deliveryState).toBe('invalidated')
    expect(invalid.card.invalidatedReason).toContain('commit 9f2ac1')

    const reopened = await applyTransition(deps, {
      cardId: card.id,
      to: 'idle',
      actor: 'user',
      authority: 'user',
      reason: '误判，重新打开',
    })
    expect(reopened.card.deliveryState).toBe('idle')
    expect(reopened.card.invalidatedReason).toBeNull()
  })

  it('replay 与快照一致：连续迁移后事件流能重建状态', async () => {
    const { cards, journal, deps } = setup()
    const card = await seed(cards)
    const steps: Array<{
      to: 'waiting' | 'leased' | 'dispatched' | 'executed'
      actor: 'scheduler' | 'executor'
    }> = [
      { to: 'waiting', actor: 'scheduler' },
      { to: 'leased', actor: 'scheduler' },
      { to: 'dispatched', actor: 'executor' },
      { to: 'executed', actor: 'executor' },
    ]
    for (const step of steps) {
      await applyTransition(deps, {
        cardId: card.id,
        to: step.to,
        actor: step.actor,
        authority: 'system',
        reason: step.to,
      })
    }
    const { events } = await journal.read(card.id)
    expect(replay(events).deliveryState).toBe(cards.find(card.id)?.deliveryState)
    expect(cards.find(card.id)?.decisionSeq).toBe(steps.length)
  })

  it('坏行被跳过，不影响其余事件', async () => {
    const { dir, cards, journal } = setup()
    const card = await seed(cards)
    fs.mkdirSync(path.join(dir, 'journal'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'journal', `${card.id}.jsonl`),
      `${JSON.stringify({
        id: 'e-legacy',
        caseId: card.id,
        at: 1,
        phase: 'decide',
        from: 'idle',
        to: 'waiting',
        actor: 'user',
        authority: 'user',
        reason: '旧事件（无 traceId）',
        evidenceRefs: [],
        policyVersion: 3,
      })}\nnot-json\n`,
      'utf8',
    )
    const { events, badLines } = await journal.read(card.id)
    expect(events).toHaveLength(1)
    expect(badLines).toBe(1)
  })

  it('traceId 可生成且稳定可辨', () => {
    const a = newTraceId(1_700_000_000_000, 0.5)
    const b = newTraceId(1_700_000_000_000, 0.5)
    expect(a).toMatch(/^tr-[a-z0-9]+$/)
    expect(a).toBe(b)
    expect(newTraceId(1_700_000_000_001, 0.5)).not.toBe(a)
  })
})

describe('旧卡迁移', () => {
  it('补 traceId 与投递状态，done → confirmed，幂等', async () => {
    const { cards, journal, deps } = setup()
    const open = await cards.create('要我拍板', { kind: 'decision', source: 'agent' })
    const done = await cards.create('归档发布说明')
    await cards.patch(done.id, { status: 'done' }, 'completed')

    const first = await migrateCards(deps)
    expect(first.migrated.sort()).toEqual([open.id, done.id].sort())
    expect(first.backup).toBeTruthy()

    const migratedOpen = cards.find(open.id)
    expect(migratedOpen?.traceId).toMatch(/^tr-/)
    expect(migratedOpen?.deliveryState).toBe('idle')
    expect(cards.find(done.id)?.deliveryState).toBe('confirmed')

    const second = await migrateCards(deps)
    expect(second.migrated).toHaveLength(0)
    expect(second.skipped).toBe(2)

    const { events } = await journal.read(open.id)
    expect(events[0]?.reason).toContain('migrate')
    expect(events[0]?.meta).toMatchObject({ migration: true })
  })
})
