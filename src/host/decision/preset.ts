// 决策代理人的 preset：和观察者一样只挂提示词，没有任何工具。
//
// 复用 observer/preset.ts 的注册与热重载兜底逻辑，只是换了 id、提示词字段与 section：
// config.mode = 'decision' 让同一个提示词插件去读 settings.decisionPrompt。

import type { Log } from '../host-api'
import {
  type PresetRegistrar,
  type PromptPresetOptions,
  registerPromptPreset,
} from '../observer/preset'
import { DECISION_PRESET_ID } from './defaults'

export const DECISION_PRESET: PromptPresetOptions = {
  id: DECISION_PRESET_ID,
  name: '任务卡决策代理人',
  description: '只有系统提示词、没有工具的决策会话（只出票拟，不动手）',
  order: 91,
  pluginId: 'task-cards-decision-prompt',
  label: '决策代理人',
  mode: 'decision',
}

export async function registerDecisionPreset(ctx: PresetRegistrar, log: Log): Promise<void> {
  await registerPromptPreset(ctx, log, DECISION_PRESET)
}
