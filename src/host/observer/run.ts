// 跑一次观察者：把一轮素材变成 observer.run 的输入。
//
// 触发端（回合结束）与兜底端（定时补观察）共用这一份构造器，避免两处输入漂移。

import type { Store } from '../cards/store'
import type { HostRuntime, Log } from '../host-api'
import { lastHumanMessage, type PresenceLike, recentCardsOf } from './context'
import type { Observer } from './observer'
import type { SeenTracker } from './seen'
import type { TurnState } from './turns'

export interface RunObservationDeps {
  observer: Observer
  log: Log
  seen: SeenTracker
  getCtx?: () => HostRuntime | null
  cards?: Store
  presence?: PresenceLike
}

export type RunObservation = (sessionId: string, state: TurnState, why: string) => Promise<boolean>

/** 返回「是否真的跑过一次观察者」（observer.run 按规则不跑时返回 null）。 */
export function createRunObservation(deps: RunObservationDeps): RunObservation {
  const { observer, log, seen, getCtx, cards, presence } = deps
  return (sessionId: string, state: TurnState, why: string): Promise<boolean> => {
    const snapshot = { ...state, turns: state.turns.slice() }
    return observer
      .enqueue(async () => {
        // 宿主热重载会清空内存 tracker：回合落幕时再从会话日志补读最近一条真人消息。
        const durable = await lastHumanMessage(getCtx?.() ?? null, sessionId)
        const record = await observer.run({
          originSessionId: sessionId,
          turn: snapshot.turn,
          replyText: snapshot.lastReply,
          turns: snapshot.turns,
          cwd: snapshot.cwd,
          // 回合落幕时的游标：之后用户再说的话，说明他回来了、也看过了。
          seenMark: seen.mark(sessionId),
          triggerMessage: snapshot.lastIncomingText || snapshot.lastHumanQuote || durable.text,
          triggerUserMessage: snapshot.lastHumanQuote || durable.text,
          triggerUserAt: snapshot.lastHumanAt ?? durable.at,
          triggerSourceKind: snapshot.lastIncomingKind,
          triggerCardId: snapshot.lastIncomingCardId,
          ui: presence?.get(sessionId),
          recentCards: recentCardsOf(cards, sessionId),
        })
        return record !== null
      })
      .catch((err: unknown) => {
        log(`观察者运行失败（${why}）：${(err as Error)?.message || String(err)}`)
        return false
      })
  }
}
