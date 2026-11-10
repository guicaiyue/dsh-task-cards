// 阶段 E/G2：dependsOn 生产者——卡上依赖 → plan 依赖 → 按序派发；环/跨会话处理。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { Store } from '../../src/host/cards/store'
import { Journal } from '../../src/host/kernel/journal'
import { PlansStore } from '../../src/host/plans/store'
import { ensureApprovedPlan, resolvePlanDeps } from '../../src/host/routes/plan-create'
import { Scheduler } from '../../src/host/scheduler/scheduler'
import type { ApprovedPlan, Card } from '../../src/shared/contract'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-dep-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const journal = new Journal(path.join(dir, 'journal'))
  const plans = new PlansStore(path.join(dir, 'plans.json'))
  const logs: string[] = []
  const deps = {
    cards,
    journal,
    log: (line: string) => logs.push(line),
    kernel: { plans, journal },
  } as never
  return { dir, cards, journal, plans, deps, logs }
}

async function card(cards: Store, title: string, sessionId = 's-1', over: Partial<Card> = {}) {
  const created = await cards.create(title, { kind: 'decision', origin: { sessionId } })
  if (Object.keys(over).length) await cards.patch(created.id, over as never, 'test')
  return cards.find(created.id) as Card
}

async function approve(
  deps: { cards: Store; kernel: { plans: PlansStore } },
  c: Card,
  text = '做',
) {
  await ensureApprovedPlan(deps as never, c, text)
  return deps.kernel.plans.byCard(c.id) as ApprovedPlan
}

describe('dependsOn 生产者', () => {
  it('卡上 blockedBy / 票拟 dependsOn → plan.dependsOn（同会话）', async () => {
    const env = setup()
    const a = await card(env.cards, 'A')
    const planA = await approve(env.deps, a)
    const b = await card(env.cards, 'B', 's-1', { blockedBy: [a.id] } as never)
    const planB = await approve(env.deps, b)
    expect(planB.dependsOn).toEqual([planA.id])

    const c = await card(env.cards, 'C')
    await env.cards.patch(c.id, { advice: { dependsOn: [a.id] } as never }, 'test')
    const planC = await approve(env.deps, env.cards.find(c.id) as Card)
    expect(planC.dependsOn).toEqual([planA.id])
  })

  it('跨会话依赖被忽略并记日志', async () => {
    const env = setup()
    const other = await card(env.cards, '别的会话', 's-2')
    await approve(env.deps, other)
    const b = await card(env.cards, 'B', 's-1', { blockedBy: [other.id] } as never)
    const planB = await approve(env.deps, b)
    expect(planB.dependsOn).toEqual([])
    expect(env.logs.some((line) => line.includes('跨会话依赖'))).toBe(true)
  })

  it('环依赖被拒绝并记日志（A→B，再让 B→A）', async () => {
    const env = setup()
    const a = await card(env.cards, 'A')
    const b = await card(env.cards, 'B')
    // 先造 A 依赖 B 的既有 plan（手工 upsert 模拟历史），再批准 B 依赖 A → 成环。
    await env.plans.upsert({
      id: `plan-a`,
      cardId: a.id,
      sessionId: 's-1',
      instruction: '做',
      effect: 'read',
      acceptance: [],
      executionMode: 'dispatch',
      priority: 0,
      dependsOn: ['plan-b'],
      idempotencyKey: 'plan:plan-a',
      lease: null,
      attempts: [],
      cancelled: false,
      failed: false,
    } satisfies ApprovedPlan)
    await env.cards.patch(b.id, { blockedBy: [a.id] } as never, 'test')
    const deps = resolvePlanDeps(env.deps as never, env.cards.find(b.id) as Card, 'plan-b')
    expect(deps).toEqual([])
    expect(env.logs.some((line) => line.includes('成环'))).toBe(true)
  })

  it('3 卡链 A→B→C：plan 依赖下按序派发', async () => {
    const env = setup()
    const cardsOrder: string[] = []
    const a = await card(env.cards, 'A')
    const b = await card(env.cards, 'B')
    const c = await card(env.cards, 'C')
    for (const item of [a, b, c])
      await env.cards.patch(item.id, { deliveryState: 'waiting', status: 'done' }, 'test')
    const planA = {
      id: `plan-${a.id}`,
      cardId: a.id,
      sessionId: 's-1',
      instruction: 'A',
      effect: 'read',
      acceptance: [],
      executionMode: 'dispatch',
      priority: 0,
      dependsOn: [],
      idempotencyKey: `plan:${a.id}`,
      lease: null,
      attempts: [],
      cancelled: false,
      failed: false,
    } satisfies ApprovedPlan
    const planB = {
      ...planA,
      id: `plan-${b.id}`,
      cardId: b.id,
      instruction: 'B',
      idempotencyKey: `plan:${b.id}`,
      dependsOn: [planA.id],
    } satisfies ApprovedPlan
    const planC = {
      ...planA,
      id: `plan-${c.id}`,
      cardId: c.id,
      instruction: 'C',
      idempotencyKey: `plan:${c.id}`,
      dependsOn: [planB.id],
    } satisfies ApprovedPlan
    for (const plan of [planA, planB, planC]) await env.plans.upsert(plan)

    const scheduler = new Scheduler({
      cards: env.cards,
      journal: env.journal,
      plans: env.plans,
      getCards: () => env.cards.list(),
      adapter: {
        async execute(card: Card) {
          cardsOrder.push(card.title)
          return { accepted: true, via: 'test' }
        },
      } as never,
      log: () => undefined,
      admission: {
        wipLimit: 1,
        leaseTtlMs: 90_000,
        reserve() {},
        release() {},
        expired: () => [],
        decide: () => ({ ok: true }),
      } as never,
      receipt: { currentTurn: () => 1, track: () => undefined },
    })

    await scheduler.tick()
    expect(cardsOrder).toEqual(['A'])
    expect(env.cards.find(b.id)?.waitReason).toBe('depends-on')

    // A 完成 → B 可派
    await env.plans.recordOutcome({
      planId: planA.id,
      verified: 'confirmed',
      criteriaResults: [],
      verifier: 'machine',
      confidence: 1,
      at: Date.now(),
    } as never)
    await env.cards.patch(a.id, { deliveryState: 'confirmed' }, 'test')
    await scheduler.tick()
    expect(cardsOrder).toEqual(['A', 'B'])

    await env.plans.recordOutcome({
      planId: planB.id,
      verified: 'confirmed',
      criteriaResults: [],
      verifier: 'machine',
      confidence: 1,
      at: Date.now(),
    } as never)
    await env.cards.patch(b.id, { deliveryState: 'confirmed' }, 'test')
    await scheduler.tick()
    expect(cardsOrder).toEqual(['A', 'B', 'C'])
  })
})
