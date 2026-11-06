// 观察者 / 决策会话的「系统提示词」插件。
//
// 同一个插件模块挂进两个自定义 agent preset（各自只挂这一行、没有 tool）：
//   mode = observer（默认）→ settings.systemPrompt
//   mode = decision        → settings.decisionPrompt，空则 DEFAULT_DECISION_PROMPT
// 两段提示词互不串台：各自读各自的字段，各自的 section 名。改完提示词不需要重注册 preset。

import fs from 'node:fs'

import type { Policy } from '../../shared/contract'
import { DEFAULT_PROMPT, DEFAULT_SETTINGS } from '../cards/defaults'
import { SETTINGS_FILE } from '../cards/store'
import { DEFAULT_DECISION_PROMPT } from '../decision/defaults'
import { allowedTools, readPolicy } from '../policy/policy'

export const name = 'task-cards-observer-prompt'

export const inject = ['systemPrompt', 'tools']

export type PromptMode = 'observer' | 'decision'

/** section 名各自独立：同一进程里两个 preset 各装一次也不会互相覆盖。 */
const SECTIONS: Record<PromptMode, string> = {
  observer: 'task-cards:observer-prompt',
  decision: 'task-cards:decision-prompt',
}

export interface ObserverPromptConfig {
  settingsFile?: string
  policyFile?: string
  /** 同一个模块给两个 preset 用：默认观察者，decision 时读决策画像。 */
  mode?: PromptMode
}

function readSettings(file: string | undefined): Record<string, unknown> {
  try {
    const raw = JSON.parse(fs.readFileSync(file || SETTINGS_FILE, 'utf8')) as unknown
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  } catch {
    /* 读不到就用默认的：宁可用内置提示词，也不要让会话带着空调试 */
    return {}
  }
}

function readPrompt(file: string | undefined, mode: PromptMode): string {
  const raw = readSettings(file)
  const custom = mode === 'decision' ? raw.decisionPrompt : raw.systemPrompt
  if (typeof custom === 'string' && custom.trim()) return custom
  return mode === 'decision' ? DEFAULT_DECISION_PROMPT : DEFAULT_PROMPT
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
 * 把全局工具从这个 scope 里摘掉。
 * preset 行里没有 tool 插件，但宿主全局注册的工具（horon / design_* / team_* …）
 * 仍然会进模型请求；这些定义既浪费 token 又诱导模型去用工具，必须清干净。
 * 决策会话也按 observer 角色处理：它同样不许动手。
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
  const mode: PromptMode = config.mode === 'decision' ? 'decision' : 'observer'
  const denied = new Set<string>()
  // 白名单每次都从 policy.json 现读：改文件、存设置都能立刻生效，不用重启。
  const policy = () => readPolicy(config.policyFile)
  const text = () => {
    tightenTools(ctx, denied, policy())
    return readPrompt(config.settingsFile, mode)
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
        name: SECTIONS[mode],
        order,
        // 每次装配都重读设置文件：面板里改完提示词，下一轮立刻生效，
        // 不用重注册 preset、也不用重启宿主。
        text,
        // complete：这一段就是完整系统提示词，不拼部署默认的其余段落。
        complete: true,
      }),
    `task-cards: ${mode} system prompt`,
  )

  try {
    ctx.effect(
      () => ctx.systemPrompt.suppressRuntimeContext?.(),
      `task-cards: ${mode} without runtime context`,
    )
  } catch {
    /* 老宿主可能没有这个口子，没有就算了 */
  }
}

/** 默认设置里的提示词也在观察者设置缺失时兜底。 */
export { DEFAULT_SETTINGS }
