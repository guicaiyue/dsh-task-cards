// 自动执行前的可执行性校验。
//
// 模型说「可逆、便宜」不够：那句话必须能独立成立、要求的能力必须存在、
// 影响等级必须是 read。任何一项不满足就不发，把原因留在卡上等人看。

import type { Card } from '../../shared/contract'

/** 插件当前真正支持的能力；没有写卡片正文的接口。 */
export const CAPABILITIES = new Set<string>([
  'session.reply',
  'cards.complete',
  'cards.acknowledge',
  'cards.dismiss',
])

const DEICTIC = /(这张卡|那张卡|该卡|此卡|上一张|刚才那张|上面那张)/
const MAX_ANSWER = 2000

export interface AnswerCheck {
  ok: boolean
  reasons: string[]
}

function mentionsCard(text: string, card: Card): boolean {
  if (text.includes(card.id)) return true
  return Boolean(card.title && text.includes(card.title))
}

/**
 * 检查一句要发回原会话的话。
 * 只给自动执行用；人工批准可以带 deictic 警告，但仍要拦掉不存在的能力。
 */
export function checkAnswer(card: Card, text: string): AnswerCheck {
  const reasons: string[] = []
  const advice = card.advice
  const effect = advice?.effect ?? 'write-code'
  const value = text.trim()
  if (!value) reasons.push('empty-answer')
  if (effect !== 'read') reasons.push(`effect:${effect}`)
  for (const requirement of advice?.requires ?? []) {
    if (!CAPABILITIES.has(requirement)) reasons.push(`missing-capability:${requirement}`)
  }
  if (DEICTIC.test(value) && !mentionsCard(value, card)) reasons.push('deictic-without-target')
  if (value.length > MAX_ANSWER) reasons.push('too-long')
  if (!card.origin?.sessionId) reasons.push('no-origin')
  return { ok: reasons.length === 0, reasons }
}

/** 人工批准时只拦「真的执行不了」的那类；指代不明给警告，不硬拦。 */
export function manualBlockers(card: Card, text: string): string[] {
  return checkAnswer(card, text).reasons.filter((reason) =>
    reason.startsWith('missing-capability:'),
  )
}
