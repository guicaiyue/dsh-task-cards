// 事件可重放：replay(journal) 必须等于卡快照（阶段 A 的一致性证据）。
//
// 用 24 张卡覆盖各条投递状态，逐张对比 replay 的 deliveryState 与 Store 快照。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Store } from '../../src/host/cards/store'
import { Journal } from '../../src/host/kernel/journal'
import { applyTransition } from '../../src/host/kernel/transition'
import { replay } from '../../src/shared/case'
import type { DeliveryState } from '../../src/shared/contract'

const CHAINS: Array<
  Array<{
    to: DeliveryState
    actor: 'user' | 'system' | 'scheduler' | 'verifier'
    authority: 'user' | 'system'
  }>
> = [
  [],
  [{ to: 'waiting', actor: 'user', authority: 'user' }],
  [
    { to: 'waiting', actor: 'user', authority: 'user' },
    { to: 'leased', actor: 'scheduler', authority: 'system' },
  ],
  [
    { to: 'waiting', actor: 'user', authority: 'user' },
    { to: 'leased', actor: 'scheduler', authority: 'system' },
    { to: 'dispatched', actor: 'scheduler', authority: 'system' },
  ],
  [
    { to: 'waiting', actor: 'user', authority: 'user' },
    { to: 'leased', actor: 'scheduler', authority: 'system' },
    { to: 'dispatched', actor: 'scheduler', authority: 'system' },
    { to: 'executed', actor: 'system', authority: 'system' },
  ],
  [
    { to: 'waiting', actor: 'user', authority: 'user' },
    { to: 'leased', actor: 'scheduler', authority: 'system' },
    { to: 'dispatched', actor: 'scheduler', authority: 'system' },
    { to: 'executed', actor: 'system', authority: 'system' },
    { to: 'verifying', actor: 'verifier', authority: 'system' },
    { to: 'confirmed', actor: 'system', authority: 'system' },
  ],
  [
    { to: 'waiting', actor: 'user', authority: 'user' },
    { to: 'leased', actor: 'scheduler', authority: 'system' },
    { to: 'dispatched', actor: 'scheduler', authority: 'system' },
    { to: 'executed', actor: 'system', authority: 'system' },
    { to: 'verifying', actor: 'verifier', authority: 'system' },
    { to: 'failed', actor: 'system', authority: 'system' },
  ],
]

describe('事件重放一致性', () => {
  it('24 张卡：replay(journal) 的 deliveryState 与卡快照逐张一致', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-replay-'))
    const cards = new Store(path.join(dir, 'cards.json'))
    const journal = new Journal(path.join(dir, 'journal'))

    const created: Array<{ id: string; chain: (typeof CHAINS)[number] }> = []
    for (let index = 0; index < 24; index += 1) {
      const chain = CHAINS[index % CHAINS.length] as (typeof CHAINS)[number]
      const card = await cards.create(`重放用例 ${index}`, {
        kind: 'decision',
        origin: { sessionId: `s-${index % 4}` },
      })
      created.push({ id: card.id, chain })
    }

    for (const { id, chain } of created) {
      for (const step of chain) {
        await applyTransition(
          { cards, journal },
          {
            cardId: id,
            to: step.to,
            actor: step.actor,
            authority: step.authority,
            reason: `replay-test → ${step.to}`,
            expectedSeq: cards.find(id)?.decisionSeq ?? 0,
          },
        )
      }
    }

    let compared = 0
    for (const { id } of created) {
      const snapshot = cards.find(id)
      const { events, badLines } = await journal.read(id)
      expect(badLines).toBe(0)
      const replayed = replay(events)
      expect(replayed.deliveryState).toBe(snapshot?.deliveryState ?? 'idle')
      expect(replayed.revisions).toBe(events.length)
      for (const event of events) expect(event.traceId).toBeTruthy()
      // 状态链连续性：每条 from 必须等于上一条 to；迁移事件（meta.migration）显式放行。
      let previous = 'idle' as DeliveryState
      for (const event of events) {
        if (!event.meta?.migration) expect(event.from).toBe(previous)
        previous = event.to
      }
      expect(previous).toBe(snapshot?.deliveryState ?? 'idle')
      compared += 1
    }
    expect(compared).toBe(24)
  })

  it('历史事件 traceId 为空 → 读取时补 migrate-<id>，仍可重放', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-replay-legacy-'))
    const journal = new Journal(path.join(dir, 'journal'))
    await fs.promises.mkdir(path.join(dir, 'journal'), { recursive: true })
    const legacy = {
      id: 'e-legacy-1',
      caseId: 'c-legacy',
      at: 1,
      phase: 'decide',
      from: 'idle',
      to: 'waiting',
      actor: 'user',
      authority: 'user',
      reason: '旧事件（无 traceId）',
      evidenceRefs: [],
      policyVersion: 3,
    }
    await fs.promises.appendFile(
      path.join(dir, 'journal', 'c-legacy.jsonl'),
      `${JSON.stringify(legacy)}\n`,
      'utf8',
    )
    const { events, badLines } = await journal.read('c-legacy')
    expect(badLines).toBe(0)
    expect(events[0]?.traceId).toBe('migrate-e-legacy-1')
    expect(replay(events).deliveryState).toBe('waiting')
  })
})
