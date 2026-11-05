// 路由依赖：所有 handler 共用的数据与能力，由 index 装配后传入。

import type { Policy } from '../../shared/contract'
import type { SettingsStore, Store } from '../cards/store'
import type { HostRuntime } from '../host-api'
import type { Scanner } from '../scanner/scanner'

export interface RouteDeps {
  cards: Store
  settings: SettingsStore
  log: (line: string) => void
  runtime: () => HostRuntime | null
  scanner: Scanner
  syncPreset: () => Promise<void>
}

/** 取 query 参数：面板只传一两个参数，不值得引入解析库。 */
export function param(url: string | undefined, name: string): string {
  const parsed = new URL(url || '/', 'http://x')
  return parsed.searchParams.get(name) || ''
}

export type { Policy }
