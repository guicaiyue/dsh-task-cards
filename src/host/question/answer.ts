// 问题卡的回答：会话还活着就走宿主提问通道；会话没了就把选项当用户输入发回去。

import type { Card } from '../../shared/contract'
import { StoreError } from '../cards/store'
import type { HostRuntime } from '../host-api'
import { asRecord } from '../host-api'
import { findAskCallId } from './record'
import type { CardQuestion } from './types'

export interface AnswerResult {
  via: 'question' | 'prompt'
  answered: boolean
}

export async function answerQuestion(
  card: Card,
  text: string,
  ctx: HostRuntime | null,
): Promise<AnswerResult> {
  const question = (card.question || {}) as CardQuestion
  const sessionId = question.sessionId || card.origin?.sessionId
  let callId = question.callId || null
  // 建卡时拿不到 callId（提问走的 ask 不带它）：答的时候从会话日志里找最近一次
  // ask_user_question 的工具调用，那是宿主认的 callId。
  if (!callId && ctx?.sessionQuery && sessionId) {
    callId = await findAskCallId(ctx.sessionQuery, sessionId)
  }
  if (ctx?.agents && callId) {
    try {
      const agent = (ctx.agents.list?.() || []).find((item) => item?.sessionId === sessionId)
      if (agent && ctx.userQuestions && typeof ctx.userQuestions.answer === 'function') {
        const items = Array.isArray(question.items) ? question.items : []
        const answers = items.length
          ? items.map((item) => ({ id: item.id, selected: [text] }))
          : [{ id: question.id || 'q', selected: [text] }]
        const accepted = await ctx.userQuestions.answer(agent, callId, { answers })
        if (accepted) return { via: 'question', answered: true }
      }
    } catch {
      // 会话已经结束 / 问题已超时：退回模拟用户输入
    }
  }
  if (!ctx?.sessionController) throw new StoreError('NO_RUNTIME', '宿主缺少 sessionController')
  if (!sessionId) throw new StoreError('NO_SESSION', '这张卡没有可回访的会话')
  const controller = new AbortController()
  try {
    await ctx.sessionController.prompt(
      {
        requestId: `card-answer-${Date.now().toString(36)}`,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      },
      controller.signal,
    )
  } finally {
    try {
      controller.abort()
    } catch {
      /* 已经结束 */
    }
  }
  return { via: 'prompt', answered: true }
}

/** 卡片上挂的问题选项（面板据此渲染回答入口）。 */
export function questionOf(card: Card): CardQuestion {
  const raw = asRecord(card.question) as unknown as CardQuestion
  return raw && Array.isArray(raw.items) ? raw : { items: [] }
}
