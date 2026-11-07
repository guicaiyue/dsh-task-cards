// 跑一次观察者会话：建会话（无工具的 preset）→ 投递素材 → 等回合结束 → 解析成草稿。
//
// 失败返回原因而不是抛：上层还有一次重试，重试用尽才记异常。

import type { Card, CardDraft, OrderSource, Settings } from '../../shared/contract'
import type { AgentHandleLike, HostRuntime, Log, SessionControllerLike } from '../host-api'
import { OBSERVER_PRESET_ID, OBSERVER_SESSION_PREFIX } from './constants'
import { coerceCards, extractJson } from './extract'
import { resolveModel } from './model'
import type { Waiter, WaitResult } from './waiter'
import { attachToWorkspace, observerWorkspace } from './workspace'

export interface ObserverTurnInput {
  originSessionId: string
  turn: number
  replyText: string
  turns?: Array<{
    user?: string
    assistant?: string
    provenance?: OrderSource
    at?: number
    cardId?: string
  }>
  cwd?: string
  /** 回合结束时的「用户最后发言」游标；建卡时用它判断用户是不是已经回来了。 */
  seenMark?: number
  /** 真正触发本轮的消息：真人原话或系统代发的卡片答复。 */
  triggerMessage?: string
  /** 触发本轮的最近一条真人原话：即使窗口被心跳占满也要带上。 */
  triggerUserMessage?: string
  triggerUserAt?: number
  /** 触发这条回复的消息来源：真人 / 系统代发 / 其它。 */
  triggerSourceKind?: OrderSource
  triggerCardId?: string
  /** 面板当前打开的卡 / 页签。 */
  ui?: { tab?: string; openCardId?: string }
  /** 同会话最近几张卡。 */
  recentCards?: Array<{ id: string; title: string; kind: string; status: string }>
}

export interface RunOnceResult {
  ok: boolean
  cards?: CardDraft[]
  sessionId: string
  attempts: number
  reason?: string
  text?: string
  usage?: WaitResult['usage']
  toolCalls?: number
  model?: string
  via?: string
}

export interface RunOnceOptions {
  ctx: HostRuntime
  config: Settings
  input: ObserverTurnInput
  userText: string
  attempt: number
  waiter: Waiter
  log: Log
}

export function observerSessionId(attempt: number): string {
  return `${OBSERVER_SESSION_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}-${attempt}`
}

export async function runObserverSession(options: RunOnceOptions): Promise<RunOnceResult> {
  const { ctx, config, userText, attempt, waiter, log } = options
  const sessionId = observerSessionId(attempt)
  const expects = waiter.expect(sessionId, config.timeoutMs)
  const controller = new AbortController()
  let handle: AgentHandleLike | null = null
  try {
    const chosen = resolveModel(ctx, config)
    if (!chosen) {
      return {
        ok: false,
        reason: '没有可用的模型：设置里没选，宿主也没有默认模型',
        sessionId,
        attempts: attempt,
      }
    }
    handle = await createObserverAgent(ctx, sessionId, chosen)
    await attachToWorkspace(ctx, sessionId, log)
    await selectObserverPreset(ctx, handle)
    // prompt 的第二个参数是必需的 AbortSignal：不传会让宿主内部直接抛错。
    const sessionController = ctx.sessionController as SessionControllerLike
    await sessionController.prompt(
      {
        requestId: `card-${Date.now().toString(36)}-${attempt}`,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: userText }],
      },
      controller.signal,
    )
    return await parseResult(expects, chosen, sessionId, attempt)
  } catch (err) {
    waiter.cancel(sessionId, '创建或投递观察者会话失败')
    return {
      ok: false,
      reason: `观察者会话失败：${(err as Error)?.message || String(err)}`,
      sessionId,
      attempts: attempt,
      text: '',
      usage: null,
    }
  } finally {
    try {
      controller.abort()
    } catch {
      /* 已经结束 */
    }
    if (handle) {
      // 观察者会话已经产出结果；释放 agent，会话日志仍然留在宿主里可追溯。
      Promise.resolve(handle.dispose()).catch(() => {})
    }
  }
}

async function createObserverAgent(
  ctx: HostRuntime,
  sessionId: string,
  chosen: { provider: string; model: string; reasoningEffort?: string },
): Promise<AgentHandleLike> {
  const agents = ctx.agents
  if (!agents) throw new Error('宿主缺少 agents 服务')
  const agentOptions: Record<string, unknown> = { provider: chosen.provider, model: chosen.model }
  if (chosen.reasoningEffort) agentOptions.reasoningEffort = chosen.reasoningEffort
  return agents.create({
    sessionId,
    // 不挂 parentSession：挂上以后 sessionController 会拒绝直接投递
    // （"owned by subagent routing"）。身份只靠下面那条 descriptor 事件表达。
    meta: { cwd: observerWorkspace(), agentPreset: OBSERVER_PRESET_ID },
    setup: (
      _childCtx: unknown,
      child: { session?: { append?: (type: string, data: unknown) => void } },
    ) => {
      // 子代理身份靠这条会话事件判定（dsh-subagent 的 foldSubagentDescriptor）。
      try {
        child.session?.append?.('subagent/descriptor', {
          version: 3,
          mode: 'one-shot',
          provider: 'dsh-task-cards',
          label: '任务卡观察者',
        })
      } catch {
        /* 老宿主不认识这条事件 */
      }
    },
    agentOptions,
  })
}

/** 建会话时直接带上观察者 preset；万一 factory 没认 meta，再用 select 补一次。 */
async function selectObserverPreset(ctx: HostRuntime, handle: AgentHandleLike): Promise<void> {
  const presets = ctx.agentPresets
  if (!presets || typeof presets.select !== 'function') return
  const composed =
    typeof presets.composedPreset === 'function'
      ? presets.composedPreset(handle.agent.ctx)
      : undefined
  if (composed === undefined) await presets.select(handle.agent, OBSERVER_PRESET_ID)
}

async function parseResult(
  expects: Promise<WaitResult>,
  chosen: { provider: string; model: string },
  sessionId: string,
  attempt: number,
): Promise<RunOnceResult> {
  const result = await expects
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      sessionId,
      attempts: attempt,
      text: result.text,
      usage: result.usage,
    }
  }
  const parsed = extractJson(result.text)
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason,
      sessionId,
      attempts: attempt,
      text: result.text,
      usage: result.usage,
      toolCalls: result.toolCalls,
    }
  }
  const coerced = coerceCards(parsed.value)
  if (!coerced.ok) {
    return {
      ok: false,
      reason: coerced.reason,
      sessionId,
      attempts: attempt,
      text: result.text,
      usage: result.usage,
      toolCalls: result.toolCalls,
    }
  }
  return {
    ok: true,
    cards: coerced.cards,
    sessionId,
    attempts: attempt,
    text: result.text,
    usage: result.usage,
    toolCalls: result.toolCalls,
    model: `${chosen.provider}/${chosen.model}`,
    via: parsed.via,
  }
}

/** 本轮有没有值得观察的回复。 */
export function shouldObserve(config: Settings, reply: string): boolean {
  if (!config.enabled) return false
  if (!reply) return false
  return reply.length >= config.minReplyChars
}

export type { Card }
