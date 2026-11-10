// 装配：把插件各部分接到宿主 root 上。index.ts 只负责按顺序调用这里。

import type { Card } from '../shared/contract'
import type { PrecedentStore, RecordStore, SettingsStore, Store } from './cards/store'
import { drainPendingDecisions } from './decision/drain'
import { isDecisionSession } from './decision/ids'
import { recordChoice } from './decision/precedent'
import { registerDecisionPreset } from './decision/preset'
import { Decision } from './decision/runner'
import type { TurnGate } from './gate/gate'
import type { HostRuntime, Log } from './host-api'
import { asRecord, asString } from './host-api'
import type { KernelRuntime } from './kernel/runtime'
import { Observer } from './observer/observer'
import { registerObserverPreset } from './observer/preset'
import { SeenTracker } from './observer/seen'
import { observeTurns, type PluginRoot } from './observer/trigger'
import type { Presence } from './presence'
import { installQuestionHook } from './question/hook'
import { captureQuestion, recordChatAnswer, recordQuestionCard } from './question/record'
import { registerRoutes, type WebServerLike } from './routes/register'
import { Scanner } from './scanner/scanner'

export interface PluginState {
  runtime: HostRuntime | null
  presetCtx: Parameters<typeof registerObserverPreset>[0] | null
  disposeQuestionHook: () => void
}

export interface WireDeps {
  cards: Store
  settings: SettingsStore
  records: RecordStore
  precedents: PrecedentStore
  log: Log
  state: PluginState
  presence: Presence
  kernel: KernelRuntime
  /** 回合内闸门（危险动作前置拦截）。 */
  gate: TurnGate
}

const RUNTIME_SERVICES = [
  'agents',
  'sessionController',
  'agentDefaultModel',
  'agentPresets',
  'workspaceRegistry',
  'userQuestions',
  'sessionQuery',
]

/** 问题建卡：runtime 就绪后装钩子（apply 主体无论如何都会跑到）。 */
export function wireQuestionHook(
  root: PluginRoot,
  { cards, precedents, log, state }: WireDeps,
): void {
  root.inject(RUNTIME_SERVICES, (ctx: unknown) => {
    const runtime = ctx as HostRuntime
    state.runtime = runtime
    try {
      state.disposeQuestionHook = installQuestionHook(
        runtime,
        log,
        (request) => {
          recordQuestionCard(cards, log, request, state.runtime).catch(() => {})
        },
        (request, answer) => {
          // 聊天里做的决定也是判例：先回写卡，再按卡上的回答落一条。
          recordChatAnswer(cards, request, answer)
            .then(async (answered) => {
              for (const card of answered)
                await recordChoice(precedents, card, card.answer || '').catch(() => undefined)
            })
            .catch(() => undefined)
        },
      )
      log(`提问建卡已安装：ask=${typeof runtime.userQuestions?.ask}`)
    } catch (err) {
      log(`提问建卡安装失败：${(err as Error)?.message || String(err)}`)
    }
  })
  root.effect(() => () => state.disposeQuestionHook(), 'dsh-task-cards: question hook')
}

/** 决策会话自己的事件路由：观察者的 waiter 只认 card-obs-，这里认 card-dec-。 */
function routeDecisionEvents(root: PluginRoot, decision: Decision): void {
  const sessionIdOf = (args: unknown[]): string => asString(asRecord(args[0]).id)
  root.on('session/event', (...args: unknown[]) => {
    try {
      const sessionId = sessionIdOf(args)
      if (!isDecisionSession(sessionId)) return
      const event = asRecord(args[1])
      decision.waiter.acceptEvent(sessionId, {
        type: String(event.type ?? ''),
        data: asRecord(event.data),
      })
    } catch {
      /* 坏一条事件不能带倒订阅 */
    }
  })
  root.on('agent/status', (...args: unknown[]) => {
    try {
      const payload = asRecord(args[0])
      const agent = asRecord(payload.agent)
      const sessionId = asString(agent.id) || asString(agent.sessionId)
      if (!isDecisionSession(sessionId)) return
      if (asString(payload.status) === 'idle') decision.waiter.finish(sessionId)
    } catch {
      /* 同上 */
    }
  })
  root.on('agent/error', (...args: unknown[]) => {
    try {
      const agent = asRecord(asRecord(args[0]).agent)
      const sessionId = asString(agent.sessionId) || asString(agent.id)
      if (!isDecisionSession(sessionId)) return
      decision.waiter.cancel(sessionId, '决策会话报错')
    } catch {
      /* 同上 */
    }
  })
}

