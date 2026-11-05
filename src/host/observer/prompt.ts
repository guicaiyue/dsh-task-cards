// 观察者会话的「系统提示词」插件。
//
// 它被挂进一个自定义 agent preset（只挂这一行）：该 preset 里没有任何 tool 插件，
// 所以观察者会话没有工具、没有 skill，只有这一段系统提示词。
// 提示词每次挂载时从 settings.json 读，改完提示词不需要重注册 preset。

import fs from 'node:fs'

import type { Policy } from '../../shared/contract'
import { DEFAULT_PROMPT, DEFAULT_SETTINGS } from '../cards/defaults'
import { SETTINGS_FILE } from '../cards/store'
import { allowedTools, readPolicy } from '../policy/policy'

export const name = 'task-cards-observer-prompt'

export const inject = ['systemPrompt', 'tools']

/** 系统提示词的 section 名：取一个我们自己的名字，靠 complete 独占整段系统提示词。 */
const OBSERVER_SECTION = 'task-cards:observer-prompt'

export interface ObserverPromptConfig {
  settingsFile?: string
  policyFile?: string
}

function readPrompt(file: string | undefined): string {
  try {
    const raw = JSON.parse(fs.readFileSync(file || SETTINGS_FILE, 'utf8')) as Record<
      string,
      unknown
    >
    if (typeof raw.systemPrompt === 'string' && raw.systemPrompt.trim()) return raw.systemPrompt
  } catch {
    /* 读不到就用默认的：宁可用内置提示词，也不要让观察者带着空调试 */
  }
  return DEFAULT_PROMPT
}

interface PromptCtx {
  tools: { schemas(): Array<{ name: string }>; restrict(options: { deny: string[] }): unknown }
  systemPrompt: {
    section(spec: Record<string, unknown>): () => void
    getSectionOrder(name: string): number
    suppressRuntimeContext?(): () => void
  }
  effect(fn: () => (() => void) | undefined, label: string): unknown
}

/**
 * 把全局工具从观察者这个 scope 里摘掉。
 * preset 行里没有 tool 插件，但宿主全局注册的工具（horon / design_* / team_* …）
 * 仍然会进模型请求；这些定义既浪费 token 又诱导模型去用工具，必须清干净。
 */
function tightenTools(ctx: PromptCtx, denied: Set<string>, policy: Policy): void {
  try {
    const allowed = allowedTools(policy, 'observer')
    if (allowed === null) return // 策略写 "*"：全放行，不干预
    const schemas = ctx.tools.schemas()
    const names = schemas
      .map((schema) => schema.name)
      .filter(
        (toolName) =>
          toolName &&
          toolName !== 'run_code' &&
          !denied.has(toolName) &&
          !allowed.includes(toolName),
      )
    if (!names.length) return
    ctx.tools.restrict({ deny: names })
    for (const toolName of names) denied.add(toolName)
  } catch {
    /* 宿主没有 restrict 或当前 scope 不支持：退化成「至少没有工具可用」 */
  }
}

export function apply(ctx: PromptCtx, config: ObserverPromptConfig = {}): void {
  const denied = new Set<string>()
  // 白名单每次都从 policy.json 现读：改文件、存设置都能立刻生效，不用重启。
  const policy = () => readPolicy(config.policyFile)
  const text = () => {
    tightenTools(ctx, denied, policy())
    return readPrompt(config.settingsFile)
  }
  tightenTools(ctx, denied, policy())
  let order = 0
  try {
    order = ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')
  } catch {
    /* 拿不到顺序就排在最前 */
  }

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: OBSERVER_SECTION,
        order,
        // 每次装配都重读设置文件：面板里改完提示词，下一轮立刻生效，
        // 不用重注册 preset、也不用重启宿主。
        text,
        // complete：这一段就是完整系统提示词，不拼部署默认的其余段落。
        complete: true,
      }),
    'task-cards: observer system prompt',
  )

  try {
    ctx.effect(
      () => ctx.systemPrompt.suppressRuntimeContext?.(),
      'task-cards: observer without runtime context',
    )
  } catch {
    /* 老宿主可能没有这个口子，没有就算了 */
  }
}

/** 默认设置里的提示词也在观察者设置缺失时兜底。 */
export { DEFAULT_SETTINGS }
