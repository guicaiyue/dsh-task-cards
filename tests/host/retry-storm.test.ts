// 重试风暴（真机 P0）：attempts 上限 3 + 退避 + 永久失败不重试 + 删卡取消 plan。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { Store } from '../../src/host/cards/store'
import { Journal } from '../../src/host/kernel/journal'
import { PlansStore } from '../../src/host/plans/store'
import { Scheduler } from '../../src/host/scheduler/scheduler'
import type { ApprovedPlan } from '../../src/shared/contract'

interface Clock {
  t: number
}

function setup(clock: Clock) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-storm-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const journal = new Journal(path.join(dir, 'journal'))
  const plans = new PlansStore(path.join(dir, 'plans.json'))
  let calls = 0
  const outcomes: string[] = []
  const logs: string[] = []
  const schedulerWith = (execute: () => Promise<unknown>) =>
    new Scheduler({
      cards,
      journal,
      plans,
      getCards: () => cards.list(),
      adapter: {
        async execute() {
          calls += 1
          outcomes.push('called')
          return execute()
        },
      } as never,
      log: (line: string) => logs.push(line),
      admission: {
        wipLimit: 1,
        leaseTtlMs: 90_000,
        reserve() {},
        release() {},
        expired: () => [],
        decide: () => ({ ok: true }),
      } as never,
      receipt: { currentTurn: () => 1, track: () => undefined },
      now: () => clock.t,
    })
  return { dir, cards, journal, plans, schedulerWith, calls: () => calls, logs }
}

async function seed(cards: Store, journal: Journal, plans: PlansStore) {
  const card = await cards.create('会失败的卡', { kind: 'decision', origin: { sessionId: 's-1' } })
  await cards.patch(card.id, { deliveryState: 'waiting', status: 'done' }, 'test')
  await journal.append({
    id: `e-waiting-${card.id}`,
    caseId: card.id,
    traceId: 'tr-test',
    at: 1,
    phase: 'decide',
    from: 'idle',
    to: 'waiting',
    actor: 'user',
    authority: 'user',
    reason: 'test',
    evidenceRefs: [],
    policyVersion: 3,
  })
  await plans.upsert({
    id: `plan-${card.id}`,
    cardId: card.id,
    sessionId: 's-1',
    instruction: '做',
    effect: 'read',
    acceptance: [],
    executionMode: 'dispatch',
    priority: 0,
    dependsOn: [],
    idempotencyKey: `plan:${card.id}`,
    lease: null,
    attempts: [],
    cancelled: false,
    failed: false,
  } satisfies ApprovedPlan)
  return card
}

describe('重试风暴（P0）', () => {
  it('永久失败（会话不可恢复）：attempt 落盘 1 次即停、升级人工', async () => {
    const clock = { t: 1_000 }
    const env = setup(clock)
    const card = await seed(env.cards, env.journal, env.plans)
    const scheduler = env.schedulerWith(async () => ({
      accepted: false,
      permanent: true,
      error: '目标会话无法恢复为 agent（Cannot read properties of undefined）',
    }))
    await scheduler.tick()
    const plan = env.plans.byCard(card.id) as ApprovedPlan
    expect(plan.attempts.filter((a) => a.result === 'failed')).toHaveLength(1)
    expect(plan.failed).toBe(true)
    expect(env.cards.find(card.id)?.waitReason).toBe('retry-exhausted')
    expect(env.cards.list().some((item) => item.title.startsWith('执行失败'))).toBe(true)
    // 再 tick 20 次（推进时钟）不再调用适配器
    for (let i = 0; i < 20; i += 1) {
      clock.t += 10_000
      await scheduler.tick()
    }
    expect(env.calls()).toBe(1)
  })

  it('适配器抛 TypeError：干净失败、attempt 必落盘、按永久失败不重试', async () => {
    const clock = { t: 1_000 }
    const env = setup(clock)
    const card = await seed(env.cards, env.journal, env.plans)
    const scheduler = env.schedulerWith(async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'resolve')")
    })
    await expect(scheduler.tick()).resolves.toBeTruthy()
    const plan = env.plans.byCard(card.id) as ApprovedPlan
    expect(plan.attempts.filter((a) => a.result === 'failed')).toHaveLength(1)
    expect(plan.failed).toBe(true)
    expect(env.cards.find(card.id)?.waitReason).toBe('retry-exhausted')
    for (let i = 0; i < 10; i += 1) {
      clock.t += 10_000
      await scheduler.tick()
    }
    expect(env.calls()).toBe(1)
  })

  it('永失败适配器：最多 3 次 attempt（含退避），之后升级且停止', async () => {
    const clock = { t: 1_000 }
    const env = setup(clock)
    const card = await seed(env.cards, env.journal, env.plans)
    const scheduler = env.schedulerWith(async () => ({ accepted: false, error: '网络抖动' }))
    // 时间步长 10s：依次越过 2s/10s 两档退避，直到第 3 次失败停止
    for (let i = 0; i < 20; i += 1) {
      await scheduler.tick()
      clock.t += 10_000
    }
    const plan = env.plans.byCard(card.id) as ApprovedPlan
    expect(plan.attempts.filter((a) => a.result === 'failed').length).toBeLessThanOrEqual(3)
    expect(plan.failed).toBe(true)
    expect(env.cards.find(card.id)?.waitReason).toBe('retry-exhausted')
    expect(env.cards.list().some((item) => item.title.startsWith('执行失败'))).toBe(true)
  })

  it('卡已删除 → plan cancelled，不再派发', async () => {
    const clock = { t: 1_000 }
    const env = setup(clock)
    const card = await seed(env.cards, env.journal, env.plans)
    await env.cards.remove(card.id)
    const scheduler = env.schedulerWith(async () => ({ accepted: true, via: 'test' }))
    await scheduler.tick()
    const plan = env.plans.get(`plan-${card.id}`)
    expect(plan?.cancelled).toBe(true)
    expect(env.calls()).toBe(0)
  })
})
