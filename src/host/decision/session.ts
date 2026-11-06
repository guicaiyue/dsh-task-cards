// 跑一次决策会话：建无工具会话 → 投递卡与判例 → 等回合结束。
//
// 和观察者同构（见 observer/session.ts），只把「谁跑的、用了什么模型、
// 等了多久」带回 runner；输出是不是合法票拟由 runner 决定（parse 归它）。

import type { Settings } from '../../shared/contract'
import type {
  AgentHandleLike,
  HostRuntime,
  Log,
  ModelSelection,
  SessionControllerLike,
} from '../host-api'
import { resolveModel } from '../observer/model'
import type { Waiter, WaitResult } from '../observer/waiter'
import { attachToWorkspace, observerWorkspace } from '../observer/workspace'
import { DECISION_PRESET_ID } from './defaults'
import { decisionSessionId } from './ids'

export interface DecisionAttempt {
  /** ok = 拿到回复；session = 会话没建起来 / 超时 / 报错（runner 会另记 parse 失败）。 */
  kind: 'ok' | 'session'
  attempt: number
  sessionId: string
  text: string
  model?: string
  usage?: { inputTokens?: number; outputTokens?: number } | null
  toolCalls?: number
  reason?: string
}

export interface AttemptOptions {
  ctx: HostRuntime
  config: Settings
  userText: string
  attempt: number
  waiter: Waiter
  log: Log
}

function messageOf(err: unknown): string {
  return (err as Error)?.message || String(err)
}

/** 设置里给了决策模型就用它，否则退回观察者那套默认模型。 */
function resolveDecisionModel(ctx: HostRuntime, config: Settings): ModelSelection | null {
  if (config.decisionProvider && config.decisionModel) {
    return { provider: config.decisionProvider, model: config.decisionModel }
  }
  return resolveModel(ctx, config)
}

async function createDecisionAgent(
  ctx: HostRuntime,
  sessionId: string,
  chosen: ModelSelection,
): Promise<AgentHandleLike> {
  const agents = ctx.agents
  if (!agents) throw new Error('宿主缺少 agents 服务')
  const agentOptions: Record<string, unknown> = { provider: chosen.provider, model: chosen.model }
  if (chosen.reasoningEffort) agentOptions.reasoningEffort = chosen.reasoningEffort
  return agents.create({
    sessionId,
    // 不挂 parentSession：挂上以后 sessionController 会拒绝直接投递
    // （"owned by subagent routing"）。身份只靠下面那条 descriptor 事件表达。
    meta: { cwd: observerWorkspace(), agentPreset: DECISION_PRESET_ID },
    setup: (
      _childCtx: unknown,
      child: { session?: { append?: (type: string, data: unknown) => void } },
    ) => {
      try {
        child.session?.append?.('subagent/descriptor', {
          version: 3,
          mode: 'one-shot',
          provider: 'dsh-task-cards',
          label: '任务卡决策代理人',
        })
      } catch {
        /* 老宿主不认识这条事件 */
      }
    },
    agentOptions,
  })
}

/** 建会话时直接带上决策 preset；万一 factory 没认 meta，再用 select 补一次。 */
async function selectDecisionPreset(ctx: HostRuntime, handle: AgentHandleLike): Promise<void> {
  const presets = ctx.agentPresets
  if (!presets || typeof presets.select !== 'function') return
  const composed =
    typeof presets.composedPreset === 'function'
      ? presets.composedPreset(handle.agent.ctx)
      : undefined
  if (composed === undefined) await presets.select(handle.agent, DECISION_PRESET_ID)
}

function sessionFailure(sessionId: string, attempt: number, reason: string): DecisionAttempt {
  return { kind: 'session', attempt, sessionId, text: '', reason }
}

/** 建会话、挂到工作区、选 preset：任何一步失败都抛给调用方统一收成 session 失败。 */
async function prepareDecisionSession(
  ctx: HostRuntime,
  sessionId: string,
  chosen: ModelSelection,
  log: Log,
): Promise<AgentHandleLike> {
  const handle = await createDecisionAgent(ctx, sessionId, chosen)
  await attachToWorkspace(ctx, sessionId, log)
  await selectDecisionPreset(ctx, handle)
  return handle
}

interface PromptArgs {
  sessionId: string
  userText: string
  attempt: number
  expects: Promise<WaitResult>
  controller: AbortController
}

async function promptAndWait(
  ctx: HostRuntime,
  { sessionId, userText, attempt, expects, controller }: PromptArgs,
): Promise<WaitResult> {
  // prompt 的第二个参数是必需的 AbortSignal：不传会让宿主内部直接抛错。
  const sessionController = ctx.sessionController as SessionControllerLike
  await sessionController.prompt(
    {
      requestId: `card-decision-${Date.now().toString(36)}-${attempt}`,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: userText }],
    },
    controller.signal,
  )
  return expects
}

/** 收尾：断开信号、释放 agent；会话日志仍留在宿主里可追溯。 */
function finishDecisionSession(controller: AbortController, handle: AgentHandleLike | null): void {
  try {
    controller.abort()
  } catch {
    /* 已经结束 */
  }
  if (handle) Promise.resolve(handle.dispose()).catch(() => {})
}

export async function runDecisionAttempt({
  ctx,
  config,
  userText,
  attempt,
  waiter,
  log,
}: AttemptOptions): Promise<DecisionAttempt> {
  const sessionId = decisionSessionId(attempt)
  const expects = waiter.expect(sessionId, config.timeoutMs)
  const controller = new AbortController()
  let handle: AgentHandleLike | null = null
  try {
    const chosen = resolveDecisionModel(ctx, config)
    if (!chosen) {
      waiter.cancel(sessionId, '没有可用的模型')
      return sessionFailure(sessionId, attempt, '没有可用的模型：设置里没选，宿主也没有默认模型')
    }
    handle = await prepareDecisionSession(ctx, sessionId, chosen, log)
    const result = await promptAndWait(ctx, { sessionId, userText, attempt, expects, controller })
    return {
      kind: result.ok ? 'ok' : 'session',
      attempt,
      sessionId,
      text: result.text,
      model: `${chosen.provider}/${chosen.model}`,
      usage: result.usage,
      toolCalls: result.toolCalls,
      reason: result.reason,
    }
  } catch (err) {
    waiter.cancel(sessionId, '决策会话创建或投递失败')
    return sessionFailure(sessionId, attempt, `决策会话失败：${messageOf(err)}`)
  } finally {
    finishDecisionSession(controller, handle)
  }
}
