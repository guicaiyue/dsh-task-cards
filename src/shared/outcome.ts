// 验收结论：只描述「判成什么 + 下一步做什么」，不描述原因细节（原因进事件）。

export type VerifiedState = 'confirmed' | 'failed' | 'unknown'

/** 验收之后的动作：关账 / 让会话补更新 / 交决策者 / 重试。 */
export type VerifyAction = 'close' | 'continue-session' | 'escalate' | 'retry' | 'inconclusive'

export type Verifier = 'system' | 'decision' | 'user'

export interface CriterionResult {
  /** 对应 checklist / evidence 的标识。 */
  id: string
  pass: boolean
  evidence: string
}

export interface VerificationOutcome {
  verified: VerifiedState
  action: VerifyAction
  verifier: Verifier
  /** 一句话解释，面板直接展示。 */
  reason: string
  criteria: CriterionResult[]
  /** 这次判不了，需要语义判定（M2 预留，默认不触发模型）。 */
  semanticNeeded: boolean
}
