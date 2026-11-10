// 执行结果：执行系统只返回「原始事实」，验收由验证器做。
//
// M1 的 planId = cardId（还没有独立 plan 文件）；session adapter 的「执行」就是把
// 一句话投回原会话，所以结果的核心是**回执**：origin 会话在派发之后确实起了一轮并结束。

/** 执行结果状态：成功 / 失败 / 部分 / 无法判定。 */
export type ExecutionStatus = 'succeeded' | 'failed' | 'partial' | 'unknown'

export interface ExecutionResult {
  /** M1：等于卡片 id。 */
  planId: string
  executor: 'session' | 'system'
  status: ExecutionStatus
  /** 派发那一方的回合号（派发时 origin 会话的 turn）。 */
  dispatchedTurn: number
  /** 回执回合号：origin 会话在派发之后起的那个回合（> dispatchedTurn 才算回执）。 */
  receiptTurn?: number
  /** 回执回合最终回复的字符数：0 = 空回复，算失败，不是「完成」。 */
  replyChars?: number
  durationMs: number
  at: number
  /** status=failed/unknown 时的一句话原因（no-receipt / receipt-error / empty-reply）。 */
  error?: string
}

/** 回执是否成立：origin 会话确实在派发之后起了一轮，且有非空最终回复。 */
export function hasReceipt(result: ExecutionResult | null | undefined): boolean {
  if (!result || result.status !== 'succeeded') return false
  return (
    typeof result.receiptTurn === 'number' &&
    typeof result.dispatchedTurn === 'number' &&
    result.receiptTurn > result.dispatchedTurn &&
    (result.replyChars ?? 0) > 0
  )
}
