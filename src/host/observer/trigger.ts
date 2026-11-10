// 观察者接线。
//
// 触发点：agent/status 变 idle（一个回合真的结束了）。
// 素材：本轮最后一条 assistant/message、来源（真人/系统代发）、触发原话、UI 上下文。
// 关键约束：time-context 心跳不占「用户轮次」；卡片答复是系统代发，不是用户原话。

import type { Settings } from '../../shared/contract'
import type { RecordStore, Store } from '../cards/store'
import { isDecisionSession } from '../decision/ids'
import type { TurnGate } from '../gate/gate'
import type { HostRuntime, Log, SessionEventLike } from '../host-api'
import { asRecord, asString } from '../host-api'
import { isObserverSession } from './constants'
import type { PresenceLike } from './context'
import { FallbackSweeper } from './fallback'
import type { Observer } from './observer'
import { provenanceOf } from './provenance'
import { createRunObservation, type RunObservation } from './run'
import { markRecentInfoCardsSeen, type SeenTracker } from './seen'
import { rememberAssistantTurn, rememberIncoming, stateOfTracker, type TurnState } from './turns'
import { observerWorkspace } from './workspace'

export interface RootLike {
  on(type: string, handler: (...args: unknown[]) => void): unknown
}

/** 插件用到的 root 能力：注入服务、注册清理、订阅事件。 */
export interface PluginRoot extends RootLike {
  inject(names: string[], callback: (ctx: unknown) => void): unknown
  effect(fn: () => (() => void) | undefined, label: string): unknown
}

export interface TriggerDeps {
  observer: Observer
  cards: Store
  /** 观察者 / 决策的运行记录：跳过也要写一条（records.status='skipped'）。 */
  records: RecordStore
  /** 回合内闸门：宿主没有前置钩子时，靠这里的 tool/call 降级建卡。 */
  gate?: TurnGate
  settings: () => Settings
  log: Log
  captureQuestion: (sessionId: string, data: Record<string, unknown>) => Promise<void>
  /** 每个会话「用户最后发言」的游标：观察者据此判断用户是不是已经回到原会话。 */
  seen: SeenTracker
  /** 宿主运行时：用于从会话日志里补读触发原话。 */
  getCtx?: () => HostRuntime | null
  /** 面板在线上下文：当前打开的卡 / 页签。 */
  presence?: PresenceLike
}

interface SessionLike {
  id?: string
  header?: Record<string, unknown>
}

/**
 * 回合累积状态放进程级全局（按 Symbol 复用）：热重载会重跑 observeTurns，
 * tracker 若是局部变量，重载后前几轮素材全丢、回合结束被判「没有输入」而跳过。
 */
const TRACKER_KEY = Symbol.for('dsh-task-cards.turn-tracker')

function sharedTracker(): Map<string, TurnState> {
  const bag = globalThis as unknown as Record<symbol, Map<string, TurnState> | undefined>
  const existing = bag[TRACKER_KEY]
  if (existing) return existing
  const created = new Map<string, TurnState>()
  bag[TRACKER_KEY] = created
  return created
}

export function observeTurns(root: PluginRoot, deps: TriggerDeps): void {
  const { observer, settings, log, getCtx, cards, presence, records } = deps
  const tracker = sharedTracker()
  const observe = createRunObservation({ observer, log, seen: deps.seen, getCtx, cards, presence })
  const context: HandlerContext = {
    observer,
    settings,
    log,
    captureQuestion: deps.captureQuestion,
    tracker,
    seen: deps.seen,
    getCtx,
    cards,
    presence,
    observe,
    ...(deps.gate ? { gate: deps.gate } : {}),
  }
  // 兜底：正常触发漏了/坏了/被跳过时，30s 扫一次，必要时从会话日志重建素材。
  context.fallback = new FallbackSweeper({
    settings,
    tracker: () => tracker,
    records,
    log,
    readSession: async (sessionId) => {
      const read = await getCtx?.()?.sessionQuery?.readSession(sessionId)
      return read?.events ?? null
    },
    observe,
  })
  const handlers = createHandlers(context)
  root.on('session/event', handlers.onSessionEvent)
  root.on('agent/error', handlers.onAgentError)
  root.on('agent/status', handlers.onAgentStatus)
  context.fallback.start()
  root.effect(() => () => context.fallback?.stop(), 'dsh-task-cards: observer fallback')
}

