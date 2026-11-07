// 观察者接线。
//
// 触发点：agent/status 变 idle（一个回合真的结束了）。
// 素材：本轮最后一条 assistant/message 的文本与 usage；本轮有没有用户输入。
// 观察者自己的会话必须跳过，否则它也会触发观察者。

import type { Settings } from '../../shared/contract'
import type { Store } from '../cards/store'
import { isDecisionSession } from '../decision/ids'
import type { Log, SessionEventLike } from '../host-api'
import { asNumber, asRecord, asString } from '../host-api'
import { textOf } from '../question/record'
import { isObserverSession } from './constants'
import type { Observer } from './observer'
import { messageText } from './payload'
import type { SeenTracker } from './seen'
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
  settings: () => Settings
  log: Log
  captureQuestion: (sessionId: string, data: Record<string, unknown>) => Promise<void>
  /** 每个会话「用户最后发言」的游标：观察者据此判断用户是不是已经回到原会话。 */
  seen: SeenTracker
}

interface SessionLike {
  id?: string
  header?: Record<string, unknown>
}

interface TurnState {
  hasUserInput: boolean
  lastReply: string
  usage: Record<string, number> | null
  toolCalls: number
  turn: number
  cwd: string
  turns: Array<{ user: string; assistant: string }>
}

export function observeTurns(root: RootLike, deps: TriggerDeps): void {
  const { observer, settings, log } = deps
  const tracker = new Map<string, TurnState>()

  const handlers = createHandlers({
    observer,
    settings,
    log,
    captureQuestion: deps.captureQuestion,
    tracker,
    seen: deps.seen,
  })
  root.on('session/event', handlers.onSessionEvent)
  root.on('agent/error', handlers.onAgentError)
  root.on('agent/status', handlers.onAgentStatus)
}

export interface HandlerContext {
  observer: Observer
  settings: () => Settings
  log: Log
  captureQuestion: (sessionId: string, data: Record<string, unknown>) => Promise<void>
  tracker: Map<string, TurnState>
  seen: SeenTracker
}

export interface Handlers {
  onSessionEvent: (...args: unknown[]) => void
  onAgentError: (...args: unknown[]) => void
  onAgentStatus: (...args: unknown[]) => void
}

/** 三个事件处理器：每个都自己吞异常，坏一条事件不能带倒订阅。 */
export function createHandlers(context: HandlerContext): Handlers {
  return {
    onSessionEvent: createSessionEventHandler(context),
    onAgentError: createAgentErrorHandler(context),
    onAgentStatus: createAgentStatusHandler(context),
  }
}

function createSessionEventHandler({
  observer,
  settings,
  log,
  captureQuestion,
  tracker,
  seen,
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
      // 用户回到原会话：记游标，观察者跑完时据此判断「这一轮他看过了」。
      if (event.type === 'user/message') seen.markUser(sessionId)
      if (event.type === 'user/message') rememberUserTurn(state, data, cwd)
      else if (event.type === 'assistant/message') rememberAssistantTurn(state, data)
      else if (event.type === 'tool/call') {
        state.toolCalls += 1
        if (data.name === 'ask_user_question') {
          captureQuestion(sessionId, data).catch((err: unknown) =>
            log(`问题卡写入失败：${(err as Error)?.message || String(err)}`),
          )
        }
      }
    } catch (err) {
      log(`session/event 处理失败：${(err as Error)?.message || String(err)}`)
    }
  }
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

function createAgentStatusHandler({ observer, log, tracker, seen }: HandlerContext) {
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
      if (!state || !state.hasUserInput || !state.lastReply) return
      const input = {
        originSessionId: sessionId,
        turn: state.turn,
        replyText: state.lastReply,
        turns: state.turns.slice(),
        cwd: state.cwd,
        // 回合落幕时的游标：之后用户再说的话，说明他回来了、也看过了。
        seenMark: seen.mark(sessionId),
      }
      // 本轮已消费：清掉，避免重复触发
      tracker.delete(sessionId)
      observer
        .enqueue(() => observer.run(input))
        .catch((err: unknown) => log(`观察者运行失败：${(err as Error)?.message || String(err)}`))
    } catch (err) {
      log(`agent/status 处理失败：${(err as Error)?.message || String(err)}`)
    }
  }
}

function stateOfTracker(tracker: Map<string, TurnState>, sessionId: string): TurnState {
  let state = tracker.get(sessionId)
  if (!state) {
    state = {
      hasUserInput: false,
      lastReply: '',
      usage: null,
      toolCalls: 0,
      turn: 0,
      cwd: '',
      turns: [],
    }
    tracker.set(sessionId, state)
    // 简单封顶，避免长跑宿主里无限长
    if (tracker.size > 500) {
      const oldest = tracker.keys().next().value
      if (oldest !== undefined) tracker.delete(oldest)
    }
  }
  return state
}

function rememberUserTurn(state: TurnState, data: Record<string, unknown>, cwd: string): void {
  state.hasUserInput = true
  state.lastReply = ''
  state.usage = null
  state.toolCalls = 0
  // 观察者需要「最近三轮的用户输入 + 模型最终输出」，不是只有最后一句。
  state.turns.push({ user: textOf(data), assistant: '' })
  if (state.turns.length > 3) state.turns.shift()
  if (cwd) state.cwd = cwd
}

function rememberAssistantTurn(state: TurnState, data: Record<string, unknown>): void {
  const text = messageText(data.message)
  if (text) {
    state.lastReply = text
    const latest = state.turns[state.turns.length - 1]
    if (latest) latest.assistant = text
  }
  const usage = asRecord(data.usage)
  if (Object.keys(usage).length) state.usage = usage as Record<string, number>
  const turn = asNumber(data.turn)
  if (turn !== null) state.turn = turn
}
