// 决策代理人的公开选项/结果类型（从 runner 拆出，控制单文件行数）。

import type { Verdict } from '../../shared/contract'
import type { PrecedentStore, RecordStore, SettingsStore, Store } from '../cards/store'
import type { HostRuntime, Log } from '../host-api'

export interface DecisionRunResult {
  ok: boolean
  advised: number
  applied: number
  attempts: number
  sessionId: string
  reason?: string
}

export interface DecisionOptions {
  getCtx: () => HostRuntime | null
  settings: SettingsStore
  cards: Store
  precedents: PrecedentStore
  records: RecordStore
  /** 阶段 B：delegated Verdict 账本与审批策略（可选；缺失则不记录）。 */
  plans?: { recordVerdict(verdict: Verdict): Promise<unknown> }
  approvalPolicy?: { read(): unknown }
  log?: Log
}
