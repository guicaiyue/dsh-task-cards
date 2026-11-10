// 委派票的记录钩子：把 Decision 的 plans/policy 依赖压成两个窄函数，runner 不膨胀。

import type { Verdict } from '../../shared/contract'
import type { ApprovalPolicy } from '../policy/store'

export interface VerdictHook {
  readPolicy?: () => unknown
  record?: (verdict: Verdict) => Promise<unknown>
}

export function verdictApplyDeps(hook: VerdictHook | undefined): {
  policy?: ApprovalPolicy
  recordVerdict?: (verdict: Verdict) => Promise<unknown>
} {
  if (!hook) return {}
  const raw = hook.readPolicy?.()
  const policy = raw ? (raw as ApprovalPolicy) : undefined
  return {
    ...(policy ? { policy } : {}),
    ...(hook.record ? { recordVerdict: hook.record } : {}),
  }
}
