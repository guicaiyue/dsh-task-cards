// 工作台视图模型：把交付状态 + 卡状态翻译成「阶段 / 等待原因 / 授权来源」。
//
// 面板只认这三个派生值，别处不要再各写一套映射。

import { laneOf } from '../shared/state'
import type { Card } from './types'

export type StageTone = 'wait' | 'run' | 'ok' | 'fail' | 'unknown' | 'neutral'

export interface StageView {
  labelKey: string
  tone: StageTone
}

export type WorkbenchFilter =
  | 'results'
  | 'all'
  | 'pending'
  | 'escalated'
  | 'notice'
  | 'running'
  | 'verifying'
  | 'attention'
  | 'closed'

export const FILTERS: WorkbenchFilter[] = [
  'results',
  'all',
  'pending',
  'escalated',
  'notice',
  'running',
  'verifying',
  'attention',
  'closed',
]

const CLOSED = new Set(['done', 'dismissed', 'acknowledged'])

export function stageOf(card: Card): StageView {
  if (card.deliveryState === 'invalidated') return { labelKey: 'stageInvalidated', tone: 'neutral' }
  if (card.deliveryState === 'confirmed') return { labelKey: 'stageConfirmed', tone: 'ok' }
  if (card.deliveryState === 'failed') return { labelKey: 'stageFailed', tone: 'fail' }
  if (card.deliveryState === 'unknown') return { labelKey: 'stageUnknown', tone: 'unknown' }
  if (card.deliveryState === 'verifying') return { labelKey: 'stageVerifying', tone: 'run' }
  if (card.deliveryState === 'dispatched' || card.deliveryState === 'leased') {
    return { labelKey: 'stageRunning', tone: 'run' }
  }
  if (card.deliveryState === 'waiting') {
    return card.authority
      ? { labelKey: 'stageApproved', tone: 'wait' }
      : { labelKey: 'stagePending', tone: 'wait' }
  }
  if (card.status === 'acknowledged') return { labelKey: 'stageSeen', tone: 'neutral' }
  if (CLOSED.has(card.status)) return { labelKey: 'stageClosed', tone: 'neutral' }
  if (card.kind === 'info') return { labelKey: 'stageNotice', tone: 'neutral' }
  return { labelKey: 'stagePending', tone: 'wait' }
}

/** 验收结论的文案键：详情与工作台共用同一条判定链。 */
export function verifyKeyOf(card: Card): string {
  const state = card.deliveryState
  if (state === 'confirmed') return 'caseVerifyConfirmed'
  if (state === 'failed') return 'caseVerifyFailed'
  if (state === 'unknown') return 'caseVerifyUnknown'
  if (state === 'verifying') return 'caseVerifyRunning'
  if (state === 'invalidated') return 'caseInvalidated'
  return 'caseVerifyPending'
}

export function waitLabelKey(card: Card): string | null {
  if (!card.waitReason) return null
  return `wait_${card.waitReason}`
}

export function authorityLabel(card: Card): string | null {
  if (card.authority === 'delegated') return 'authorityDelegated'
  if (card.authority === 'user') return 'authorityUser'
  if (card.authority === 'system') return 'authoritySystem'
  return null
}

export function traceShort(card: Card): string {
  return card.traceId ? card.traceId.slice(-8) : ''
}

/**
 * 五个 KPI：口径全部从这里算（laneOf + 投递状态），别在组件里再数一套。
 * `delegated` = 秘书/系统给过决定、卡还在他这边推进的（decision/running 车道）。
 */
export function kpiOf(cards: readonly Card[]): {
  pending: number
  escalated: number
  overridden: number
  delegated: number
  running: number
  verifying: number
  attention: number
} {
  let pending = 0
  let escalated = 0
  let overridden = 0
  let delegated = 0
  let running = 0
  let verifying = 0
  let attention = 0
  for (const card of cards) {
    const lane = laneOf(card)
    if (lane === 'attention') attention += 1
    if (card.deliveryState === 'dispatched' || card.deliveryState === 'leased') running += 1
    if (lane === 'running' && card.deliveryState === 'verifying') verifying += 1
    // 阶段 B：notice 不占 KPI；escalated_user 独立计数；delegated 票单独统计。
    if (card.decision === 'notice' || card.kind === 'info') {
      if (lane === 'attention') attention += 1
      continue
    }
    if (lane === 'escalated') escalated += 1
    if (card.events.some((event) => event.type === 'delegated:overridden')) overridden += 1
    if (lane === 'escalated') {
      // 独立车道：升级卡不进 pending；谁批过只影响 delegated 统计。
      if (card.authority === 'delegated' || card.authority === 'system') delegated += 1
    } else if (lane === 'decision') {
      if (card.authority === 'delegated' || card.authority === 'system') delegated += 1
      else pending += 1
    }
    if (lane === 'running' && (card.authority === 'delegated' || card.authority === 'system'))
      delegated += 1
  }
  return { pending, escalated, overridden, delegated, running, verifying, attention }
}

