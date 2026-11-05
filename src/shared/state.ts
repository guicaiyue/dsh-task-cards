// 状态机与视图分组：面板和路由共用，避免「这里 done、那里 dismissed」的散落判断。

import type { CardKind, CardStatus } from './contract'

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
