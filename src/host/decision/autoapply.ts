// 票拟自动执行：把「撤回不需要用户本人动手」的推荐直接推回原会话。
//
// 和人批红共用 question/deliver.ts 的同一个投递函数——两条路的行为不能漂移。
// 四条边界（任一不满足就不自动执行）：
//   1. 设置 decisionAutoApply 为真（用户允许系统代跑）；
//   2. 票拟 autoApply 为真（代理人判断这件事撤回不需要人动手）；
//   3. 推荐方案里有能独立成立的 answer；
//   4. 卡没结束，且卡上留着原会话 id（没有就推不回去，留着等人处理）。
// 自动执行不落判例：判例是「用户上次怎么定的」，让代理人拿自己的判断教自己
// 只会越跑越像它自己。后来返工时 markReworked 会在缺判例时就地补一条。

import type { Card } from '../../shared/contract'
import { isClosed } from '../../shared/state'
import type { Store } from '../cards/store'
import type { HostRuntime, Log } from '../host-api'
import { deliverToOrigin } from '../question/deliver'
import { checkAnswer } from './answer-guard'
import { permissionAnswer } from './templates'

/** 卡上记的事件类型：自动执行成功是 advice-applied，失败是 advice-applied:failed。 */
export const ADVICE_APPLIED_EVENT = 'advice-applied'

export interface AutoApplyDeps {
  cards: Store
  getCtx: () => HostRuntime | null
  log: Log
  /** 设置里的 decisionAutoApply：用户关掉后任何票拟都不代跑。 */
  allowed: boolean
}

/** 推荐方案里那句能独立成立的话；没有（或序号越界）返回空串。 */
export function chosenAnswerOf(card: Card): string {
  const advice = card.advice
  if (advice?.answer?.trim()) return advice.answer.trim()
  if (!advice) return ''
  return (advice.options[advice.chosen]?.answer || '').trim()
}

export async function autoApplyAdvice(deps: AutoApplyDeps, card: Card): Promise<boolean> {
  if (!deps.allowed || !card.advice?.autoApply) return false
  // 许可卡通常没有 answer；自动放行的诊断性改动用固定许可模板，不交给模型自由发挥。
  const text =
    chosenAnswerOf(card) || (card.advice?.ask === 'permission' ? permissionAnswer(card, true) : '')
  if (!text || isClosed(card.status) || !card.origin?.sessionId) return false
  const check = checkAnswer(card, text)
  if (!check.ok) {
    await deps.cards.patch(
      card.id,
      {
        advice: {
          ...card.advice,
          autoApply: false,
          blockedReasons: check.reasons,
        },
      },
      'advice-blocked',
    )
    deps.log(`自动执行被拦：${card.id} — ${check.reasons.join(', ')}`)
    return false
  }
  const result = await deliverToOrigin({
    cards: deps.cards,
    getCtx: deps.getCtx,
    log: deps.log,
    card,
    text,
    event: ADVICE_APPLIED_EVENT,
    // 自动执行失败不关卡：用户没表态，投递也没成，卡得留在「要我决策」里被看见。
    closeOnFailure: false,
  })
  return result.pushed
}