/** 需关注：执行失败 / 判不了 —— 行内要给动作、KPI 要计数，且不算已结束。 */
export function needsAttention(card: Card): boolean {
  return laneOf(card) === 'attention'
}

/** 已收尾：laneOf 归到 closed（确认/失效/人工关掉）；失败与执行中都不算。 */
export function isSettled(card: Card): boolean {
  return laneOf(card) === 'closed'
}

/**
 * 过滤：与 laneOf 同口径，六条互不重叠（同一张卡只出现在一条里）。
 * 「全部」含失效卡（用户要全部可见）。
 */
export function filterCards(cards: readonly Card[], filter: WorkbenchFilter): Card[] {
  if (filter === 'all') return [...cards]
  if (filter === 'closed') return cards.filter((card) => laneOf(card) === 'closed')
  if (filter === 'attention') return cards.filter((card) => laneOf(card) === 'attention')
  if (filter === 'pending') return cards.filter((card) => laneOf(card) === 'decision')
  if (filter === 'escalated') return cards.filter((card) => laneOf(card) === 'escalated')
  if (filter === 'results') return cards.filter((card) => card.result === true)
  // 「通知」= info + auto 两条车道：这两个 lane 之前没有任何过滤器，只能在「全部」里看到。
  if (filter === 'notice')
    return cards.filter((card) => {
      const lane = laneOf(card)
      return lane === 'info' || lane === 'auto'
    })
  if (filter === 'verifying') {
    return cards.filter((card) => laneOf(card) === 'running' && card.deliveryState === 'verifying')
  }
  return cards.filter((card) => laneOf(card) === 'running' && card.deliveryState !== 'verifying')
}

export function filterCounts(cards: readonly Card[]): Record<WorkbenchFilter, number> {
  const out = {
    all: 0,
    pending: 0,
    escalated: 0,
    notice: 0,
    results: 0,
    running: 0,
    verifying: 0,
    attention: 0,
    closed: 0,
  }
  for (const card of cards) {
    out.all += 1
    if (card.result) out.results += 1
    const lane = laneOf(card)
    if (lane === 'closed') out.closed += 1
    else if (lane === 'attention') out.attention += 1
    else if (lane === 'decision') out.pending += 1
    else if (lane === 'escalated') out.escalated += 1
    else if (lane === 'info' || lane === 'auto') out.notice += 1
    else if (lane === 'running') {
      if (card.deliveryState === 'verifying') out.verifying += 1
      else out.running += 1
    }
  }
  return out
}

/** KPI 卡的第二行拆解：数字从同一批卡里数，别让面板和过滤各数一套。 */
export interface KpiDetail {
  escalated: number
  undecided: number
  secretary: number
  system: number
  approved: number
  executing: number
  verifying: number
  failed: number
  unknown: number
}

export function kpiDetailOf(cards: readonly Card[]): KpiDetail {
  const out: KpiDetail = {
    escalated: 0,
    undecided: 0,
    secretary: 0,
    system: 0,
    approved: 0,
    executing: 0,
    verifying: 0,
    failed: 0,
    unknown: 0,
  }
  for (const card of cards) {
    const state = card.deliveryState
    const lane = laneOf(card)
    const open = lane === 'decision' || lane === 'running'
    if (card.waitReason === 'awaiting-user-escalation') out.escalated += 1
    else if (lane === 'decision') out.undecided += 1
    if (open && card.authority === 'delegated') out.secretary += 1
    if (open && card.authority === 'system') out.system += 1
    if (state === 'dispatched') out.executing += 1
    if (state === 'leased') out.approved += 1
    if (state === 'verifying') out.verifying += 1
    if (lane === 'attention' && state === 'failed') out.failed += 1
    if (lane === 'attention' && state === 'unknown') out.unknown += 1
  }
  return out
}
