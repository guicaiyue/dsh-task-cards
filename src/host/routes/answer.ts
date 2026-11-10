// 卡片作答：多问题卡逐题作答（answers[]）与单题卡的一键作答共用一条路。

import type { AnswerSelection, Card } from '../../shared/contract'
import { StoreError } from '../cards/store'
import { recordChoice } from '../decision/precedent'
import { clarificationAnswer } from '../decision/templates'
import { asRecord, asString } from '../host-api'
import type { HttpResponseLike } from '../http'
import { sendJson } from '../http'
import { answerQuestion } from '../question/answer'
import { answerPendingQuestion } from '../question/pending'
import type { CardQuestion } from '../question/types'
import type { RouteDeps } from './deps'

function messageOf(err: unknown): string {
  return (err as Error)?.message || String(err)
}

/** 解析面板提交的逐题答案：每题都必须有非空选择，缺一题就 400 INCOMPLETE_ANSWERS。 */
export function parseAnswers(card: Card, raw: unknown): AnswerSelection[] | null {
  const items = Array.isArray(card.question?.items) ? card.question.items : []
  if (!Array.isArray(raw) || !raw.length) return null
  const answers: AnswerSelection[] = []
  for (const item of raw) {
    const record = asRecord(item)
    const id = asString(record.id)
    const selected = Array.isArray(record.selected)
      ? record.selected.map((value) => String(value)).filter(Boolean)
      : []
    if (!id || !selected.length) continue
    answers.push({ id, selected })
  }
  const missing = items.filter((item) => !answers.some((answer) => answer.id === item.id))
  if (items.length && missing.length)
    throw new StoreError('INCOMPLETE_ANSWERS', `还有 ${missing.length} 个问题没作答`)
  return answers.length ? answers : null
}

/** 逐题答案 → 投递文本：每题一行「问题 → 选择」，不再把同一句话复制给所有题。 */
export function answersTextOf(card: Card, answers: AnswerSelection[]): string {
  const items = Array.isArray(card.question?.items) ? card.question.items : []
  return answers
    .map((answer) => {
      const item = items.find((candidate) => candidate.id === answer.id)
      return `${item?.question || answer.id} → ${answer.selected.join(' / ')}`
    })
    .join('\n')
}

/** 卡片作答：先试宿主的原生提问通道，会话没了就模拟用户输入。 */
export async function answerCard(
  deps: RouteDeps,
  card: Card,
  raw: string,
  rawAnswers: unknown,
  res: HttpResponseLike,
): Promise<unknown> {
  const answers = parseAnswers(card, rawAnswers)
  const rawText = (answers ? answersTextOf(card, answers) : raw).trim()
  if (!rawText) throw new StoreError('MISSING_ANSWER', '缺少要回答的内容')
  // 澄清卡的答复要带上原问题，原会话才能独立接住。
  const text =
    card.ask === 'clarification'
      ? clarificationAnswer(
          card.advice?.question || card.question?.items?.[0]?.question || card.title,
          rawText,
        )
      : rawText
  const question = (card.question || {}) as CardQuestion
  const sessionId = question.sessionId || (card.origin && card.origin.sessionId)
  const items = Array.isArray(question.items) ? question.items : []
  // 逐题答案原样交给宿主；单题卡没有 answers 时退回「一句话 = 所有题」的老路径。
  const nativeAnswers =
    answers ??
    (items.length
      ? items.map((item) => ({ id: item.id, selected: [text] }))
      : [{ id: question.id || 'q', selected: [text] }])
  const native = sessionId ? answerPendingQuestion(sessionId, nativeAnswers) : false
  const result = native
    ? { via: 'question' as const, answered: true }
    : await answerQuestion(card, text, deps.runtime(), answers ?? undefined)
  const wasClosed = card.status === 'done' || card.status === 'dismissed'
  const patched = await deps.cards.patch(
    card.id,
    {
      status: 'done',
      answer: text,
      answeredAt: Date.now(),
      answeredVia: 'card',
      ...(answers ? { answers } : {}),
    },
    'answered',
  )
  if (!wasClosed) {
    await recordChoice(deps.precedents, patched, text).catch((err: unknown) =>
      deps.log(`判例写入失败：${messageOf(err)}`),
    )
  }
  return sendJson(res, 200, { ok: true, result, card: deps.cards.find(card.id) })
}

/** 采纳票拟里的第 N 个方案：option 是 0-based 序号，等价于用它的 answer 作答。 */
export async function adoptCard(
  deps: RouteDeps,
  card: Card,
  raw: string,
  res: HttpResponseLike,
): Promise<unknown> {
  const index = Number.parseInt(raw.trim(), 10)
  const options = card.advice?.options || []
  const option =
    Number.isInteger(index) && index >= 0 && index < options.length ? options[index] : undefined
  if (!option) throw new StoreError('BAD_OPTION', '方案序号不对')
  const text = option.answer.trim()
  if (!text) throw new StoreError('MISSING_ANSWER', '这个方案没有能直接回给原会话的话')
  return answerCard(deps, card, text, null, res)
}