export interface HandlerContext {
  observer: Observer
  settings: () => Settings
  log: Log
  captureQuestion: (sessionId: string, data: Record<string, unknown>) => Promise<void>
  tracker: Map<string, TurnState>
  seen: SeenTracker
  getCtx?: () => HostRuntime | null
  cards?: Store
  presence?: PresenceLike
  /** 跑一次观察（触发端与兜底共用）；不传时由 createHandlers 就地构造。 */
  observe?: RunObservation
  fallback?: FallbackSweeper
  gate?: TurnGate
}

export interface Handlers {
  onSessionEvent: (...args: unknown[]) => void
  onAgentError: (...args: unknown[]) => void
  onAgentStatus: (...args: unknown[]) => void
}

/** 三个事件处理器：每个都自己吞异常，坏一条事件不能带倒订阅。 */
export function createHandlers(context: HandlerContext): Handlers {
  const observe =
    context.observe ??
    createRunObservation({
      observer: context.observer,
      log: context.log,
      seen: context.seen,
      ...(context.getCtx ? { getCtx: context.getCtx } : {}),
      ...(context.cards ? { cards: context.cards } : {}),
      ...(context.presence ? { presence: context.presence } : {}),
    })
  const full: HandlerContext = { ...context, observe }
  return {
    onSessionEvent: createSessionEventHandler(full),
    onAgentError: createAgentErrorHandler(full),
    onAgentStatus: createAgentStatusHandler(full),
  }
}

/** 真人回来：记游标，并把可能晚到的消息之前已落盘的通知补成已读。 */
function markHumanSeen(
  cards: HandlerContext['cards'],
  seen: SeenTracker,
  sessionId: string,
  data: Record<string, unknown>,
  log: Log,
): void {
  if (provenanceOf(data).kind !== 'human') return
  seen.markUser(sessionId)
  if (!cards) return
  markRecentInfoCardsSeen(cards, sessionId).catch((err: unknown) =>
    log(`补标已读失败：${(err as Error)?.message || String(err)}`),
  )
}

function createSessionEventHandler({
  observer,
  settings,
  log,
  captureQuestion,
  tracker,
  seen,
  cards,
  gate,
  getCtx,
}: HandlerContext) {
  return (...args: unknown[]) => {
    try {
      const session = asRecord(args[0]) as SessionLike
      const event = asRecord(args[1]) as unknown as SessionEventLike
      const sessionId = session.id
      if (!sessionId) return
      if (isObserverSession(sessionId)) {
        observer.waiter.acceptEvent(sessionId, {
          type: String(event.type ?? ''),
          data: asRecord(event.data),
        })
        return
      }
      // 决策会话的输出是给面板的票拟 JSON，不是用户的一轮：同样不许被观察。
      if (isDecisionSession(sessionId)) return
      // 只认「人发起的顶层会话」：子代理是模型的内部动作，不是用户的一轮。
      const header = asRecord(session.header)
      const isChild = !!header.parentSession || Number(header.delegationDepth ?? 0) > 0
      if (isChild && !settings().includeSubagents) return
      // 观察者自己的工作区里跑的东西，一律不观察（按 cwd 再兜一层）。
      const cwd = asString(header.cwd)
      if (cwd && cwd === observerWorkspace()) return

      const state = stateOfTracker(tracker, sessionId)
      const data = asRecord(event.data)
      state.lastEventAt = event.time ?? Date.now()
      // 宿主按 ctx 作用域过滤 listener：把闸门也挂到该会话的 agent 作用域。
      if (gate) gate.attachAgent(sessionId, getCtx?.() ?? null)
      if (event.type === 'user/message') rememberIncoming(state, data, cwd, event.time)
      else if (event.type === 'assistant/message') rememberAssistantTurn(state, data)
      else if (event.type === 'tool/call') {
        state.toolCalls += 1
        // 闸门：回调一次都没进来 = 本宿主前置拦截不可达 → 诚实降级为只建卡。
        gate?.onToolCallObserved(sessionId, data)
        if (data.name === 'ask_user_question') {
          captureQuestion(sessionId, data).catch((err: unknown) =>
            log(`问题卡写入失败：${(err as Error)?.message || String(err)}`),
          )
        }
      }
      // 真人回到原会话：只记人类消息。卡片答复是系统替用户发的，不算「他看过」。
      if (event.type === 'user/message') markHumanSeen(cards, seen, sessionId, data, log)
    } catch (err) {
      log(`session/event 处理失败：${(err as Error)?.message || String(err)}`)
    }
  }
}

