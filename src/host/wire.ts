// 装配：把插件各部分接到宿主 root 上。index.ts 只负责按顺序调用这里。

import type { RecordStore, SettingsStore, Store } from './cards/store'
import type { HostRuntime, Log } from './host-api'
import { Observer } from './observer/observer'
import { registerObserverPreset } from './observer/preset'
import { observeTurns, type PluginRoot } from './observer/trigger'
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
  log: Log
  state: PluginState
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
export function wireQuestionHook(root: PluginRoot, { cards, log, state }: WireDeps): void {
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
          recordChatAnswer(cards, request, answer).catch(() => {})
        },
      )
      log(`提问建卡已安装：ask=${typeof runtime.userQuestions?.ask}`)
    } catch (err) {
      log(`提问建卡安装失败：${(err as Error)?.message || String(err)}`)
    }
  })
  root.effect(() => () => state.disposeQuestionHook(), 'dsh-task-cards: question hook')
}

/** 观察者 + 触发接线。 */
export function wireObserver(root: PluginRoot, deps: WireDeps): Observer {
  const { cards, settings, records, log, state } = deps
  const observer = new Observer({ getCtx: () => state.runtime, settings, cards, records, log })
  observeTurns(root, {
    observer,
    cards,
    settings: () => settings.get(),
    log,
    captureQuestion: (sessionId, data) => captureQuestion(cards, log, sessionId, data),
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

/** 观察者 preset：注册失败不挡主流程。 */
export function wirePreset(root: PluginRoot, deps: WireDeps): () => Promise<void> {
  const { log, state } = deps
  const syncPreset = async () => {
    if (state.presetCtx) await registerObserverPreset(state.presetCtx, log)
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
  deps: WireDeps & { scanner: Scanner; syncPreset: () => Promise<void> },
): void {
  const { cards, settings, log, state, scanner, syncPreset } = deps
  root.inject(['webServer'], (ctx: unknown) => {
    const webServer = (ctx as { webServer?: WebServerLike }).webServer
    if (!webServer) return
    registerRoutes({
      webServer,
      fenceCtx: ctx as never,
      deps: { cards, settings, log, runtime: () => state.runtime, scanner, syncPreset },
      log,
      effect: (fn, label) => root.effect(fn, label),
    })
  })
}
