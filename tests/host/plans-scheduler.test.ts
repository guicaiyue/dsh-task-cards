// 阶段 C：plans.json 是投递账（lease/attempt/priority/dependsOn/idempotency/outcome）。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Store } from '../../src/host/cards/store'
import { Journal } from '../../src/host/kernel/journal'
import { PlansStore } from '../../src/host/plans/store'
import { idempotencyKeyOf, Scheduler } from '../../src/host/scheduler/scheduler'
import type { ApprovedPlan } from '../../src/shared/contract'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-plans-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const journal = new Journal(path.join(dir, 'journal'))
  const plans = new PlansStore(path.join(dir, 'plans.json'))
  const dispatched: string[] = []
  const logs: string[] = []
  const scheduler = new Scheduler({
    cards,
    journal,
    plans,
    getCards: () => cards.list(),
    adapter: {
      async execute(card: { id: string }) {
        dispatched.push(card.id)
        return { accepted: true, via: 'test' }
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
  })
  return { dir, cards, journal, plans, scheduler, dispatched, logs }
}

async function planOf(cardId: string, over: Partial<ApprovedPlan> = {}): Promise<ApprovedPlan> {
  return {
    id: `plan-${cardId}`,
    cardId,
    sessionId: 's-1',
    instruction: '做',
    effect: 'read',
    acceptance: [],
    executionMode: 'dispatch',
    priority: 0,
    dependsOn: [],
    idempotencyKey: `plan:${cardId}`,
    lease: null,
    attempts: [],
    cancelled: false,
    failed: false,
    ...over,
  }
}

async function waitingCard(cards: Store, journal: Journal) {
  const card = await cards.create('待派发', { kind: 'decision', origin: { sessionId: 's-1' } })
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
  return card
}

describe('计划账本驱动的调度', () => {
  it('重复 dispatch=0：attempt 已在 plans.json（幂等键跨实例有效）', async () => {
    const env = setup()
    const card = await waitingCard(env.cards, env.journal)
    const key = idempotencyKeyOf(card.id, `e-waiting-${card.id}`)
    await env.plans.upsert(
      await planOf(card.id, {
        attempts: [{ id: key, at: 1, sessionId: 's-1', result: 'dispatched', detail: '' }],
      }),
    )

    await env.scheduler.tick()

    // 重启：新 Scheduler 实例 + 新的 PlansStore 读同一文件
    await env.scheduler.tick()
    const restarted = new Scheduler({
      cards: env.cards,
      journal: env.journal,
      plans: new PlansStore(path.join(env.dir, 'plans.json')),
      getCards: () => env.cards.list(),
      adapter: {
        async execute() {
          env.dispatched.push('X')
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
    await restarted.tick()
    expect(env.dispatched).toHaveLength(0)
  })

  it('依赖未完成 → 不派发且 waitReason=depends-on；环依赖同样拒绝', async () => {
    const env = setup()
    const a = await waitingCard(env.cards, env.journal)
    const b = await waitingCard(env.cards, env.journal)
    await env.plans.upsert(await planOf(a.id, { dependsOn: ['plan-b'] }))
    await env.plans.upsert(await planOf(b.id, { id: 'plan-b', dependsOn: [`plan-${a.id}`] }))

    await env.scheduler.tick()
    expect(env.dispatched).toHaveLength(0)
    expect(env.cards.find(a.id)?.waitReason).toBe('depends-on')
    expect(env.cards.find(b.id)?.waitReason).toBe('depends-on')
  })

  it('卡死>5min=0：过期租约回收为 waiting（lease-expired），租约清空', async () => {
    const env = setup()
    const blocked = new Scheduler({
      cards: env.cards,
      journal: env.journal,
      plans: env.plans,
      getCards: () => env.cards.list(),
      adapter: {
        async execute() {
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
        decide: () => ({ ok: false, reason: 'queued' }),
      } as never,
      receipt: { currentTurn: () => 1, track: () => undefined },
    })
    const card = await waitingCard(env.cards, env.journal)
    await env.cards.patch(card.id, { deliveryState: 'leased', status: 'done' }, 'test')
    const plan = await planOf(card.id)
    await env.plans.upsert({
      ...plan,
      // 租约已过期 6s（> SKEW 5s）：单 TTL 语义下应立即回收，不等 90s。
      lease: { holder: card.id, acquiredAt: Date.now() - 96_000, expiresAt: Date.now() - 6_000 },
    })
    await blocked.tick()
    expect(env.cards.find(card.id)?.deliveryState).toBe('waiting')
    expect(env.plans.get(plan.id)?.lease).toBeNull()
  })

  it('priority=urgent 只排本轮队首；同优先级 FIFO', async () => {
    const env = setup()
    const created: string[] = []
    for (const title of ['普通1', '普通2', '紧急']) {
      const card = await waitingCard(env.cards, env.journal)
      await env.cards.patch(card.id, { title }, 'test')
      await env.plans.upsert(await planOf(card.id, { priority: title === '紧急' ? 1 : 0 }))
      created.push(card.id)
    }
    // 先放一张占住 WIP（否则会连派）——用同一会话来制造 wip 等待不成立，改为直接观察顺序：
    // 通过每轮 tick 只派一张（WIP=1）验证顺序：第一张必须是 urgent。
    await env.scheduler.tick()
    expect(env.dispatched[0]).toBe(created[2])
    // 后面两张按 FIFO（普通1 先于 普通2）
    await env.scheduler.tick()
    expect(env.dispatched[1]).toBe(created[0])
  })

  it('并发调用 tick 同一次派发只发生一次（#running 串行）', async () => {
    const env = setup()
    await waitingCard(env.cards, env.journal)
    await Promise.all([env.scheduler.tick(), env.scheduler.tick(), env.scheduler.tick()])
    expect(env.dispatched).toHaveLength(1)
  })

  it('旧形状 plan（缺 attempts/dependsOn/acceptance）→ tick 不抛错并按缺省语义派发', async () => {
    const env = setup()
    const card = await waitingCard(env.cards, env.journal)
    const legacy = {
      id: `plan-${card.id}`,
      cardId: card.id,
      sessionId: 's-1',
      instruction: '旧计划',
      effect: 'read',
      executionMode: 'dispatch',
      priority: 0,
      idempotencyKey: `plan:${card.id}`,
    }
    await env.plans.upsert(legacy as never)
    await expect(env.scheduler.tick()).resolves.toBeTruthy()
    expect(env.dispatched).toEqual([card.id])
  })

  it('plans.json 损坏自愈：截断/非法/空文件都能恢复为空账 + warning，并重新落盘', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-plans-bad-'))
    const file = path.join(dir, 'plans.json')
    for (const bad of ['{"plans":[', 'not json', '']) {
      fs.writeFileSync(file, bad, 'utf8')
      const store = new PlansStore(file)
      expect(store.list()).toEqual([])
      expect(store.warning).toBeTruthy()
      await store.ensureFile()
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ plans: [] })
    }
  })
})
