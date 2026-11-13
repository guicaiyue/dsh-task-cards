// 状态机与视图分组：面板和路由共用，避免「这里 done、那里 dismissed」的散落判断。

import { statusForDelivery } from './case-contract'
import type { CardKind, CardSeverity, CardStatus, DeliveryState } from './contract'

/** 已结束（不再需要动作）的状态。 */
export const CLOSED_STATUSES: readonly CardStatus[] = ['done', 'dismissed', 'acknowledged']

export function isClosed(status: CardStatus): boolean {
  return CLOSED_STATUSES.includes(status)
}

/** 判定生命周期需要的最小形状：deliveryState 是执行真源，status 是它的派生值。 */
export interface LifecycleCard {
  kind: CardKind
  status: CardStatus
  deliveryState?: DeliveryState
  /** 阶段 B：决定状态机（escalated_user 走独立车道）。 */
  decision?: string
}

/**
 * 这张卡在面板上应有的 status。
 *
 * 真源在 shared/case.ts 的 statusForDelivery：主机端 transition 会同步写 status，
 * 这里再派生一次是为了旧数据（status 没跟上投递状态）也不会被面板误判成待处理。
 */
export function effectiveStatus(card: LifecycleCard): CardStatus {
  return statusForDelivery(card.deliveryState ?? 'idle') ?? card.status
}

/**
 * 结束判定统一走这里，别再用 isClosed(card.status)。
 *
 * 与 laneOf 同源：失败/未知（attention）与执行中（running）都**不是**已结束。
 * 只看 status 会把 failed 当 done（派生值），那是面板误判的来源。
 */
export function isCardClosed(card: LifecycleCard): boolean {
  return laneOf(card) === 'closed'
}

/** 卡片动作 → 落到的状态。路由只认这张表，面板的分组也依赖它。 */
export const ACTION_RESULT: Record<string, CardStatus> = {
  complete: 'done',
  acknowledge: 'acknowledged',
  dismiss: 'dismissed',
  reopen: 'open',
  answer: 'done',
  /** 决策卡批红：把结论推回原会话，卡随之结束。 */
  approve: 'done',
  /** 许可卡拒绝：把「不允许」推回原会话，卡随之结束。 */
  deny: 'done',
}

export type CardActionName = keyof typeof ACTION_RESULT

export function isCardAction(name: string): name is CardActionName {
  return Object.hasOwn(ACTION_RESULT, name)
}

/** 动作对应的事件类型（写进 card.events）。 */
export const ACTION_EVENT: Record<CardActionName, string> = {
  complete: 'completed',
  acknowledge: 'acknowledged',
  dismiss: 'dismissed',
  reopen: 'reopened',
  answer: 'answered',
  approve: 'approved',
  deny: 'denied',
}

/**
 * 卡片在面板上属于哪条车道。这是**唯一**的分组口径（面板分组、KPI、过滤都读它）。
 *
 * - `attention`：执行失败 / 判不了 → 必须进「需关注」，**不算已结束**；
 * - `running`：已批准，正在排队/租约/派发/执行（等回执）→ 不是「已结束」；
 * - `closed`：验收确认、对账失效，或人手工关掉（idle + 已结束 status）；
 * - 其余按 kind 归 decision / info / auto。
 *
 * 注意顺序：先看 deliveryState（执行真源），再看 status。failed/unknown 的 status 虽被
 * 生命周期收成 done，但它们不是「已结束」，所以不能先走 isCardClosed。
 */
export type CardLane =
  | 'closed'
  | 'attention'
  | 'running'
  | 'decision'
  | 'escalated'
  | 'info'
  | 'auto'

const RUNNING_STATES: ReadonlySet<DeliveryState> = new Set<DeliveryState>([
  'waiting',
  'leased',
  'dispatched',
  'executed',
  'verifying',
])

export function laneOf(card: LifecycleCard): CardLane {
  const state = card.deliveryState ?? 'idle'
  if (state === 'failed' || state === 'unknown') return 'attention'
  if (state === 'confirmed' || state === 'invalidated') return 'closed'
  if (RUNNING_STATES.has(state)) return 'running'
  if (isClosed(card.status)) return 'closed'
  // 阶段 B：升级给用户的决策独立车道（面板可单独分组显示「为什么升级」）。
  if (card.kind === 'decision' && card.decision === 'escalated_user') return 'escalated'
  if (card.kind === 'decision') return 'decision'
  if (card.kind === 'auto') return 'auto'
  return 'info'
}

/** 面板分组：要我决策 / 升级给我 / 要我知晓 / 自动处理中 / 需关注 / 执行中 / 已结束。 */
export interface CardGroups<C extends LifecycleCard> {
  decision: C[]
  escalated: C[]
  info: C[]
  auto: C[]
  attention: C[]
  running: C[]
  closed: C[]
}

export function groupCards<C extends LifecycleCard>(cards: C[]): CardGroups<C> {
  const groups: CardGroups<C> = {
    decision: [],
    escalated: [],
    info: [],
    auto: [],
    attention: [],
    running: [],
    closed: [],
  }
  for (const card of cards) groups[laneOf(card)].push(card)
  return groups
}

