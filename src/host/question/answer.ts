// 问题卡的回答：会话还活着就走宿主提问通道；会话没了就把选项当用户输入发回去。

import { randomUUID } from 'node:crypto'
import type { Card } from '../../shared/contract'
import { StoreError } from '../cards/store'
import type { AgentMessageLike, HostRuntime } from '../host-api'
import { asRecord } from '../host-api'
import { findAskCallId } from './record'
import type { CardQuestion } from './types'

export interface AnswerResult {
  via: 'question' | 'agent' | 'prompt'
  answered: boolean
}

/** 任务卡答复的 user-role 消息：source 让聊天把它渲染成非人类触发通知。 */
function cardAnswerMessage(card: Card, text: string): AgentMessageLike {
  const message: AgentMessageLike = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: `〔任务卡答复 ${card.id}「${card.title}」〕\n${text}` }],
    source: {
      kind: 'dsh-task-cards',
      form: 'notice',
      summary: `任务卡答复：${card.title}`,
      cardId: card.id,
      cardTitle: card.title,
    },
  }
  return Object.freeze(message)
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
  if (!sessionId) throw new StoreError('NO_SESSION', '这张卡没有可回访的会话')
  // 优先走实时 agent 的 followup：它接受自定义 source，聊天里会显示成
  // 「非人类触发」通知，而不是用户气泡；冷会话再退回 sessionController.prompt。
  if (tryLiveAgent(card, text, sessionId, ctx)) return { via: 'agent', answered: true }
  if (!ctx?.sessionController) throw new StoreError('NO_RUNTIME', '宿主缺少 sessionController')
  await deliverViaPrompt(card, text, sessionId, ctx.sessionController)
  return { via: 'prompt', answered: true }
}

/** 实时 agent 存在就 followup；返回是否已投递。 */
function tryLiveAgent(
  card: Card,
  text: string,
  sessionId: string,
  ctx: HostRuntime | null,
): boolean {
  const live = ctx?.agents?.get?.(sessionId)
  if (!live?.followup) return false
  try {
    live.followup(cardAnswerMessage(card, text))
    return true
  } catch {
    return false
  }
}

/** 冷会话兜底：sessionController.prompt 会把 source 重写成 user，只能靠文本标记。 */
async function deliverViaPrompt(
  card: Card,
  text: string,
  sessionId: string,
  controller: NonNullable<HostRuntime['sessionController']>,
): Promise<void> {
  const abort = new AbortController()
  const marked = `〔任务卡答复 ${card.id}「${card.title}」〕\n${text}`
  try {
    await controller.prompt(
      {
        requestId: `card-answer-${Date.now().toString(36)}`,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: marked }],
        source: { kind: 'card-answer', cardId: card.id, cardTitle: card.title },
      },
      abort.signal,
    )
  } finally {
    try {
      abort.abort()
    } catch {
      /* 已经结束 */
    }
  }
}

/** 卡片上挂的问题选项（面板据此渲染回答入口）。 */
export function questionOf(card: Card): CardQuestion {
  const raw = asRecord(card.question) as unknown as CardQuestion
  return raw && Array.isArray(raw.items) ? raw : { items: [] }
}
