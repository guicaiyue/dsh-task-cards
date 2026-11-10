// 就绪集与排序：只回答「哪些卡可以派、按什么顺序」。
//
// 纯函数，不读时间、不写状态，方便穷举测试。

import type { Card } from '../../shared/contract'

const SEVERITY_WEIGHT: Record<Card['severity'], number> = { high: 3, normal: 2, low: 1 }

/**
 * 可以进入准入的卡：投递状态在 waiting，且 status 是生命周期映射写下的 done。
 *
 * 这是一条不变量，不是宽松判断：`waiting` 只能从 `kernel/transition.ts` 进，
 * 那一步会同时把 status 写成 done（shared/case-contract.ts::statusForDelivery）。
 * 因此 waiting 卡出现 open/acknowledged/dismissed，说明数据不一致或人已经关掉它——
 * 两种情况都不该派发：前者等 `kernel/drift.ts` 纠正，后者就是要停。
 * 用 status==='done' 而不是「status 不是关闭态」，是为了不把 acknowledged
 * （旧数据里可能出现）当成可派发。
 */
export function isCandidate(card: Card): boolean {
  return card.deliveryState === 'waiting' && card.status === 'done'
}

/** 同一会话的「在飞」卡：已派发或已租约。非抢占的依据。 */
export function inFlightOf(cards: readonly Card[], sessionId: string): Card[] {
  return cards.filter(
    (card) =>
      card.origin?.sessionId === sessionId &&
      (card.deliveryState === 'dispatched' || card.deliveryState === 'leased'),
  )
}

/** 排序：先重后轻，同权重按创建时间先进先出。 */
export function orderCandidates(
  cards: readonly Card[],
  priorityOf: (card: Card) => number = () => 0,
): Card[] {
  return cards
    .filter(isCandidate)
    .slice()
    .sort((a, b) => {
      // 计划优先级优先（urgent 只排本轮队首），再重后轻，再 FIFO。
      const priority = priorityOf(b) - priorityOf(a)
      if (priority !== 0) return priority
      const weight = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]
      if (weight !== 0) return weight
      return (a.createdAt || 0) - (b.createdAt || 0)
    })
}
