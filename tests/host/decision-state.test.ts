// 阶段 A：决定状态机写入路径（新建卡 / 迁移旧卡 / reopen）+ 三个派生点一致。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Store } from '../../src/host/cards/store'
import { Journal } from '../../src/host/kernel/journal'
import { migrateDecisions } from '../../src/host/kernel/migrate'
import { applyTransition } from '../../src/host/kernel/transition'
import type { Card } from '../../src/shared/contract'
import { deriveDecision, statusOfDecision } from '../../src/shared/decision-state'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-decision-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const journal = new Journal(path.join(dir, 'journal'))
  const apply = (req: Parameters<typeof applyTransition>[1]) =>
    applyTransition({ cards, journal }, req)
  return { dir, cards, journal, apply }
}

describe('决定状态机写入路径', () => {
  it('新建卡落 decision；投递推进后同步更新（等待→批准→关闭）', async () => {
    const { cards, apply } = setup()
    const card = await cards.create('决定卡', { kind: 'decision', origin: { sessionId: 's-1' } })
    expect(cards.find(card.id)?.decision).toBe('pending_secretary')

    await apply({
      cardId: card.id,
      to: 'waiting',
      actor: 'user',
      authority: 'user',
      reason: 'test',
      expectedSeq: cards.find(card.id)?.decisionSeq ?? 0,
    })
    expect(cards.find(card.id)?.decision).toBe('pending_secretary')

    await apply({
      cardId: card.id,
      to: 'leased',
      actor: 'scheduler',
      authority: 'system',
      reason: 'test',
      expectedSeq: cards.find(card.id)?.decisionSeq ?? 0,
    })
    expect(cards.find(card.id)?.decision).toBe('approved')

    for (const step of [
      { to: 'dispatched' as const, actor: 'scheduler' as const },
      { to: 'executed' as const, actor: 'system' as const },
      { to: 'verifying' as const, actor: 'verifier' as const },
      { to: 'failed' as const, actor: 'system' as const },
    ]) {
      await apply({
        cardId: card.id,
        to: step.to,
        actor: step.actor,
        authority: 'system',
        reason: 'test',
        expectedSeq: cards.find(card.id)?.decisionSeq ?? 0,
      })
    }
    expect(cards.find(card.id)?.decision).toBe('closed')
    // 面板读派生 status：closed → done，不回退
    expect(statusOfDecision('closed')).toBe('done')
  })

  it('迁移补齐旧卡 decision（幂等，不改 status/语义）', async () => {
    const { cards } = setup()
    const created = await cards.create('旧卡', { kind: 'decision' })
    // 模拟旧数据：直接抹掉 decision 字段
    const raw = JSON.parse(fs.readFileSync(cards.file, 'utf8')) as unknown
    const list = (Array.isArray(raw) ? raw : (raw as { cards: Card[] }).cards) as Card[]
    for (const item of list) delete (item as { decision?: unknown }).decision
    fs.writeFileSync(
      cards.file,
      JSON.stringify(Array.isArray(raw) ? list : { ...(raw as object), cards: list }),
      'utf8',
    )
    const legacy = new Store(cards.file)
    expect(legacy.find(created.id)?.decision).toBeUndefined()
    const result = await migrateDecisions({ cards: legacy })
    expect(result.filled).toBeGreaterThanOrEqual(1)
    expect(legacy.find(created.id)?.decision).toBe('pending_secretary')
    const again = await migrateDecisions({ cards: legacy })
    expect(again.filled).toBe(0)
  })

  it('已迁移数据（traceId/deliveryState 都有）+ 无 decision → 迁移仍 51/51 补齐（boot 门槛回归）', async () => {
    const { cards } = setup()
    // 造 51 张「已经迁过」的卡：traceId 与 deliveryState 都齐全，只缺 decision。
    const ids: string[] = []
    for (let i = 0; i < 51; i += 1) {
      const created = await cards.create(`旧卡 ${i}`, { kind: 'decision' })
      ids.push(created.id)
    }
    const raw = JSON.parse(fs.readFileSync(cards.file, 'utf8')) as unknown
    const list = (Array.isArray(raw) ? raw : (raw as { cards: Card[] }).cards) as Card[]
    for (const item of list) {
      delete (item as { decision?: unknown }).decision
      item.traceId = `tr-legacy-${item.id}`
      item.deliveryState = 'idle'
    }
    fs.writeFileSync(
      cards.file,
      JSON.stringify(Array.isArray(raw) ? list : { ...(raw as object), cards: list }),
      'utf8',
    )

    const legacy = new Store(cards.file)
    // 模拟 boot：先跑旧迁移（已迁移 → migrated=[]），再无条件跑 decision 迁移。
    const { migrateCards } = await import('../../src/host/kernel/migrate')
    const legacyJournal = new Journal(path.join(os.tmpdir(), 'dtc-dec-boot', 'journal'))
    const oldResult = await migrateCards({ cards: legacy, journal: legacyJournal })
    expect(oldResult.migrated).toHaveLength(0)
    const result = await migrateDecisions({ cards: legacy })
    expect(result.filled).toBe(51)
    const filled = legacy.list().filter((card) => card.decision).length
    expect(filled).toBe(51)
    for (const id of ids) expect(legacy.find(id)?.decision).toBeTruthy()
  })

  it('reopen（回到 idle）后 decision 重新推导，不残留 approved', async () => {
    const { cards, apply } = setup()
    const card = await cards.create('可重开', { kind: 'decision', origin: { sessionId: 's-1' } })
    await apply({
      cardId: card.id,
      to: 'waiting',
      actor: 'user',
      authority: 'user',
      reason: 'approve',
      expectedSeq: cards.find(card.id)?.decisionSeq ?? 0,
    })
    await apply({
      cardId: card.id,
      to: 'leased',
      actor: 'scheduler',
      authority: 'system',
      reason: 'run',
      expectedSeq: cards.find(card.id)?.decisionSeq ?? 0,
    })
    expect(cards.find(card.id)?.decision).toBe('approved')
    const reopened = new Store(cards.file)
    await reopened.patch(card.id, { status: 'open', deliveryState: 'idle' }, 'reopen')
    expect(reopened.find(card.id)?.decision).toBeTruthy()
    expect(deriveDecision(reopened.find(card.id) as Card)).not.toBe('closed')
  })
})
