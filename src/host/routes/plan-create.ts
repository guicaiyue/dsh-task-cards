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
      dependsOn: [],
      idempotencyKey,
      lease: null,
      attempts: [],
      cancelled: false,
      failed: false,
    })
    .catch((err: unknown) => deps.log(`计划写入失败：${messageOf(err)}`))
}
