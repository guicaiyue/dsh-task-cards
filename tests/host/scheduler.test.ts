// 调度测试：WIP=1、非抢占、租约回收、派发失败退回、优先级排序。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Store } from '../../src/host/cards/store'
import type { ExecutionAdapter } from '../../src/host/execution/adapter'
import { Journal } from '../../src/host/kernel/journal'
import { applyTransition } from '../../src/host/kernel/transition'
import { Admission } from '../../src/host/scheduler/admission'
import { Scheduler } from '../../src/host/scheduler/scheduler'
import type { Card } from '../../src/shared/contract'

function setup(adapter: ExecutionAdapter) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-sched-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const journal = new Journal(path.join(dir, 'journal'))
  const deps = { cards, journal, now: () => 1_700_000_000_000 }
  let clock = 0
  const admission = new Admission({ now: () => clock, leaseTtlMs: 90_000 })
  const scheduler = new Scheduler({
    ...deps,
    getCards: () => cards.list(),
    adapter,
    log: () => {},
    admission,
  })
  return { cards, journal, deps, scheduler, admission, advance: (ms: number) => (clock += ms) }
}

async function seed(
  cards: Store,
  deps: { cards: Store; journal: Journal },
  title: string,
  over: { sessionId?: string; severity?: Card['severity'] } = {},
) {
  const card = await cards.create(title, {
    kind: 'decision',
    source: 'agent',
    origin: { sessionId: over.sessionId ?? 's-1', turn: 1 },
    severity: over.severity ?? 'normal',
  })
  await applyTransition(deps, {
    cardId: card.id,
    to: 'waiting',
    actor: 'scheduler',
    authority: 'user',
    reason: '入队',
    waitReason: 'queued',
  })
  return cards.find(card.id) as Card
}

function okAdapter(calls: string[]): ExecutionAdapter {
  return {
    kind: 'session',
    async execute(card) {
      calls.push(card.id)
      return { accepted: true, via: 'agent' }
    },
  }
}

