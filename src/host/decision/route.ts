// 授权路由（阶段 B / §9.2 + §10）：纯函数，输入 CaseFile 级别的信息，输出谁做决定。
//
// 三档（条件全满足才降档，任一不满足就升到 user）：
//   auto      = effect=read 或可逆诊断写（不要求判例）
//   secretary = 可逆 + 有判例 + confidence=high + 非 spend/destructive/external
//   user      = 其余（不可逆/spend/destructive/external/方向变更/低置信/无判例(写入类)/冲突票/wait 结构不完整）
//
// wait 结构闸门（§10.2）：verdict=wait 必须带 question + reason(basis) + 可决定的选项，
// 缺任一项 → 服务端降级 escalate（不能只靠提示词）。

import type { Card } from '../../shared/contract'
import { CONFIDENCE_VALUE } from '../../shared/contract'
import type { ApprovalPolicy } from '../policy/store'

export type Decider = 'user' | 'secretary' | 'auto'

export interface RouteDecision {
  decider: Decider
  reason: string
  threshold: string[]
}

export interface RouteInput {
  card: Pick<Card, 'kind' | 'ask'>
  advice?:
    | (Pick<
        Card['advice'] & object,
        | 'verdict'
        | 'effect'
        | 'confidence'
        | 'question'
        | 'basis'
        | 'options'
        | 'precedentIds'
        | 'reversible'
      > & { confidenceScore?: number })
    | null
  policy: ApprovalPolicy
  /** 有冲突票（priorVerdicts 里既有 approve 又有 reject）。 */
  conflict?: boolean
}

function tails(policy: ApprovalPolicy, tier: 'auto' | 'delegated' | 'user'): string[] {
  const tiers = policy.tiers as
    | { auto?: string[]; delegated?: string[]; user?: string[] }
    | undefined
  const fallback: Record<'auto' | 'delegated' | 'user', string[]> = {
    auto: ['effect=read', 'reversible-diagnostic'],
    delegated: [
      'reversible',
      'has-precedent',
      'confidence=high',
      'not-spend',
      'not-destructive',
      'not-external',
    ],
    user: [
      'irreversible',
      'spend',
      'destructive',
      'external',
      'direction-change',
      'low-confidence',
      'conflict',
    ],
  }
  const value = tiers?.[tier]
  return value?.length ? value : fallback[tier]
}

/** wait 是否可直接由人决定：需要 question + reason + 至少一个选项。 */
export function waitStructureOk(advice: NonNullable<RouteInput['advice']>): boolean {
  if (!advice.question?.trim()) return false
  if (!advice.basis?.trim()) return false
  return advice.options.some((option) => option.name?.trim() || option.answer?.trim())
}

export function route(input: RouteInput): RouteDecision {
  const { card, advice, policy } = input
  const user = (reason: string): RouteDecision => ({
    decider: 'user',
    reason,
    threshold: tails(policy, 'user'),
  })
  // notice 卡不进决定状态机（防御性给中立结论）。
  if (card.kind !== 'decision')
    return { decider: 'auto', reason: 'notice: 非决策卡', threshold: ['notice'] }
  // §12：无票拟 = 还没跑决策代理人 → 默认派秘书，不算 user 档。
  if (!advice)
    return {
      decider: 'secretary',
      reason: 'pending_secretary: 还没有票拟',
      threshold: tails(policy, 'delegated'),
    }
  if (input.conflict) return user('conflict: 冲突票')
  if (advice.verdict === 'wait' && !waitStructureOk(advice))
    return user('wait-structure-missing: question/reason/options 不全，降级 escalate')

  const effect = advice.effect ?? 'read'
  if (effect === 'destructive' || effect === 'spend' || effect === 'external')
    return user(`danger-effect: ${effect}`)
  if (effect === 'read')
    return {
      decider: 'auto',
      reason: 'effect=read（不要求判例）',
      threshold: tails(policy, 'auto'),
    }

  const score = advice.confidenceScore ?? CONFIDENCE_VALUE[advice.confidence]
  if (!advice.reversible) return user('irreversible')
  if (advice.precedentIds.length === 0) {
    // §12：无判例只对写入类是升级理由；高置信(≥0.9)可补偿无判例。
    if (effect === 'write-code' && score >= 0.9)
      return {
        decider: 'secretary',
        reason: 'no-precedent: write-code 高置信补偿(≥0.9)',
        threshold: tails(policy, 'delegated'),
      }
    return user('no-precedent: 写入类无可依判例')
  }
  if (score < 0.8) return user(`low-confidence: ${score}`)
  return {
    decider: 'secretary',
    reason: 'reversible+precedent+high-confidence',
    threshold: tails(policy, 'delegated'),
  }
}
