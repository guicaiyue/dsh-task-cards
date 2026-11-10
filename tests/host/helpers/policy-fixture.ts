import type { ApprovalPolicy } from '../../../src/host/policy/store'
import { DEFAULT_TIERS } from '../../../src/host/policy/store'

export function budgetPolicy(over: Partial<ApprovalPolicy> = {}): ApprovalPolicy {
  return { version: 3, tiers: DEFAULT_TIERS, updatedAt: 1, ...over }
}