describe('调度准入', () => {
  it('WIP=1：同会话只派一张，第二张被在飞卡挡住', async () => {
    const calls: string[] = []
    const { cards, deps, scheduler } = setup(okAdapter(calls))
    const first = await seed(cards, deps, '第一张')
    const second = await seed(cards, deps, '第二张')

    const tick = await scheduler.tick()
    expect(tick.dispatched).toEqual([first.id])
    // 同 tick 内第一张已 dispatched，所以第二张的等待原因是「等回执」；
    // wip-limit 出现在同会话有 leased 卡时（下一个用例）。
    expect(tick.waiting).toEqual([{ id: second.id, reason: 'awaiting-receipt' }])
    expect(calls).toEqual([first.id])
  })

  it('WIP=1：同会话已有 leased 卡时给 wip-limit', async () => {
    const calls: string[] = []
    const { cards, deps, scheduler, admission } = setup(okAdapter(calls))
    const leased = await seed(cards, deps, '租约中的')
    await applyTransition(deps, {
      cardId: leased.id,
      to: 'leased',
      actor: 'scheduler',
      authority: 'system',
      reason: '已落租约',
    })
    admission.reserve(leased.id) // 租约还新鲜：不该被回收
    const waiting = await seed(cards, deps, '排队的')

    const tick = await scheduler.tick()
    expect(tick.expired).toEqual([])
    expect(tick.waiting).toEqual([{ id: waiting.id, reason: 'wip-limit' }])
    expect(calls).toEqual([])
  })

  it('非抢占：已派发的卡挡住同会话新卡（awaiting-receipt）', async () => {
    const calls: string[] = []
    const { cards, deps, scheduler } = setup(okAdapter(calls))
    await seed(cards, deps, '已派发')
    await scheduler.tick()
    const late = await seed(cards, deps, '后到的')

    const tick = await scheduler.tick()
    expect(tick.dispatched).toEqual([])
    expect(tick.waiting).toEqual([{ id: late.id, reason: 'awaiting-receipt' }])
  })

  it('不同会话可以并行各派一张', async () => {
    const calls: string[] = []
    const { cards, deps, scheduler } = setup(okAdapter(calls))
    await seed(cards, deps, 'A', { sessionId: 's-a' })
    await seed(cards, deps, 'B', { sessionId: 's-b' })
    const tick = await scheduler.tick()
    expect(tick.dispatched).toHaveLength(2)
  })

  it('租约过期：重启后无记录的 leased 卡被回收为 waiting', async () => {
    const calls: string[] = []
    const { cards, deps, scheduler } = setup(okAdapter(calls))
    const card = await seed(cards, deps, '卡住的')
    await applyTransition(deps, {
      cardId: card.id,
      to: 'leased',
      actor: 'scheduler',
      authority: 'system',
      reason: '上次派的',
    })
    const tick = await scheduler.tick()
    expect(tick.expired).toEqual([card.id])
    // 回收后同一 tick 会重新准入：最终应当又被派出去（而不是卡在 waiting）。
    expect(tick.dispatched).toContain(card.id)
    expect(cards.find(card.id)?.deliveryState).toBe('dispatched')
  })

  it('派发失败退回 waiting，并标记 retrying', async () => {
    const failing: ExecutionAdapter = {
      kind: 'session',
      async execute() {
        return { accepted: false, error: 'session dead' }
      },
    }
    const { cards, deps, scheduler } = setup(failing)
    const card = await seed(cards, deps, '会失败')
    const tick = await scheduler.tick()
    expect(tick.dispatched).toEqual([])
    const after = cards.find(card.id)
    expect(after?.deliveryState).toBe('waiting')
    expect(after?.waitReason).toBe('retrying')
  })

  it('派发成功只落 dispatched：不落 executed、不触发验收（等回执）', async () => {
    const calls: string[] = []
    const { cards, journal, deps, admission } = setup(okAdapter(calls))
    const tracked: Array<{ cardId: string; sessionId: string; turn: number }> = []
    const scheduler = new Scheduler({
      ...deps,
      getCards: () => cards.list(),
      adapter: okAdapter(calls),
      log: () => {},
      admission,
      receipt: {
        currentTurn: () => 7,
        track: (cardId, sessionId, turn) => tracked.push({ cardId, sessionId, turn }),
      },
    })
    const card = await seed(cards, deps, '等回执')
    const tick = await scheduler.tick()
    expect(tick.dispatched).toEqual([card.id])
    expect(cards.find(card.id)?.deliveryState).toBe('dispatched')
    expect(cards.find(card.id)?.waitReason).toBe('awaiting-receipt')
    // 派发回合号随 dispatched 事件落盘，回执恢复靠它
    const { events } = await journal.read(card.id)
    const dispatched = events.filter((event) => event.to === 'dispatched').pop()
    expect((dispatched?.meta as { turn?: number })?.turn).toBe(7)
    expect(events.some((event) => event.to === 'executed')).toBe(false)
    expect(tracked).toEqual([{ cardId: card.id, sessionId: 's-1', turn: 7 }])
  })

  it('同一幂等键只派一次：回到 waiting 但 seq 不变时，第二次 tick 不再投递', async () => {
    const calls: string[] = []
    const { cards, journal, deps, scheduler } = setup(okAdapter(calls))
    const card = await seed(cards, deps, '只该派一次')
    await scheduler.tick()
    expect(calls).toEqual([card.id])
    const { events } = await journal.read(card.id)
    const waiting = events.filter((event) => event.to === 'waiting').pop()
    const dispatched = events.filter((event) => event.to === 'dispatched').pop()
    expect((dispatched?.meta as { idempotencyKey?: string })?.idempotencyKey).toBe(
      `${card.id}:${waiting?.id}`,
    )
    // 模拟「崩溃恢复/手工回写」：状态回到 waiting，但决定序号没变 → 同一个幂等键
    await cards.patch(card.id, { deliveryState: 'waiting' }, 'test-reset')
    const tick = await scheduler.tick()
    expect(tick.dispatched).toEqual([])
    expect(calls).toEqual([card.id])
  })

  it('优先级：severity=high 先派', async () => {
    const calls: string[] = []
    const { cards, deps, scheduler } = setup(okAdapter(calls))
    await seed(cards, deps, '普通卡', { sessionId: 's-1' })
    const high = await seed(cards, deps, '高优先', { sessionId: 's-2', severity: 'high' })
    const tick = await scheduler.tick()
    expect(tick.dispatched[0]).toBe(high.id)
  })
})
