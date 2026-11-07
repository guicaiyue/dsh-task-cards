// 面板在线上下文：当前页签、当前打开的卡。
//
// 只存 id 和页签名，不存卡片正文；10 分钟没心跳就视为过期。
// 用途：观察者/决策者解析「这张卡」这类指代，不再问用户「是哪张卡」。

import type { PresenceLike, UiContextLike } from './observer/context'

const TTL_MS = 10 * 60 * 1000

interface Entry {
  context: UiContextLike
  at: number
}

export class Presence implements PresenceLike {
  #map = new Map<string, Entry>()

  set(sessionId: string, context: UiContextLike): void {
    if (!sessionId) return
    this.#map.set(sessionId, { context, at: Date.now() })
    if (this.#map.size > 200) {
      const oldest = this.#map.keys().next().value
      if (oldest !== undefined) this.#map.delete(oldest)
    }
  }

  get(sessionId: string): UiContextLike | undefined {
    const entry = this.#map.get(sessionId)
    if (!entry) return undefined
    if (Date.now() - entry.at > TTL_MS) {
      this.#map.delete(sessionId)
      return undefined
    }
    return entry.context
  }

  clear(sessionId: string): void {
    if (sessionId) this.#map.delete(sessionId)
  }
}
