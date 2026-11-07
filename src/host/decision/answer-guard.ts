// 自动执行前的可执行性校验。
//
// 模型说「可逆、便宜」不够：那句话必须能独立成立、要求的能力必须存在、
// 影响等级必须是 read。任何一项不满足就不发，把原因留在卡上等人看。

import type { Advice, Card } from '../../shared/contract'

/** 插件当前真正支持的能力；没有写卡片正文的接口。 */
export const CAPABILITIES = new Set<string>([
  'session.reply',
  'cards.complete',
  'cards.acknowledge',
  'cards.dismiss',
])

const DEICTIC = /(这张卡|那张卡|该卡|此卡|上一张|刚才那张|上面那张)/
/** 可自动放行的诊断性改动：加临时日志、插桩、复测、只读检查。 */
const DIAGNOSTIC = /(日志|插桩|诊断|排查|复测|trace|debug|临时|只读|观察|检查|diff --stat)/
/** 一旦出现这些词，即使可逆也当成需要人确认。 */
const UNSAFE_WRITE = /(commit|提交|push|删除|drop|\brm\b|发布|部署|上线|外发|转账|支付)/

/** write-code 但只做可撤销的诊断性改动：不劳用户点头，自动放行。 */
export function safeDiagnosticWrite(advice?: Advice | null): boolean {
  if (!advice || advice.effect !== 'write-code' || advice.reversible !== true) return false
  const text = `${advice.action ?? ''} ${advice.scope ?? ''} ${advice.summary ?? ''}`
  return DIAGNOSTIC.test(text) && !UNSAFE_WRITE.test(text)
}
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
  if (effect !== 'read' && !safeDiagnosticWrite(advice)) reasons.push(`effect:${effect}`)
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
