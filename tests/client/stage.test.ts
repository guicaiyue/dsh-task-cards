// 工作台视图模型：阶段/过滤/KPI 的口径必须只有一套。

import { describe, expect, it } from 'vitest'

import {
  filterCards,
  filterCounts,
  isSettled,
  kpiDetailOf,
  kpiOf,
  needsAttention,
  stageOf,
  verifyKeyOf,
  waitLabelKey,
} from '../../src/client/stage'
import type { Card } from '../../src/client/types'
import { laneOf } from '../../src/shared/state'

function card(over: Partial<Card> = {}): Card {
  return {
    id: 'c-1',
    title: '卡',
    detail: '',
    kind: 'decision',
    severity: 'normal',
    status: 'open',
    action: null,
    dueAt: null,
    source: 'agent',
    interaction: 'reply',
    question: null,
    origin: { sessionId: 's-1', turn: 1 },
    advice: null,
    silent: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    events: [],
    ...over,
  } as Card
}

describe('stageOf', () => {
  it('把投递状态翻成阶段与色系', () => {
    expect(stageOf(card({ deliveryState: 'failed' }))).toEqual({
      labelKey: 'stageFailed',
      tone: 'fail',
    })
    expect(stageOf(card({ deliveryState: 'dispatched' })).labelKey).toBe('stageRunning')
    expect(stageOf(card({ deliveryState: 'waiting' })).labelKey).toBe('stagePending')
    expect(stageOf(card({ deliveryState: 'waiting', authority: 'delegated' })).labelKey).toBe(
      'stageApproved',
    )
    expect(stageOf(card({ deliveryState: 'invalidated' })).tone).toBe('neutral')
    expect(stageOf(card({ kind: 'info' })).labelKey).toBe('stageNotice')
    expect(stageOf(card({ status: 'acknowledged' })).labelKey).toBe('stageSeen')
  })

  it('等待原因与验收结论各有独立文案键', () => {
    expect(waitLabelKey(card({ waitReason: 'session-busy' }))).toBe('wait_session-busy')
    expect(waitLabelKey(card({ waitReason: null }))).toBeNull()
    expect(verifyKeyOf(card({ deliveryState: 'unknown' }))).toBe('caseVerifyUnknown')
    expect(verifyKeyOf(card({ deliveryState: 'confirmed' }))).toBe('caseVerifyConfirmed')
  })
})

describe('R3：escalated 不进 pending', () => {
  it('升级卡只计 escalated，不混入 pending', () => {
    const escalated = {
      ...card({ id: 'c-esc', kind: 'decision' }),
      decision: 'escalated_user',
    } as never
    const normal = card({ id: 'c-1', kind: 'decision' })
    const kpi = kpiOf([escalated, normal] as never)
    expect(kpi.escalated).toBe(1)
    expect(kpi.pending).toBe(1)
  })
})

describe('kpiOf / filterCounts', () => {
  const cards = [
    card({ id: 'a', deliveryState: 'waiting', authority: 'delegated' }),
    card({ id: 'b', deliveryState: 'waiting', waitReason: 'awaiting-user-escalation' }),
    card({ id: 'c', deliveryState: 'idle' }),
    card({ id: 'd', deliveryState: 'dispatched' }),
    card({ id: 'e', deliveryState: 'verifying' }),
    card({ id: 'f', deliveryState: 'failed' }),
    card({ id: 'g', deliveryState: 'unknown' }),
    card({ id: 'h', deliveryState: 'confirmed', status: 'done' }),
    card({ id: 'i', deliveryState: 'invalidated' }),
  ]

  it('五个 KPI 与明细同一口径', () => {
    expect(kpiOf(cards)).toEqual({
      pending: 1,
      escalated: 0,
      overridden: 0,
      delegated: 1,
      running: 1,
      verifying: 1,
      attention: 2,
    })
    const detail = kpiDetailOf(cards)
    expect(detail.escalated).toBe(1)
    expect(detail.undecided).toBe(1)
    expect(detail.secretary).toBe(1)
    expect(detail.executing).toBe(1)
    expect(detail.failed).toBe(1)
    expect(detail.unknown).toBe(1)
  })

  it('失败/未知是「需关注」而不是已结束；执行中也不算已结束', () => {
    const failed = card({
      id: 'x',
      deliveryState: 'failed',
      status: 'done',
      waitReason: 'awaiting-user-escalation',
    })
    expect(laneOf(failed)).toBe('attention')
    expect(needsAttention(failed)).toBe(true)
    expect(isSettled(failed)).toBe(false)
    expect(isSettled(card({ deliveryState: 'dispatched', status: 'done' }))).toBe(false)
    expect(isSettled(card({ deliveryState: 'confirmed', status: 'done' }))).toBe(true)
    // 同一张 failed 卡只出现在「需关注」一次，不再同时算进「已关闭」
    expect(filterCards([failed], 'attention')).toHaveLength(1)
    expect(filterCards([failed], 'closed')).toHaveLength(0)
  })

  it('过滤计数一致，且「全部」不丢失效卡', () => {
    const counts = filterCounts(cards)
    expect(counts.all).toBe(9)
    expect(counts.pending).toBe(1)
    expect(counts.running).toBe(3)
    expect(counts.verifying).toBe(1)
    expect(counts.attention).toBe(2)
    expect(counts.closed).toBe(2)
    expect(filterCards(cards, 'all')).toHaveLength(9)
    // 「通知」过滤器把 info/auto 两条车道收进来（此前它们只能在「全部」里看到）
    const noticeCards = [
      card({ id: 'n1', kind: 'info', deliveryState: 'idle' }),
      card({ id: 'n2', kind: 'auto', deliveryState: 'idle' }),
      card({ id: 'n3', kind: 'info', deliveryState: 'confirmed', status: 'done' }),
    ]
    expect(filterCards(noticeCards, 'notice').map((item) => item.id)).toEqual(['n1', 'n2'])
    // 七条过滤互不重叠，加起来等于「全部」
    const sum =
      counts.pending +
      counts.notice +
      counts.running +
      counts.verifying +
      counts.attention +
      counts.closed
    expect(sum).toBe(counts.all)
    expect(filterCards(cards, 'attention').map((item) => item.id)).toEqual(['f', 'g'])
    expect(filterCards(cards, 'closed').map((item) => item.id)).toEqual(['h', 'i'])
  })
})
