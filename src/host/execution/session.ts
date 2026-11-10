// 会话适配器：把批准的话投回原会话，这是 M1 唯一真正执行的动作。
//
// 与旧的直接投递共用 question/answer：行为不漂移，只是多了一次「谁派发」的记录。

import type { Card } from '../../shared/contract'
import type { HostRuntime, Log } from '../host-api'
import { answerQuestion } from '../question/answer'
import type { DispatchOutcome, ExecutionAdapter } from './adapter'

export interface SessionAdapterDeps {
  getCtx: () => HostRuntime | null
  log: Log
}

/** 批准时发回去的那句话：面板作答 → 票拟推荐方案 → 兜底模板。 */
export function dispatchTextOf(card: Card): string {
  const answered = (card.answer || '').trim()
  if (answered) return answered
  const advice = card.advice
  if (advice) {
    const chosen = (advice.options[advice.chosen]?.answer || advice.answer || '').trim()
    if (chosen) return chosen
  }
  if (card.ask === 'permission') return `允许：${card.title}`
  return `已批准：${card.title}。按这个方向继续。`
}

export function createSessionAdapter(deps: SessionAdapterDeps): ExecutionAdapter {
  return {
    kind: 'session',
    async execute(card: Card): Promise<DispatchOutcome> {
      if (!card.origin?.sessionId)
        return { accepted: false, permanent: true, error: 'no-session（这张卡没有可回访的会话）' }
      try {
        // 这里成功只说明消息已进 origin 会话；结算要等那边回合一结束（回执）。
        const result = await answerQuestion(card, dispatchTextOf(card), deps.getCtx())
        deps.log(`执行派发（等回执）：${card.id} → ${card.origin.sessionId}（${result.via}）`)
        return { accepted: true, via: result.via }
      } catch (err) {
        const error = (err as Error)?.message || String(err)
        // 会话不可恢复 / 无 agent 属于永久失败：重试一百次也不会好，必须交人处理。
        const permanent = /无法恢复为 agent|NO_AGENT|NO_SESSION|no-session|resolveAgent/i.test(
          error,
        )
        deps.log(`执行派发失败${permanent ? '（永久）' : ''}：${card.id} — ${error}`)
        return { accepted: false, ...(permanent ? { permanent } : {}), error }
      }
    },
  }
}
