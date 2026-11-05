// 观察者 preset：只挂一个提示词插件，没有 tool、没有 skill。
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

type PresetRegistrar = {
  agentPresets?: HostRuntime['agentPresets']
  effect?: (fn: () => () => void, label: string) => unknown
}

type DisposeFn = () => unknown

const slots = globalThis as Record<symbol, unknown>

function presetDefinition() {
  return {
    id: OBSERVER_PRESET_ID,
    name: '任务卡观察者',
    description: '只有系统提示词、没有工具的观察者会话',
    order: 90,
    // 带 ?v= 的 URL：每次重挂都当作新模块加载。否则宿主 loader 会命中模块缓存，
    // 改了 observer-prompt.js 也只有重启才生效。
    plugins: [
      {
        id: 'task-cards-observer-prompt',
        name: `${pathToFileURL(path.join(HERE, 'observer-prompt.js')).href}?v=${Date.now()}`,
        config: { settingsFile: SETTINGS_FILE, policyFile: POLICY_FILE },
      },
    ],
  }
}

/** 热重载会在同一个进程里再跑一次 apply：先撤掉上一轮，否则 duplicate。 */
async function disposeStalePreset(): Promise<void> {
  const slot = slots[PRESET_SLOT]
  if (typeof slot !== 'function') return
  try {
    await (slot as DisposeFn)()
  } catch {
    /* 撤不掉就走下面的兜底 */
  }
  slots[PRESET_SLOT] = null
}

/** 上一轮（还没存下 disposer 的旧版本）遗留的注册：清掉再注册一次。 */
function clearLeftoverPreset(presets: NonNullable<HostRuntime['agentPresets']>): void {
  const registry = presets as unknown as { definitions?: Map<string, Record<string, unknown>> }
  const record = registry.definitions?.get(OBSERVER_PRESET_ID)
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
  registry.definitions?.delete(OBSERVER_PRESET_ID)
}

async function registerWithFallback(
  presets: NonNullable<HostRuntime['agentPresets']>,
  log: Log,
): Promise<DisposeFn | null> {
  try {
    return await presets.register(presetDefinition())
  } catch (err) {
    const message = (err as Error)?.message || String(err)
    if (!message.includes('Duplicate agent preset')) {
      log(`观察者 preset 注册失败：${message}`)
      return null
    }
    log('发现上一轮遗留的观察者 preset，先撤掉再注册')
    try {
      clearLeftoverPreset(presets)
      return await presets.register(presetDefinition())
    } catch (err2) {
      log(`观察者 preset 重注册失败：${(err2 as Error)?.message || String(err2)}`)
      return null
    }
  }
}

/** 卸载时撤掉 preset，别在宿主里留一个指向本插件的行。 */
function attachPresetDisposer(ctx: PresetRegistrar): void {
  ctx.effect?.(
    () => () => {
      const current = slots[PRESET_SLOT]
      if (typeof current !== 'function') return undefined
      try {
        return current() as void
      } catch {
        return undefined
      }
    },
    'dsh-task-cards: observer preset',
  )
}

export async function registerObserverPreset(ctx: PresetRegistrar, log: Log): Promise<void> {
  const presets = ctx.agentPresets
  if (!presets || typeof presets.register !== 'function') {
    log('宿主没有 agentPresets 服务：观察者会话会退回默认 preset（带工具）')
    return
  }
  await disposeStalePreset()
  const dispose = await registerWithFallback(presets, log)
  if (!dispose) return
  slots[PRESET_SLOT] = dispose
  attachPresetDisposer(ctx)
  log(`观察者 preset 已注册：${OBSERVER_PRESET_ID}`)
}
