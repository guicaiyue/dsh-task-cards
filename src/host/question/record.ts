// 提问 → 卡片 / 聊天回答 → 卡片 回写。两边都能答，谁先生效。

import type { Card } from '../../shared/contract'
import type { Store } from '../cards/store'
import type { HostRuntime, Log, SessionQueryLike, UserQuestionRequest } from '../host-api'
import { asRecord, asString } from '../host-api'
import { messageText } from '../observer/payload'
import type { CardQuestion } from './types'

/**
 * 聊天里答完提问后，把选择写回卡片（两边都能答，谁先谁生效）。
 * 返回被回写的卡：调用方据此落判例（聊天里做的决定同样算判例）。
 */
export async function recordChatAnswer(
  cards: Store,
  request: UserQuestionRequest,
  answer: unknown,
): Promise<Card[]> {
  const patched: Card[] = []
  try {
    const items = request?.questions || []
    const ids = new Set(items.map((item) => String(asRecord(item).id ?? '')))
    const answers = Array.isArray(asRecord(answer).answers)
      ? (asRecord(answer).answers as unknown[])
      : []
    if (!ids.size || !answers.length) return patched
    const text = answers
      .map((item) => {
        const selected = asRecord(item).selected
        return Array.isArray(selected) ? selected.map(String).join(' / ') : ''
      })
      .filter(Boolean)
      .join('；')
    for (const card of cards.list()) {
      const question = (card.question || {}) as CardQuestion
      const cardItems = Array.isArray(question.items) ? question.items : []
      if (card.status === 'done' || !cardItems.length) continue
      if (!cardItems.every((item) => ids.has(item.id))) continue
      patched.push(
        await cards.patch(
          card.id,
          { status: 'done', answer: text, answeredAt: Date.now(), answeredVia: 'chat' },
          'answered',
        ),
      )
    }
  } catch {
    /* 回写失败不影响回答 */
  }
  return patched
}

/** 从会话日志里找最近一次 ask_user_question 的 callId。 */
export async function findAskCallId(
  query: SessionQueryLike | undefined,
  sessionId: string,
): Promise<string | null> {
  if (!query || !sessionId) return null
  try {
    const snapshot = await query.readSession(sessionId)
    let callId: string | null = null
    for (const event of snapshot.events || []) {
      const data = asRecord(event.data)
      if (event.type === 'tool/call' && data.name === 'ask_user_question') {
        callId = asString(data.callId) || asString(data.id) || callId
      }
    }
    return callId
  } catch {
    return null
  }
}

/** 把一次提问记成卡：卡上的选项就是用户在面板里的回复入口。 */
export async function recordQuestionCard(
  cards: Store,
  log: Log,
  request: UserQuestionRequest,
  runtime: HostRuntime | null,
): Promise<void> {
  try {
    const questions = request?.questions || []
    const agent = asRecord(request?.agent)
    if (!Object.keys(agent).length || !questions.length) return
    const session = asRecord(agent.session)
    const sessionId = String(agent.sessionId ?? session.id ?? agent.id ?? '')
    const items: CardQuestion['items'] = questions.map((item) => {
      const raw = asRecord(item)
      return {
        id: String(raw.id ?? ''),
        question: String(raw.question ?? ''),
        multiSelect: raw.multiSelect === true,
        options: (Array.isArray(raw.options) ? raw.options : []).map((option) =>
          String(asRecord(option).label ?? option),
        ),
      }
    })
    const first = items[0]
    // callId 是回答时走宿主提问通道的凭据：当场能从请求里拿到就用，
    // 拿不到就立刻去会话日志里找这次工具调用的 id，别等回答时再猜。
    const wait = asRecord(request?.wait)
    let callId = asString(wait.callId) || null
    if (!callId && runtime?.sessionQuery && sessionId) {
      callId = await findAskCallId(runtime.sessionQuery, sessionId)
    }
    const title = String(first?.question || '等你回答').slice(0, 200)
    const detail = items
      .map((item) =>
        item.options?.length ? `${item.question}（${item.options.join(' / ')}）` : item.question,
      )
      .join('\n')
      .slice(0, 1000)
    await cards.create(title, {
      detail,
      kind: 'decision',
      severity: 'high',
      source: 'agent',
      interaction: 'question',
      question: { sessionId, callId, items },
      origin: { sessionId },
    })
    log(`问题卡：${title}`)
  } catch (err) {
    log(`问题卡写入失败：${(err as Error)?.message || String(err)}`)
  }
}

/**
 * 事件流里出现 ask_user_question 工具调用时也记一张卡（兜底路径：
 * 有些宿主/模型版本不走 userQuestions 服务）。
 */
export async function captureQuestion(
  cards: Store,
  log: Log,
  sessionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const args = asRecord(data.arguments ?? data.args)
  let questions = Array.isArray(args.questions) ? (args.questions as unknown[]) : []
  if (!questions.length && typeof args.question === 'string') questions = [args]
  if (!questions.length) return
  const items: CardQuestion['items'] = questions.map((item, index) => {
    const raw = asRecord(item)
    return {
      id: String(raw.id ?? `q${index + 1}`),
      question: String(raw.question ?? ''),
      multiSelect: raw.multiSelect === true,
      options: (Array.isArray(raw.options) ? raw.options : [])
        .map((option) =>
          typeof option === 'string'
            ? option
            : String(asRecord(option).label ?? asRecord(option).value ?? ''),
        )
        .filter(Boolean),
    }
  })
  const first = items[0]
  if (!first?.question) return
  const title = first.question.slice(0, 200)
  const detail = items
    .map((item) =>
      item.options?.length ? `${item.question}（${item.options.join(' / ')}）` : item.question,
    )
    .join('\n')
    .slice(0, 1000)
  await cards.create(title, {
    detail,
    kind: 'decision',
    severity: 'high',
    source: 'agent',
    interaction: 'question',
    question: {
      sessionId,
      callId: asString(data.callId) || (data.id ? String(data.id) : null),
      items,
    },
    origin: { sessionId },
  })
  log(`问题卡：${title}`)
}

/** user/message 的形状不止一种，挨个兜底取文本。 */
export function textOf(data: Record<string, unknown> | undefined): string {
  if (!data) return ''
  return messageText(data.message) || messageText(data) || asString(data.text) || ''
}
