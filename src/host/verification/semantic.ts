// 三级验收的 decision/user 消费点：把语义票据的结论写成 Outcome（verifier 两级）。

import type { Card, Outcome } from '../../shared/contract'
import type { PlansStore } from '../plans/store'

export interface SemanticSink {
  recordOutcome?(outcome: Outcome): Promise<unknown>
  markSource?(sourceCardId: string, verified: Outcome['verified']): Promise<unknown>
}

/** 语义票据拍板后落 Outcome：approve→confirmed / reject→failed / 其它→unknown。 */
export async function recordSemanticOutcome(
  plans: SemanticSink | undefined,
  ticket: Card,
  verdict: 'approve' | 'reject' | 'unknown',
): Promise<boolean> {
  const semantic = ticket.semantic
  if (!plans?.recordOutcome || !semantic) return false
  const verified: Outcome['verified'] =
    verdict === 'approve' ? 'confirmed' : verdict === 'reject' ? 'failed' : 'unknown'
  await plans
    .recordOutcome({
      planId: semantic.planId,
      verified,
      criteriaResults: semantic.criteria.map((id) => ({
        id,
        pass: verified === 'confirmed',
        evidence: `verifier=${semantic.verifier}`,
      })),
      verifier: semantic.verifier === 'user' ? 'user' : 'model',
      confidence: verified === 'confirmed' ? 1 : 0,
      at: Date.now(),
    })
    .catch(() => undefined)
  await plans.markSource?.(semantic.sourceCardId, verified).catch(() => undefined)
  return true
}

/** decision 级票据：决策代理人出票后自动落 Outcome。 */
export async function consumeDecisionSemantic(
  card: Card,
  recordOutcome: ((outcome: Outcome) => Promise<unknown>) | undefined,
): Promise<boolean> {
  if (!card.semantic || card.semantic.verifier !== 'decision') return false
  return recordSemanticOutcome(
    { ...(recordOutcome ? { recordOutcome } : {}) },
    card,
    verdictOfAdvice(card),
  )
}

/** user 级票据：用户拍板（批准/拒绝）后落 Outcome + 原卡状态。 */
export async function consumeUserSemantic(
  cards: { patch(id: string, changes: Record<string, unknown>, reason: string): Promise<unknown> },
  recordOutcome: (outcome: Outcome) => Promise<unknown>,
  ticket: Card,
  verdict: 'approve' | 'reject',
): Promise<boolean> {
  if (ticket.semantic?.verifier !== 'user') return false
  return recordSemanticOutcome(
    {
      recordOutcome,
      markSource: async (sourceCardId, verified) => {
        await cards.patch(
          sourceCardId,
          { deliveryState: verified === 'confirmed' ? 'confirmed' : 'failed' },
          'semantic:user',
        )
      },
    },
    ticket,
    verdict,
  )
}

/** decision 级票据：从票拟结论推导 verdict。 */
export function verdictOfAdvice(card: Card): 'approve' | 'reject' | 'unknown' {
  const verdict = card.advice?.verdict
  if (verdict === 'approve') return 'approve'
  if (verdict === 'reject') return 'reject'
  return 'unknown'
}
