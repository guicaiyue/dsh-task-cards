// preset 注册：观察者与决策代理人各一个，都只挂一个提示词插件，没有 tool、没有 skill。
//
// preset 声明的 plugins 会按声明方的 baseUrl 解析，所以这里给绝对文件 URL，
// 避免依赖包名解析；带 ?v= 是为了绕开宿主 loader 的模块缓存（改了提示词要立刻生效）。

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { SETTINGS_FILE } from '../cards/store'
import type { HostRuntime, Log } from '../host-api'
import { POLICY_FILE } from '../policy/policy'
import { OBSERVER_PRESET_ID } from './constants'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PRESET_SLOT = Symbol.for('dsh-task-cards.observer-preset')

export type PresetRegistrar = {
  agentPresets?: HostRuntime['agentPresets']
  effect?: (fn: () => () => void, label: string) => unknown
}

type DisposeFn = () => unknown

const slots = globalThis as Record<symbol, unknown>

/** 运行中的 preset 注册表：id → disposer。热重载后这份表还在，先撤后注册。 */
function disposers(): Map<string, DisposeFn> {
  const current = slots[PRESET_SLOT]
  if (current instanceof Map) return current as Map<string, DisposeFn>
  // 上一版只存一个 observer disposer：先撤掉，别让它和新表抢同一个 preset。
  if (typeof current === 'function') {
    try {
      ;(current as DisposeFn)()
    } catch {
      /* 已经撤掉 */
    }
  }
  const fresh = new Map<string, DisposeFn>()
  slots[PRESET_SLOT] = fresh
  return fresh
}

export interface PromptPresetOptions {
  /** preset id（宿主里唯一）。 */
  id: string
  name: string
  description: string
  order: number
  /** preset 里那一行提示词插件的 id。 */
  pluginId: string
  /** 日志里的人话名字（观察者 / 决策代理人）。 */
  label: string
  /** decision 时提示词插件读 settings.decisionPrompt；默认读 systemPrompt。 */
  mode?: 'observer' | 'decision'
}

/** 提示词插件行：指向同一个模块，靠 config.mode 分两段提示词。 */
function promptPlugin(options: PromptPresetOptions) {
  return {
    id: options.pluginId,
    // 带 ?v= 的 URL：每次重挂都当作新模块加载。否则宿主 loader 会命中模块缓存，
    // 改了 observer-prompt.js 也只有重启才生效。
    name: `${pathToFileURL(path.join(HERE, 'observer-prompt.js')).href}?v=${Date.now()}`,
    config: {
      settingsFile: SETTINGS_FILE,
      policyFile: POLICY_FILE,
      ...(options.mode === 'decision' ? { mode: 'decision' } : {}),
    },
  }
}

export function promptPresetDefinition(options: PromptPresetOptions) {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    order: options.order,
    plugins: [promptPlugin(options)],
  }
}

/** 热重载会在同一个进程里再跑一次 apply：先撤掉上一轮，否则 duplicate。 */
async function disposeStalePreset(id: string): Promise<void> {
  const table = disposers()
  const dispose = table.get(id)
  if (!dispose) return
  table.delete(id)
  try {
    await dispose()
  } catch {
    /* 撤不掉就走下面的兜底 */
  }
}

/** 上一轮（还没存下 disposer 的旧版本）遗留的注册：清掉再注册一次。 */
function clearLeftoverPreset(presets: NonNullable<HostRuntime['agentPresets']>, id: string): void {
  const registry = presets as unknown as { definitions?: Map<string, Record<string, unknown>> }
  const record = registry.definitions?.get(id)
  if (record?.generation) {
    const generation = record.generation as {
      tree?: { root?: { stop?: () => void } }
      retired?: boolean
    }
    try {
      generation.tree?.root?.stop?.()
    } catch {
      /* 已停 */
    }
    generation.retired = true
  }
  registry.definitions?.delete(id)
}

async function registerWithFallback(
  presets: NonNullable<HostRuntime['agentPresets']>,
  log: Log,
  definition: () => Record<string, unknown>,
  label: string,
): Promise<DisposeFn | null> {
  try {
    return await presets.register(definition())
  } catch (err) {
    const message = (err as Error)?.message || String(err)
    if (!message.includes('Duplicate agent preset')) {
      log(`${label} preset 注册失败：${message}`)
      return null
    }
    log(`发现上一轮遗留的${label} preset，先撤掉再注册`)
    try {
      clearLeftoverPreset(presets, String(definition().id ?? ''))
      return await presets.register(definition())
    } catch (err2) {
      log(`${label} preset 重注册失败：${(err2 as Error)?.message || String(err2)}`)
      return null
    }
  }
}

/** 卸载时撤掉 preset，别在宿主里留一个指向本插件的行。 */
function attachPresetDisposer(ctx: PresetRegistrar, id: string, label: string): void {
  ctx.effect?.(
    () => () => {
      const table = disposers()
      const dispose = table.get(id)
      if (!dispose) return
      table.delete(id)
      try {
        dispose()
      } catch {
        /* 已经撤掉 */
      }
    },
    `dsh-task-cards: ${label} preset`,
  )
}

/** 注册一个「只有提示词」的 preset；失败只记日志，不挡主流程。 */
export async function registerPromptPreset(
  ctx: PresetRegistrar,
  log: Log,
  options: PromptPresetOptions,
): Promise<void> {
  const presets = ctx.agentPresets
  if (!presets || typeof presets.register !== 'function') {
    log(`宿主没有 agentPresets 服务：${options.label}会话会退回默认 preset（带工具）`)
    return
  }
  await disposeStalePreset(options.id)
  const dispose = await registerWithFallback(
    presets,
    log,
    () => promptPresetDefinition(options),
    options.label,
  )
  if (!dispose) return
  disposers().set(options.id, dispose)
  attachPresetDisposer(ctx, options.id, options.label)
  log(`${options.label} preset 已注册：${options.id}`)
}

const OBSERVER_PRESET: PromptPresetOptions = {
  id: OBSERVER_PRESET_ID,
  name: '任务卡观察者',
  description: '只有系统提示词、没有工具的观察者会话',
  order: 90,
  pluginId: 'task-cards-observer-prompt',
  label: '观察者',
}

export async function registerObserverPreset(ctx: PresetRegistrar, log: Log): Promise<void> {
  await registerPromptPreset(ctx, log, OBSERVER_PRESET)
}