/** 决策代理人：串行排队，观察者建完卡后接手。 */
export function wireDecision(root: PluginRoot, deps: WireDeps): Decision {
  const { cards, settings, precedents, records, log, state } = deps
  const decision = new Decision({
    getCtx: () => state.runtime,
    settings,
    cards,
    precedents,
    // 决策每次运行都往这里落一条 phase='decision' 记录（面板的执行记录）。
    records,
    // 阶段 B：delegated 票写 plans.json verdicts；路由读自愈后的审批策略。
    plans: deps.kernel.plans,
    approvalPolicy: deps.kernel.approvalPolicy,
    log: (line: string) => log(`decision: ${line}`),
  })
  routeDecisionEvents(root, decision)
  // 水平触发排水：补派「无票拟」的 pending_secretary（手动建卡/迁移卡/重启后）。
  const timer = setInterval(() => {
    try {
      drainPendingDecisions({
        cards,
        enqueue: (list) => decision.enqueueCards(list),
        settings: () => settings.get(),
        log,
      })
    } catch (err) {
      log(`决策排水失败：${(err as Error)?.message || String(err)}`)
    }
  }, 30_000)
  timer.unref?.()
  root.effect(() => () => clearInterval(timer), 'dsh-task-cards: decision drain')
  return decision
}

/** 回合内闸门接线：危险动作在工具执行前就被拦住（含降级路径）。 */
export function wireTurnGate(root: PluginRoot, deps: WireDeps): TurnGate {
  deps.gate.attach(root)
  return deps.gate
}

/** 观察者 + 触发接线；建卡成功后把这一批卡交给决策阶段。 */
export function wireObserver(root: PluginRoot, deps: WireDeps, decision: Decision): Observer {
  const { cards, settings, records, log, state, presence, gate } = deps
  // 触发端记「用户最后发言」的游标，观察者建卡时据此判断这批内容他是不是已经看过。
  const seen = new SeenTracker()
  const observer = new Observer({
    getCtx: () => state.runtime,
    settings,
    cards,
    records,
    log,
    onCardsCreated: (created: Card[]) => {
      if (!settings.get().decisionEnabled) return
      decision.enqueueCards(created)
    },
    seenSince: (sessionId, mark) => seen.seenSince(sessionId, mark),
  })
  observeTurns(root, {
    observer,
    cards,
    records,
    gate,
    settings: () => settings.get(),
    log,
    captureQuestion: (sessionId, data) => captureQuestion(cards, log, sessionId, data),
    seen,
    getCtx: () => state.runtime,
    presence,
  })
  return observer
}

/** 定时扫描器。 */
export function wireScanner(root: PluginRoot, deps: WireDeps): Scanner {
  const { cards, log, state } = deps
  const scanner = new Scanner({ getCtx: () => state.runtime, cards, log })
  scanner.start()
  root.effect(() => () => scanner.stop(), 'dsh-task-cards: scanner')
  return scanner
}

/** 两个 preset（观察者 / 决策代理人）：注册失败不挡主流程。 */
export function wirePreset(root: PluginRoot, deps: WireDeps): () => Promise<void> {
  const { log, state } = deps
  const syncPreset = async () => {
    const ctx = state.presetCtx
    if (!ctx) return
    await registerObserverPreset(ctx, log)
    await registerDecisionPreset(ctx, log)
  }
  root.inject(['agentPresets'], (ctx: unknown) => {
    state.presetCtx = ctx as PluginState['presetCtx']
    syncPreset().catch(() => {})
  })
  return syncPreset
}

/** 面板后端路由。 */
export function wireRoutes(
  root: PluginRoot,
  deps: WireDeps & {
    scanner: Scanner
    decision: Decision
    syncPreset: () => Promise<void>
  },
): void {
  const {
    cards,
    settings,
    precedents,
    records,
    log,
    state,
    scanner,
    decision,
    syncPreset,
    presence,
    kernel,
    gate,
  } = deps
  root.inject(['webServer'], (ctx: unknown) => {
    const webServer = (ctx as { webServer?: WebServerLike }).webServer
    if (!webServer) return
    registerRoutes({
      webServer,
      fenceCtx: ctx as never,
      deps: {
        cards,
        settings,
        precedents,
        records,
        decision,
        log,
        runtime: () => state.runtime,
        scanner,
        syncPreset,
        presence,
        kernel,
        gate,
      },
      log,
      effect: (fn, label) => root.effect(fn, label),
    })
  })
}
