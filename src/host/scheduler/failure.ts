// 派发失败处理（从 scheduler 拆出，控制单文件行数）：
// 必落 attempt、永久/上限停止并升级人工、否则退避重排。

import type { ApprovedPlan, Card } from '../../shared/contract'
import type { Log } from '../host-api'
import type { PlansStore } from '../plans/store'
import { failuresOf, isPermanentError, shouldStopRetry } from './retry'

export interface FailureDeps {
  plans?: PlansStore
  now?: () => number
  log: Log
  createCard: (title: string, options: Record<string, unknown>) => Promise<unknown>
  move: (
    cardId: string,
    to: NonNullable<Card['deliveryState']>,
    waitReason: Card['waitReason'],
    reason: string,
  ) => Promise<void>
}

export interface FailureOutcome {
  error?: string
  permanent?: boolean
}

export async function handleFailure(
  deps: FailureDeps,
  card: Card,
  plan: ApprovedPlan | null | undefined,
  dispatchKey: string,
  outcome: FailureOutcome,
): Promise<void> {
  const now = deps.now ?? Date.now
  const permanent = outcome.permanent === true || isPermanentError(outcome.error)
  if (plan) {
    await deps.plans?.recordAttempt(plan.id, {
      id: dispatchKey,
      at: now(),
      sessionId: card.origin?.sessionId ?? null,
      result: 'failed',
      detail: `${permanent ? 'permanent: ' : ''}${outcome.error ?? 'unknown'}`,
    })
    await deps.plans?.setLease(plan.id, null)
  }
  // 重新读 plan：上限判定必须包含刚写入的这一次失败。
  const latest = plan ? (deps.plans?.byCard(plan.cardId) ?? plan) : null
  const active = latest ?? plan
  if (!active) {
    await deps.move(card.id, 'waiting', 'retrying', `派发失败：${outcome.error ?? 'unknown'}`)
    return
  }
  if (shouldStopRetry(active, permanent, now())) {
    if (active) await deps.plans?.markFailed(active.id, outcome.error ?? 'unknown')
    await deps
      .move(
        card.id,
        'waiting',
        'retry-exhausted',
        `执行失败后停止重试：${outcome.error ?? 'unknown'}`,
      )
      .catch(() => undefined)
    await escalate(
      deps,
      card,
      outcome.error ?? 'unknown',
      permanent ? 1 : failuresOf(active as never),
    )
    return
  }
  await deps.move(
    card.id,
    'waiting',
    'retrying',
    `派发失败（第 ${active ? failuresOf(active) : 1} 次，退避后重试）：${outcome.error ?? 'unknown'}`,
  )
}

/** 重试耗尽/永久失败：建一张升级卡给人工决定「继续/缩小/终止」。 */
export async function escalate(
  deps: FailureDeps,
  card: Card,
  reason: string,
  failures: number,
): Promise<void> {
  const title = `执行失败 ${failures} 次：${card.title}`
  await deps
    .createCard(title, {
      kind: 'decision',
      severity: 'high',
      detail: `这张卡执行失败 ${failures} 次。原因：${reason}。请决定：继续 / 缩小范围 / 终止。`,
      ask: 'permission',
      ...(card.origin ? { origin: card.origin } : {}),
    })
    .catch((err: unknown) => deps.log(`升级卡创建失败：${(err as Error)?.message}`))
}