/**
 * 回合结束时累积状态是否可用。不可用时返回原因（并让调用方记一行日志）：
 * 长回合/坏回合/连发回合都可能让累积状态缺失，以前静默返回，事后查不出原因。
 */
function skipReason(
  state: TurnState | undefined,
  log: (line: string) => void,
  sessionId: string,
): string | null {
  const reason = !state
    ? '没有累积状态'
    : !state.hasTurnTrigger
      ? '没有轮次触发器'
      : !state.lastReply
        ? '没有最终回复'
        : null
  if (reason) log(`观察者跳过：${sessionId} 回合 ${state?.turn ?? '?'}（${reason}）`)
  return reason
}

function createAgentErrorHandler({ observer }: HandlerContext) {
  return (...args: unknown[]) => {
    try {
      const payload = asRecord(args[0])
      const sessionId = asString(asRecord(payload.agent).sessionId)
      const detail = String(asRecord(payload.error).message ?? payload.error ?? '')
      // 观察者会话报错时立刻失败，不要白等一整个超时；非观察者的报错不记（宿主自己会记）。
      if (sessionId && isObserverSession(sessionId))
        observer.waiter.cancel(sessionId, `观察者会话报错：${detail}`)
    } catch {
      /* 报错处理本身失败就当没收到 */
    }
  }
}

function createAgentStatusHandler({ observer, log, tracker, fallback, observe }: HandlerContext) {
  return (...args: unknown[]) => {
    try {
      const payload = asRecord(args[0])
      const agent = asRecord(payload.agent)
      const sessionId = asString(agent.id) || asString(agent.sessionId)
      if (!sessionId) return
      const status = asString(payload.status)
      if (isObserverSession(sessionId)) {
        if (status === 'idle') observer.waiter.finish(sessionId)
        return
      }
      // 决策会话的 waiter 由 wire.ts 单独路由，这里不碰。
      if (isDecisionSession(sessionId)) return
      if (status !== 'idle') return
      const state = tracker.get(sessionId)
      const reason = skipReason(state, log, sessionId)
      // 跳过不再静默：写 records(skipped)，并交给兜底稍后试着补一次。
      if (reason || !state) {
        fallback
          ?.noteSkip(sessionId, state, reason ?? '没有累积状态')
          .catch((err: unknown) => log(`跳过记录失败：${(err as Error)?.message || String(err)}`))
        return
      }
      // 本轮已消费：清掉，避免重复触发；兜底也不再补这一轮。
      tracker.delete(sessionId)
      observe?.(sessionId, state, 'turn-idle')
        .then((ran) => {
          if (ran) fallback?.markObserved(sessionId, state)
        })
        .catch((err: unknown) => {
          log(`观察者运行失败：${(err as Error)?.message || String(err)}`)
          fallback?.noteSkip(sessionId, state, '观察者运行失败')
        })
    } catch (err) {
      log(`agent/status 处理失败：${(err as Error)?.message || String(err)}`)
    }
  }
}
