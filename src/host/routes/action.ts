// POST /action：完成 / 忽略 / 重开 / 立即执行 / 作答 / 删除。

import { ACTION_EVENT, ACTION_RESULT, isCardAction } from '../../shared/state'
import { StoreError } from '../cards/store'
import { asString } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { readJson, sendJson } from '../http'
import { answerQuestion } from '../question/answer'
import { answerPendingQuestion } from '../question/pending'
import type { CardQuestion } from '../question/types'
import type { RouteDeps } from './deps'

export function createActionHandler({ cards, scanner, log, runtime }: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const body = await readJson(req)
    const id = asString(body.id)
    const name = asString(body.action)
    if (!id) throw new StoreError('MISSING_ID', '缺少卡片 id')
    const card = cards.find(id)
    if (!card) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')

    if (name === 'delete') return sendJson(res, 200, { ok: true, ...(await cards.remove(id)) })
    if (name === 'run-now') {
      const result = await scanner.execute(card)
      return sendJson(res, 200, { ok: true, result, card: cards.find(id) })
    }
    if (name === 'answer') return answerCard({ body, card, id, cards, runtime, res })
    if (!isCardAction(name)) throw new StoreError('BAD_ACTION', '未知操作')
    const status = ACTION_RESULT[name]
    const patched = await cards.patch(id, { status }, ACTION_EVENT[name])
    log(`卡片动作：${name} → ${status}`)
    return sendJson(res, 200, { ok: true, card: patched })
  }
}

interface AnswerOptions {
  body: Record<string, unknown>
  card: NonNullable<ReturnType<RouteDeps['cards']['find']>>
  id: string
  cards: RouteDeps['cards']
  runtime: RouteDeps['runtime']
  res: HttpResponseLike
}

/** 卡片作答：先试宿主的原生提问通道，会话没了就模拟用户输入。 */
async function answerCard({ body, card, id, cards, runtime, res }: AnswerOptions) {
  const text = String(body.option || body.text || '').trim()
  if (!text) throw new StoreError('MISSING_ANSWER', '缺少要回答的内容')
  const question = (card.question || {}) as CardQuestion
  const sessionId = question.sessionId || (card.origin && card.origin.sessionId)
  const items = Array.isArray(question.items) ? question.items : []
  const answers = items.length
    ? items.map((item) => ({ id: item.id, selected: [text] }))
    : [{ id: question.id || 'q', selected: [text] }]
  const native = sessionId ? answerPendingQuestion(sessionId, answers) : false
  const result = native
    ? { via: 'question' as const, answered: true }
    : await answerQuestion(card, text, runtime())
  await cards.patch(
    id,
    { status: 'done', answer: text, answeredAt: Date.now(), answeredVia: 'card' },
    'answered',
  )
  return sendJson(res, 200, { ok: true, result, card: cards.find(id) })
}
