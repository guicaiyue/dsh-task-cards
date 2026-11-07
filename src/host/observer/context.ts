// 观察者的上下文补读：触发原话与最近卡。
//
// 宿主热重载会清空 trigger.ts 的内存 tracker，所以回合结束时再从会话日志补读
// 最近一条真人消息；同时把同会话最近几张卡带进观察者输入，供解析「这张卡」。

import type { Store } from '../cards/store'
import type { HostRuntime } from '../host-api'
import { asRecord } from '../host-api'
import { textOf } from '../question/record'
import type { RecentCard } from './payload'
import { provenanceOf } from './provenance'

export interface UiContextLike {
  tab?: string
  openCardId?: string
}

export interface PresenceLike {
  get(sessionId: string): UiContextLike | undefined
}

export async function lastHumanMessage(
  ctx: HostRuntime | null,
  sessionId: string,
): Promise<{ text: string; at?: number }> {
  try {
    const read = await ctx?.sessionQuery?.readSession(sessionId)
    const events = read?.events ?? []
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]
      if (!event || event.type !== 'user/message') continue
      const data = asRecord(event.data)
      if (provenanceOf(data).kind !== 'human') continue
      return { text: textOf(data), at: typeof event.time === 'number' ? event.time : undefined }
    }
  } catch {
    /* 读不到就退回内存里记的那条 */
  }
  return { text: '' }
}

export function recentCardsOf(cards: Store | undefined, sessionId: string): RecentCard[] {
  if (!cards) return []
  return cards
    .list()
    .filter((card) => card.origin?.sessionId === sessionId)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 8)
    .map((card) => ({ id: card.id, title: card.title, kind: card.kind, status: card.status }))
}
