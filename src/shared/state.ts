// 状态机与视图分组：面板和路由共用，避免「这里 done、那里 dismissed」的散落判断。

import type { CardKind, CardSeverity, CardStatus } from './contract'

/** 已结束（不再需要动作）的状态。 */
export const CLOSED_STATUSES: readonly CardStatus[] = ['done', 'dismissed', 'acknowledged']

export function isClosed(status: CardStatus): boolean {
  return CLOSED_STATUSES.includes(status)
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

/** 面板分组：要我决策 / 要我知晓 / 自动处理中 / 已结束。 */
export interface CardGroups<C extends { kind: CardKind; status: CardStatus }> {
  decision: C[]
  info: C[]
  auto: C[]
  closed: C[]
}

export function groupCards<C extends { kind: CardKind; status: CardStatus }>(
  cards: C[],
): CardGroups<C> {
  const groups: CardGroups<C> = { decision: [], info: [], auto: [], closed: [] }
  for (const card of cards) {
    if (isClosed(card.status)) groups.closed.push(card)
    else if (card.kind === 'decision') groups.decision.push(card)
    else if (card.kind === 'auto') groups.auto.push(card)
    else groups.info.push(card)
  }
  return groups
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
}

const SEVERITY_WEIGHT: Record<CardSeverity, number> = { high: 3, normal: 2, low: 1 }

/** 处理车道：0 要我决策 → 1 要我知晓 → 2 自动处理中 → 3 已结束。 */
export function cardLane(card: Pick<CardOrder, 'kind' | 'status'>): number {
  if (isClosed(card.status)) return 3
  if (card.kind === 'decision') return 0
  if (card.kind === 'auto') return 2
  return 1
}

/** 列表顺序：待处理的在前（决策 → 知晓 → 自动），已结束沉底；同档先重后轻，再新的在前。 */
export function compareCards(a: CardOrder, b: CardOrder): number {
  const lane = cardLane(a) - cardLane(b)
  if (lane !== 0) return lane
  const severity = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]
  if (severity !== 0) return severity
  return (b.createdAt || 0) - (a.createdAt || 0)
}

/** 不就地排序：调用方拿到的仍是同一批卡的新数组。 */
export function sortCards<C extends CardOrder>(cards: readonly C[]): C[] {
  return cards.slice().sort(compareCards)
}
