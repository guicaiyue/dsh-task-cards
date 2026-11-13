// 内核运行时：一次装配好，路由与调度共用同一份实例。

import type { VerificationOutcome } from '../../shared/outcome'
import type { AskStore } from '../asks/store'
import type { EvidenceStore } from '../evidence/store'
import type { ReceiptTracker } from '../execution/receipt'
import type { PlansStore } from '../plans/store'
import type { ApprovalPolicyStore } from '../policy/store'
import type { ReconcileSummary } from '../reconcile/reconcile'
import type { Scheduler } from '../scheduler/scheduler'
import type { TodoStore } from '../todo/store'
import type { Journal } from './journal'
import type { TransitionOutcome, TransitionRequest } from './transition'

export interface KernelRuntime {
  journal: Journal
  /** plans.json：plan/lease/attempt/outcome 账本（阶段 A）。 */
  plans: PlansStore
  /** approval-policy.json：分级授权策略（与工具白名单 policy.json 不同文件）。 */
  approvalPolicy: ApprovalPolicyStore
  asks: AskStore
  todo: TodoStore
  evidence: EvidenceStore
  scheduler: Scheduler
  /** 执行回执：dispatched → executed 的唯一推进入口。 */
  receipt: ReceiptTracker
  apply: (req: TransitionRequest) => Promise<TransitionOutcome>
  reconcile: () => Promise<ReconcileSummary>
  verify: (caseId: string) => Promise<VerificationOutcome | null>
}
