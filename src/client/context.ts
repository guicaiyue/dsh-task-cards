// 客户端插件 ctx 的最小形状：宿主注入什么，这里就声明什么。

import type { Translate } from './types'

export interface SlotOwner {
  size?: number
}

export interface ClientContext {
  effect(fn: () => (() => void) | undefined, label: string): unknown
  locale: {
    register(namespace: string, dict: Record<string, Record<string, string>>): unknown
    bind(namespace: string): Translate
  }
  slots: {
    inject(name: string, callback: () => void): unknown
    register(spec: Record<string, unknown>, component: (owner?: SlotOwner) => unknown): unknown
  }
  uiWorkspace?: { openSession?: (sessionId: string) => void }
}
