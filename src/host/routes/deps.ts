// 路由依赖：所有 handler 共用的数据与能力，由 index 装配后传入。

import type { Policy } from '../../shared/contract'
import type { PrecedentStore, RecordStore, SettingsStore, Store } from '../cards/store'
import type { Decision } from '../decision/runner'
import type { TurnGate } from '../gate/gate'
import type { HostRuntime } from '../host-api'
import type { KernelRuntime } from '../kernel/runtime'
import type { Presence } from '../presence'
import type { Scanner } from '../scanner/scanner'

export interface RouteDeps {
  cards: Store
  settings: SettingsStore
  /** 判例库：GET /decisions 与人的决定都写这里。 */
  precedents: PrecedentStore
  /** 调用记录：GET /decisions 只挑 phase='decision' 的那些。 */
  records: RecordStore
  /** 决策代理人：POST /decisions 的「重新出票拟」走它。 */
  decision: Decision
  log: (line: string) => void
  runtime: () => HostRuntime | null
  scanner: Scanner
  syncPreset: () => Promise<void>
  presence: Presence
  /** 内核：事件流 / 清单 / 证据 / 调度 / 对账。 */
  kernel: KernelRuntime
  /** 回合内闸门：批红发一次性放行券、拒绝清券。 */
  gate?: TurnGate
}

/** 取 query 参数：面板只传一两个参数，不值得引入解析库。 */
export function param(url: string | undefined, name: string): string {
  const parsed = new URL(url || '/', 'http://x')
  return parsed.searchParams.get(name) || ''
}

export type { Policy }
