// 重试策略（阶段 C/D 收口）：每 plan 最多 3 次，指数退避 2s/10s/60s，永久失败不重试。

import type { ApprovedPlan } from '../../shared/contract'

export const MAX_ATTEMPTS = 3
/** 第 n 次失败后的等待间隔（n=1 → 2s，n=2 → 10s，n=3 → 60s）。 */
export const BACKOFF_MS = [2_000, 10_000, 60_000] as const

export function failuresOf(plan: ApprovedPlan): number {
  return plan.attempts.filter((attempt) => attempt.result === 'failed').length
}

export function lastFailureAt(plan: ApprovedPlan): number {
  const failed = plan.attempts.filter((attempt) => attempt.result === 'failed')
  return failed.reduce((max, attempt) => Math.max(max, attempt.at), 0)
}

export function nextRetryAt(plan: ApprovedPlan): number {
  const failures = failuresOf(plan)
  if (!failures) return 0
  const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1] ?? 60_000
  return lastFailureAt(plan) + wait
}

/** 解析适配器错误串，判断是否为永久失败（会话不可恢复等）。 */
export function isPermanentError(error: string | undefined): boolean {
  return /无法恢复为 agent|NO_AGENT|NO_SESSION|no-session|resolveAgent|resolve|permanent/i.test(
    error ?? '',
  )
}

/** 这次失败是否应停止重试：达到上限、永久失败、plan 已取消。 */
export function shouldStopRetry(plan: ApprovedPlan, permanent: boolean, now: number): boolean {
  return plan.cancelled || permanent || failuresOf(plan) >= MAX_ATTEMPTS || now < 0
}
