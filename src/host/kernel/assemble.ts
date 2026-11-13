// 内核装配：把 journal / todo / evidence / scheduler / reconcile 组成一份运行时。
//
// 装配细节从这里出去之后，index.ts 只负责「接线」，函数长度也回到预算内。

import path from 'node:path'

import type { Card } from '../../shared/contract'
import { AskStore } from '../asks/store'
import type { Store } from '../cards/store'
import { EvidenceStore, evidenceDirOf } from '../evidence/store'
import { ReceiptTracker } from '../execution/receipt'
import { createSessionAdapter } from '../execution/session'
import type { HostRuntime, Log } from '../host-api'
import { PlansStore } from '../plans/store'
import { APPROVAL_POLICY_FILE, ApprovalPolicyStore } from '../policy/store'
import { reconcileCards } from '../reconcile/reconcile'
import { Admission } from '../scheduler/admission'
import { Scheduler } from '../scheduler/scheduler'
import { TodoStore, todoDirOf } from '../todo/store'
import { Verifier } from '../verification/verifier'
import { repairLifecycleDrift } from './drift'
import { verifyEnabled } from './flags'
import { Journal } from './journal'
import type { KernelRuntime } from './runtime'
import { applyTransition } from './transition'

export interface AssembleOptions {
  cards: Store
  log: Log
  getCtx: () => HostRuntime | null
  /** 设置读取（回执 TTL 等可调项）；测试可不传。 */
  settings?: () => { receiptTimeoutMs?: number; fallbackObserve?: boolean }
}

async function verifyWithPlan(verifier: Verifier, plans: PlansStore, caseId: string, log: Log) {
  const outcome = await verifier.verify(caseId)
  if (!outcome) return outcome
  const plan = plans.byCard(caseId)
  if (plan)
    await plans
      .recordOutcome({
        planId: plan.id,
        verified: outcome.verified,
        criteriaResults: outcome.criteria ?? [],
        verifier: 'machine',
        confidence: outcome.verified === 'confirmed' ? 1 : 0,
        at: Date.now(),
      } as never)
      .catch((err: unknown) => log(`验收结论写入失败：${(err as Error)?.message}`))
  return outcome
}

export function assembleKernel({ cards, log, getCtx, settings }: AssembleOptions): KernelRuntime {
  const journal = new Journal(`${cards.file}.journal`)
  const dataDir = path.dirname(cards.file)
  // 阶段 A 三账分离：plans.json 与 approval-policy.json（后者刻意与工具白名单 policy.json 不同名）。
  const plans = new PlansStore(path.join(dataDir, 'plans.json'))
  const asks = new AskStore(path.join(dataDir, 'asks.json'))
  const approvalPolicy = new ApprovalPolicyStore(path.join(dataDir, APPROVAL_POLICY_FILE))
  const todo = new TodoStore({ dir: todoDirOf(cards.file), log })
  const evidence = new EvidenceStore({ dir: evidenceDirOf(cards.file), log })
  const verifier = new Verifier({
    cards,
    journal,
    todo,
    evidence,
    apply: (req) => applyTransition({ cards, journal }, req),
    log,
  })
  // 阶段 C：验收结论落 plans.json（Outcome 绑 planId）。
  const verify = (caseId: string) => verifyWithPlan(verifier, plans, caseId, log)
  // 回执：派发之后等 origin 会话下一次 idle；DTC_VERIFY=on 时才在回执后自动验收。
  const receipt = new ReceiptTracker({
    cards,
    journal,
    apply: (req) => applyTransition({ cards, journal }, req),
    ...(verifyEnabled() ? { verify } : {}),
    ...(settings ? { settings } : {}),
    log,
  })
  const kernel: KernelRuntime = {
    journal,
    plans,
    asks,
    approvalPolicy,
    todo,
    evidence,
    receipt,
    scheduler: new Scheduler({
      cards,
      journal,
      getCards: () => cards.list(),
      adapter: createSessionAdapter({ getCtx, log }),
      log,
      admission: new Admission(),
      receipt,
      plans,
    }),
    apply: (req) => applyTransition({ cards, journal }, req),
    reconcile: async () => {
      // 对账先修生命周期漂移，再按事实失效；两件事都不改人的主动决定。
      await repairLifecycleDrift({ cards, log })
      return reconcileCards({ getCards: () => cards.list(), apply: kernel.apply, log })
    },
    verify,
  }
  return kernel
}

/** 派发候选（测试与面板复用）：过滤可派卡并按优先级排序。 */
export function candidatesOf(cards: readonly Card[]): Card[] {
  return cards.filter((card) => card.deliveryState === 'waiting')
}
