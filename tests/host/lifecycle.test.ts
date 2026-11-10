// 生命周期在宿主机上的行为：迁移里 status 与 deliveryState 一起写；旧漂移数据被纠正。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { Store } from '../../src/host/cards/store'
import { repairLifecycleDrift } from '../../src/host/kernel/drift'
import { Journal } from '../../src/host/kernel/journal'
import { applyTransition, type TransitionDeps } from '../../src/host/kernel/transition'
import { isCandidate } from '../../src/host/scheduler/queue'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-lifecycle-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const journal = new Journal(path.join(dir, 'journal'))
  let seq = 0
  const deps: TransitionDeps = {
    cards,
    journal,
    now: () => 1_700_000_000_000 + seq,
    nextId: () => `e-${++seq}`,
  }
  return { cards, journal, deps }
}

async function seed(cards: Store, title = '跑测试并提交') {
  return cards.create(title, { kind: 'decision', source: 'agent', origin: { sessionId: 's-1' } })
}

async function move(deps: TransitionDeps, cardId: string, to: 'waiting' | 'invalidated' | 'idle') {
  return applyTransition(deps, {
    cardId,
    to,
    actor: to === 'invalidated' ? 'system' : 'scheduler',
    authority: 'system',
    reason: `测试迁移 → ${to}`,
  })
}

describe('transition 同时写 status（单一真源）', () => {
  it('入队 waiting：status 一次写到 done，不需要别处补票', async () => {
    const { cards, deps } = setup()
    const card = await seed(cards)
    expect(card.status).toBe('open')
    const out = await move(deps, card.id, 'waiting')
    expect(out.card.deliveryState).toBe('waiting')
    expect(out.card.status).toBe('done')
  })

  it('对账失效 invalidated：status 收成 dismissed', async () => {
    const { cards, deps } = setup()
    const card = await seed(cards)
    const out = await move(deps, card.id, 'invalidated')
    expect(out.card.status).toBe('dismissed')
    expect(out.card.invalidatedReason).toContain('测试迁移')
  })

  it('退回 idle：卡重新进入待处理（status 打开、失效原因清空）', async () => {
    const { cards, deps } = setup()
    const card = await seed(cards)
    await move(deps, card.id, 'waiting')
    const out = await move(deps, card.id, 'idle')
    expect(out.card.deliveryState).toBe('idle')
    expect(out.card.status).toBe('open')
    expect(out.card.invalidatedReason).toBeNull()
  })
})

describe('旧数据漂移修复', () => {
  it('status=open + deliveryState=unknown（事故残留）→ 纠正成 done', async () => {
    const { cards } = setup()
    const card = await seed(cards, '旧卡：失败卡没关')
    await cards.patch(card.id, { status: 'open', deliveryState: 'unknown' }, 'seed')
    const fixed = await repairLifecycleDrift({ cards })
    expect(fixed).toEqual([card.id])
    expect(cards.find(card.id)?.status).toBe('done')
  })

  it('acknowledged + waiting → done；scheduled（自动动作）不动', async () => {
    const { cards } = setup()
    const read = await seed(cards, '读过的卡')
    const scheduled = await seed(cards, '到点要跑的卡')
    await cards.patch(read.id, { status: 'acknowledged', deliveryState: 'waiting' }, 'seed')
    await cards.patch(scheduled.id, { status: 'scheduled', deliveryState: 'waiting' }, 'seed')
    const fixed = await repairLifecycleDrift({ cards })
    expect(fixed).toEqual([read.id])
    expect(cards.find(scheduled.id)?.status).toBe('scheduled')
  })

  it('幂等：再跑一次没有可改的', async () => {
    const { cards } = setup()
    const card = await seed(cards)
    await cards.patch(card.id, { deliveryState: 'confirmed' }, 'seed')
    await repairLifecycleDrift({ cards })
    expect(await repairLifecycleDrift({ cards })).toEqual([])
  })
})

describe('调度候选的不变量：只有 waiting + done 才派发', () => {
  function candidate(deliveryState: string, status: string) {
    return {
      deliveryState,
      status,
    } as unknown as Parameters<typeof isCandidate>[0]
  }

  it('waiting + done 才进就绪集', () => {
    expect(isCandidate(candidate('waiting', 'done'))).toBe(true)
  })

  it('旧数据里 acknowledged / open 的 waiting 卡不派发（等漂移修复或人来处理）', () => {
    expect(isCandidate(candidate('waiting', 'acknowledged'))).toBe(false)
    expect(isCandidate(candidate('waiting', 'open'))).toBe(false)
  })

  it('被人忽略（dismissed）的 waiting 卡不派发', () => {
    expect(isCandidate(candidate('waiting', 'dismissed'))).toBe(false)
  })

  it('idle/scheduled 等其他投递状态不派发', () => {
    expect(isCandidate(candidate('idle', 'done'))).toBe(false)
    expect(isCandidate(candidate('scheduled', 'done'))).toBe(false)
  })
})