/** 待答卡阻塞阈值：超过 10 分钟没答 → 会话可能被卡住。 */
export const ASK_BLOCK_THRESHOLD_MS = 10 * 60 * 1000
/** suggest 兜底：超过 30 分钟才把票拟建议显示成「默认建议」。 */
export const ASK_SUGGEST_THRESHOLD_MS = 30 * 60 * 1000

/** 这张卡是不是「等人答、还没答」的决策卡。 */
export function isAskPending(card: CardOrder & { answer?: string; decision?: string }): boolean {
  if (card.kind !== 'decision') return false
  if (card.status !== 'open') return false
  if (card.answer) return false
  return card.decision !== 'notice' && card.decision !== 'closed'
}

/** 待答时长（ms）；不是待答卡返回 null。 */
export function askWaitMs(
  card: CardOrder & { answer?: string; decision?: string },
  now: number,
): number | null {
  if (!isAskPending(card)) return null
  return Math.max(0, now - (card.createdAt || 0))
}

/** 阻塞中的待答卡（超过阈值）。 */
export function isBlockedAsk(
  card: CardOrder & { answer?: string; decision?: string },
  now: number,
): boolean {
  const waited = askWaitMs(card, now)
  return waited !== null && waited >= ASK_BLOCK_THRESHOLD_MS
}

export interface BlockedAsks {
  /** 被阻塞的会话数（同一会话多张卡算 1 个）。 */
  count: number
  /** 最长阻塞时长（ms）。 */
  maxMs: number
  cardIds: string[]
}

export function blockedAsksOf(
  cards: readonly (CardOrder & {
    answer?: string
    decision?: string
    origin?: { sessionId?: string }
  })[],
  now: number,
): BlockedAsks {
  const sessions = new Set<string>()
  let maxMs = 0
  const cardIds: string[] = []
  for (const card of cards) {
    const waited = askWaitMs(card, now)
    if (waited === null || waited < ASK_BLOCK_THRESHOLD_MS) continue
    cardIds.push((card as { id?: string }).id ?? '')
    sessions.add(card.origin?.sessionId ?? '')
    maxMs = Math.max(maxMs, waited)
  }
  return { count: sessions.size, maxMs, cardIds }
}

/** 「要我知晓」KPI 的时间窗：最近 24 小时。 */
export const INFO_KPI_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * KPI「要我知晓」：最近 24 小时出现的知晓卡。
 * 读没读不影响——通知看到即已读，若只算未读数，面板一打开就清零、几乎永远是 0。
 */
export function recentInfoCount<
  C extends { kind: CardKind; status: CardStatus; createdAt: number },
>(cards: readonly C[], now: number = Date.now()): number {
  return cards.filter(
    (card) =>
      card.kind === 'info' &&
      card.status !== 'dismissed' &&
      now - (card.createdAt || 0) < INFO_KPI_WINDOW_MS,
  ).length
}

/** 侧栏未读圆点：还没已读的知晓卡（观察者的通知看到即已读，手写备忘要自己勾掉）。 */
export function unreadInfoCount<C extends { kind: CardKind; status: CardStatus }>(
  cards: readonly C[],
): number {
  return cards.filter((card) => card.kind === 'info' && card.status === 'open').length
}

/** 排序用的最小形状：比 Card 少，测试与两端都能直接用。 */
export interface CardOrder {
  kind: CardKind
  status: CardStatus
  severity: CardSeverity
  createdAt: number
  deliveryState?: DeliveryState
  /** 阶段 B：决定状态机（escalated_user 走独立车道）。 */
  decision?: string
}

const SEVERITY_WEIGHT: Record<CardSeverity, number> = { high: 3, normal: 2, low: 1 }

/** 排序顺序：要我决策 → 要我知晓 → 自动处理 → 需关注 → 执行中 → 已结束。 */
const LANE_ORDER: Record<CardLane, number> = {
  decision: 0,
  escalated: 1,
  info: 2,
  auto: 3,
  attention: 4,
  running: 5,
  closed: 6,
}

/** 处理车道序：口径来自 laneOf，别处不要再写一套。 */
export function cardLane(
  card: Pick<CardOrder, 'kind' | 'status'> & { deliveryState?: DeliveryState },
): number {
  return LANE_ORDER[laneOf(card)]
}

/** 列表顺序：待处理的在前（决策 → 知晓 → 自动），已结束沉底；同档先重后轻，再新的在前。 */
export function compareCards(a: CardOrder, b: CardOrder): number {
  const lane = cardLane(a) - cardLane(b)
  if (lane !== 0) return lane
  // 阶段 F：阻塞中的待答卡置顶（会话在等它，晚一分钟都可能空转）。
  const now = Date.now()
  const blockedA = isBlockedAsk(a as never, now) ? 1 : 0
  const blockedB = isBlockedAsk(b as never, now) ? 1 : 0
  if (blockedA !== blockedB) return blockedB - blockedA
  const severity = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]
  if (severity !== 0) return severity
  return (b.createdAt || 0) - (a.createdAt || 0)
}

/** 不就地排序：调用方拿到的仍是同一批卡的新数组。 */
export function sortCards<C extends CardOrder>(cards: readonly C[]): C[] {
  return cards.slice().sort(compareCards)
}
