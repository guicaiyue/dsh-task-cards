// 批准文本与可执行性判定（从 action.ts 拆出，控制单文件行数）。

import type { Card } from '../../shared/contract'
import { isCardClosed } from '../../shared/state'
import { StoreError } from '../cards/store'
import { asString } from '../host-api'

export function approveText(card: Card, raw: string): string {
  const given = raw.trim()
  if (given) return given
  const advice = card.advice
  if (advice) {
    const chosen = (advice.options[advice.chosen]?.answer || '').trim()
    if (chosen) return chosen
  }
  const answered = asString(card.answer).trim()
  if (answered) return answered
  return `已批准：${card.title}。按这个方向继续。`
}

/**
 * 幂等闸门：按「已经产生过投递事实」判，不按在飞状态枚举判。
 *
 * - status 已结束（done/dismissed/acknowledged，含生命周期派生）→ 已经处理过；
 * - deliveryState 不是 idle → 已经进过执行链路（含 failed/unknown/invalidated）。
 *
 * 两种都不允许再批一次：unknown 曾经漏在这里，导致「同一句答复派发两次」（真实事故）。
 * 想重来必须先 `reopen`（把投递状态退回 idle）再批准。
 */
export function assertApprovable(card: Card): void {
  if (isCardClosed(card) || (card.deliveryState ?? 'idle') !== 'idle')
    throw new StoreError('ALREADY_APPROVED', '这张卡已经批准/处理过了；要重来请先「重开」')
}

/**
 * 决策卡批红：把批准的那句话推回原会话，然后结束这张卡。
 * 推不回去（没有 origin.sessionId / 会话已死）也照样结束：卡不能卡死，
 * 只在卡上留 approved:no-session / approved:failed 事件，交给面板说明。
 */
