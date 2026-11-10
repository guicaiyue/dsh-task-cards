// 批准时创建 ApprovedPlan（阶段 C：调度消费计划，不再直接消费卡）。

import type { Card, Effect } from '../../shared/contract'
import { messageOf } from './action'
import type { RouteDeps } from './deps'

/** 阶段 C：批准时把计划写进 plans.json（幂等键 plan 级，同 key 不重复创建）。 */
export async function ensureApprovedPlan(
  deps: RouteDeps,
  card: Card,
  instruction: string,
): Promise<void> {
  const planId = card.planId ?? `${card.id}:${card.decisionSeq ?? 0}`
  const idempotencyKey = `plan:${planId}`
  if (deps.kernel.plans.byIdempotencyKey(idempotencyKey)) return
  const effect = (card.advice?.effect ?? card.gate?.effect ?? 'read') as Effect
  const dependsOn = resolvePlanDeps(deps, card, planId)
  await deps.kernel.plans
    .upsert({
      id: planId,
      cardId: card.id,
      sessionId: card.origin?.sessionId ?? '',
      instruction,
      effect,
      acceptance: card.acceptance ?? [],
      executionMode: 'dispatch',
      priority: 0,
      dependsOn,
      idempotencyKey,
      lease: null,
      attempts: [],
      cancelled: false,
      failed: false,
    })
    .catch((err: unknown) => deps.log(`计划写入失败：${messageOf(err)}`))
}

/** 卡片级依赖 → plan 依赖：只允许同 origin 会话、目标已批准；成环的边拒绝并记日志。 */
export function resolvePlanDeps(
  deps: Pick<RouteDeps, 'cards' | 'kernel' | 'log'>,
  card: Card,
  planId: string,
): string[] {
  const refs = new Set([...(card.blockedBy ?? []), ...(card.advice?.dependsOn ?? [])])
  const session = card.origin?.sessionId ?? ''
  const result: string[] = []
  for (const ref of refs) {
    if (ref === card.id || !ref) continue
    const target = deps.cards.find(ref)
    if (!target) {
      deps.log(`依赖映射：忽略不存在的卡 ${ref}`)
      continue
    }
    if ((target.origin?.sessionId ?? '') !== session) {
      deps.log(`依赖映射：忽略跨会话依赖 ${ref}（只允许同会话）`)
      continue
    }
    const plan = deps.kernel.plans.byCard(ref)
    if (!plan) {
      deps.log(`依赖映射：目标卡 ${ref} 尚未批准，跳过依赖`)
      continue
    }
    if (createsCycle(deps, planId, plan.id, result)) {
      deps.log(`依赖映射：拒绝成环依赖 ${ref}（${planId} → ${plan.id}）`)
      continue
    }
    result.push(plan.id)
  }
  return result
}

/** 从 planId 出发沿已有 dependsOn 走，能到 target 说明加了这条边会成环。 */
function createsCycle(
  deps: Pick<RouteDeps, 'kernel'>,
  planId: string,
  targetId: string,
  accepted: string[],
): boolean {
  const seen = new Set<string>()
  const stack = [targetId]
  while (stack.length) {
    const current = stack.pop() as string
    if (current === planId) return true
    if (seen.has(current)) continue
    seen.add(current)
    const plan = deps.kernel.plans.get(current)
    for (const dep of plan?.dependsOn ?? []) stack.push(dep)
    for (const dep of accepted) if (dep === current) return true
  }
  return false
}
