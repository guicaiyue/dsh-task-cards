// dsh-task-cards —— 宿主侧入口。
//
// 两件事：
//   ① 会话观察者：某个会话的一个回合结束后，另开一个「没有工具」的会话，
//      把最后那段回复总结成卡（observer/）。原会话不被写入任何东西。
//   ② 面板后端：卡的读写、观察者设置、可用模型（routes/）。
//
// 客户端半边走 package.json 的 dsh.client + exports["./client"]，由宿主自己加载。
// 装配细节在 wire.ts，这里只按顺序接线。

import { RecordStore, SettingsStore, Store } from './cards/store'
import type { PluginRoot } from './observer/trigger'
import {
  type PluginState,
  type WireDeps,
  wireObserver,
  wirePreset,
  wireQuestionHook,
  wireRoutes,
  wireScanner,
} from './wire'

export const name = 'dsh-task-cards'

export function apply(root: PluginRoot): void {
  const cards = new Store()
  const settings = new SettingsStore()
  const records = new RecordStore()
  const log = (line: string) => console.log(`[dsh-task-cards] ${line}`)

  // Cordis 的注入规则：先声明，再取属性。拿不到服务时保持 null，
  // 观察者会记一条「宿主缺少依赖」的异常记录，而不是让插件挂掉。
  const state: PluginState = { runtime: null, presetCtx: null, disposeQuestionHook: () => {} }
  const deps: WireDeps = { cards, settings, records, log, state }

  wireQuestionHook(root, deps)
  wireObserver(root, deps)
  const scanner = wireScanner(root, deps)
  const syncPreset = wirePreset(root, deps)
  wireRoutes(root, { ...deps, scanner, syncPreset })
}

export default { name, apply }
