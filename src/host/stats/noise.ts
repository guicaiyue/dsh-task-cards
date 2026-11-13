// 自噪声度量：工具问得值不值、账本里有多少东西其实不用人看。
//
// 口径（写进 docs/contracts.md「/stats 口径」）：
// - ask：人真答过的 / 由默认答案收尾的（超时或过期）/ 还开着的；
// - 卡：已收尾却没有任何人工动作的（zeroAction）——它们只是记录，不是「事情」。
// 这两个数是「省不省力」的直接证据，比卡数/回合更能说明问题。

import type { Ask } from '../../shared/ask-contract'
import type { Card } from '../../shared/contract'

const HUMAN_EVENTS = new Set(['answered', 'approved', 'denied', 'dismissed'])

export interface NoiseStats {
  asks: {
    total: number
    human: number
    auto: number
    open: number
    /** 由默认答案收尾的比例：越高说明这些提问越没必要问人。 */
    autoRate: number | null
  }
  cards: {
    total: number
    /** 已收尾且没有任何人工动作的卡。 */
    zeroAction: number
    zeroActionRate: number | null
    /** 真正把会话卡住的提问卡（interaction=question）。 */
    blocking: number
  }
}

const rate = (part: number, total: number): number | null =>
  total > 0 ? Number((part / total).toFixed(3)) : null

export function noiseOf(cards: Card[], asks: Ask[]): NoiseStats {
  const answered = asks.filter((ask) => ask.answeredAt !== undefined)
  const auto = answered.filter((ask) => ask.autoContinued).length
  const human = answered.length - auto
  const zeroAction = cards.filter(
    (card) => card.status !== 'open' && !card.events.some((event) => HUMAN_EVENTS.has(event.type)),
  ).length
  return {
    asks: {
      total: asks.length,
      human,
      auto,
      open: asks.length - answered.length,
      autoRate: rate(auto, asks.length),
    },
    cards: {
      total: cards.length,
      zeroAction,
      zeroActionRate: rate(zeroAction, cards.length),
      blocking: cards.filter((card) => card.interaction === 'question').length,
    },
  }
}
