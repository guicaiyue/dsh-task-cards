// 决策执行记录：每次决策运行落一条 phase='decision'。
//
// 面板的「决策记录」直接读它（GET /decisions 的 records）：用了什么模型、
// 输入输出多大、出了几张票拟、自动执行了几张、纠正了几张车道、错在哪。
// 和观察者记录共用同一份 RecordStore，靠 phase 区分。

import type { ObserverRecord } from '../../shared/contract'
import type { RecordStore } from '../cards/store'

export type DecisionRecordStatus = 'ok' | 'empty' | 'invalid' | 'error'

export interface DecisionRecordInput {
  status: DecisionRecordStatus
  /** 本次被决策的卡；originSessionId 取第一张能回访的会话。 */
  cards: Array<{ origin?: { sessionId?: string } | null }>
  /** 决策会话自己的 id（复用 observerSessionId 字段）。 */
  sessionId: string
  model?: string
  inputChars: number
  outputChars: number
  usage?: { inputTokens?: number; outputTokens?: number } | null
  toolCalls?: number
  durationMs: number
  attempts: number
  /** 这次出了几张票拟。 */
  cardsCreated: number
  /** 这次自动执行了几张（不等批红就动手的）。 */
  applied: number
  /** 这次把几张卡从 decision 纠正回了 info。 */
  corrected: number
  excerpt?: string
  error?: string
}

/** 一批卡可能来自不同会话，取第一张能回访的：面板只用它做定位。 */
function originSessionOf(cards: DecisionRecordInput['cards']): string | undefined {
  for (const card of cards) {
    if (card.origin?.sessionId) return card.origin.sessionId
  }
  return undefined
}

export async function addDecisionRecord(
  records: RecordStore,
  input: DecisionRecordInput,
): Promise<ObserverRecord> {
  return records.add({
    phase: 'decision',
    status: input.status,
    originSessionId: originSessionOf(input.cards),
    observerSessionId: input.sessionId || undefined,
    model: input.model,
    inputChars: input.inputChars,
    outputChars: input.outputChars,
    usage: input.usage || undefined,
    toolCalls: input.toolCalls,
    durationMs: input.durationMs,
    attempts: input.attempts,
    cardsCreated: input.cardsCreated,
    applied: input.applied,
    corrected: input.corrected,
    excerpt: input.excerpt,
    error: input.error,
  })
}
