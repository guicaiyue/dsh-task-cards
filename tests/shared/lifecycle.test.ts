// 生命周期单一真源：投递状态 → status 的映射，以及面板侧的派生判定。
//
// 这组用例锁住事故的形状：status=open + deliveryState=unknown/confirmed 的旧卡
// 不能再被面板当成「等我处理」。

import { describe, expect, it } from 'vitest'

import { statusForDelivery } from '../../src/shared/case'
import { DELIVERY_STATES, type DeliveryState } from '../../src/shared/contract'
import {
  type CardOrder,
  effectiveStatus,
  groupCards,
  isCardClosed,
  laneOf,
  sortCards,
} from '../../src/shared/state'

interface Fixture extends CardOrder {
  status: CardOrder['status']
  deliveryState?: DeliveryState
}

function lifecycleCard(overrides: Partial<Fixture> = {}): Fixture {
  return {
    kind: 'decision',
    status: 'open',
    severity: 'normal',
    createdAt: 1,
    ...overrides,
  }
}

describe('投递状态 → status 映射', () => {
  it('执行链路内的状态一律收成 done，失效收成 dismissed，idle 不约束', () => {
    expect(statusForDelivery('idle')).toBeNull()
    for (const state of DELIVERY_STATES) {
      const expected = state === 'idle' ? null : state === 'invalidated' ? 'dismissed' : 'done'
      expect(statusForDelivery(state)).toBe(expected)
    }
  })
})

describe('面板侧派生判定', () => {
  it('status=open + deliveryState=unknown：status 派生是 done，但属于需关注、不算已结束', () => {
    const card = lifecycleCard({ status: 'open', deliveryState: 'unknown' })
    expect(effectiveStatus(card)).toBe('done')
    expect(laneOf(card)).toBe('attention')
    expect(isCardClosed(card)).toBe(false)
  })

  it('status=open + deliveryState=confirmed：才算已结束', () => {
    expect(isCardClosed(lifecycleCard({ status: 'open', deliveryState: 'confirmed' }))).toBe(true)
  })

  it('failed 同样不算已结束（R4：失败不进已结束）', () => {
    const failed = lifecycleCard({ status: 'done', deliveryState: 'failed' })
    expect(isCardClosed(failed)).toBe(false)
    expect(laneOf(failed)).toBe('attention')
  })

  it('idle 卡保留人自己写的 status（dismissed 不会被映射洗白）', () => {
    expect(effectiveStatus(lifecycleCard({ status: 'dismissed' }))).toBe('dismissed')
    expect(isCardClosed(lifecycleCard({ status: 'dismissed' }))).toBe(true)
    expect(isCardClosed(lifecycleCard({ status: 'open' }))).toBe(false)
  })

  it('laneOf：执行中/失败/确认 各归各道，失败不算已结束', () => {
    expect(laneOf(lifecycleCard({ status: 'open', deliveryState: 'idle' }))).toBe('decision')
    expect(laneOf(lifecycleCard({ status: 'done', deliveryState: 'waiting' }))).toBe('running')
    expect(laneOf(lifecycleCard({ status: 'done', deliveryState: 'failed' }))).toBe('attention')
    expect(laneOf(lifecycleCard({ status: 'done', deliveryState: 'unknown' }))).toBe('attention')
    expect(laneOf(lifecycleCard({ status: 'done', deliveryState: 'confirmed' }))).toBe('closed')
    expect(laneOf(lifecycleCard({ status: 'dismissed' }))).toBe('closed')
  })

  it('分组与排序用同一套车道：已进执行链路的卡不再占「要我决策」', () => {
    const cards = [
      lifecycleCard({ kind: 'decision', status: 'open', deliveryState: 'waiting' }),
      lifecycleCard({ kind: 'decision', status: 'open', deliveryState: 'idle' }),
      lifecycleCard({ kind: 'decision', status: 'done', deliveryState: 'failed' }),
    ]
    const groups = groupCards(cards)
    expect(groups.decision).toHaveLength(1)
    expect(groups.decision[0]?.deliveryState).toBe('idle')
    expect(groups.running).toHaveLength(1)
    expect(groups.attention).toHaveLength(1)
    expect(groups.closed).toHaveLength(0)
    expect(sortCards(cards)[0]?.deliveryState).toBe('idle')
  })
})
