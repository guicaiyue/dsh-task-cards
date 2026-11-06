// 跑一次决策会话：一批新建的卡 + 判例 → 票拟草稿 → 写回卡。
//
// 和观察者一样是「无工具会话 + 事件驱动等回合结束 + 失败重试一次」；
// 差别是它只读卡与判例，写操作只有 card.advice 和 decision → info 的车道纠正。
// 失败只记日志与卡事件，绝不抛出：卡本身必须仍然可用。

import type { Card, Settings } from '../../shared/contract'
import { isClosed } from '../../shared/state'
import type { PrecedentStore, SettingsStore, Store } from '../cards/store'
import type {
  AgentHandleLike,
  HostRuntime,
  Log,
  ModelSelection,
  SessionControllerLike,
} from '../host-api'
import { resolveModel } from '../observer/model'
import { Waiter } from '../observer/waiter'
import { attachToWorkspace, observerWorkspace } from '../observer/workspace'
import { applyAdvice } from './apply'
import { DECISION_PRESET_ID } from './defaults'
import { decisionSessionId } from './ids'
import { buildDecisionInput } from './input'
import { type AdviceDraft, parseAdvice } from './parse'

export interface DecisionRunResult {
  ok: boolean
  advised: number
  attempts: number
  sessionId: string
  reason?: string
}

export interface DecisionOptions {
  getCtx: () => HostRuntime | null
  settings: SettingsStore
  cards: Store
  precedents: PrecedentStore
  log?: Log
}

interface DecisionAttempt {
  ok: boolean
  attempt: number
  sessionId: string
  text: string
  reason?: string
}

interface AttemptOptions {
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

async function runDecisionAttempt({
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
      return {
        ok: false,
        attempt,
        sessionId,
        text: '',
        reason: '没有可用的模型：设置里没选，宿主也没有默认模型',
      }
    }
    handle = await createDecisionAgent(ctx, sessionId, chosen)
    await attachToWorkspace(ctx, sessionId, log)
    await selectDecisionPreset(ctx, handle)
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
    const result = await expects
    return { ok: result.ok, attempt, sessionId, text: result.text, reason: result.reason }
  } catch (err) {
    waiter.cancel(sessionId, '决策会话创建或投递失败')
    return { ok: false, attempt, sessionId, text: '', reason: `决策会话失败：${messageOf(err)}` }
  } finally {
    try {
      controller.abort()
    } catch {
      /* 已经结束 */
    }
    if (handle) {
      // 结果已拿到；释放 agent，会话日志仍留在宿主里可追溯。
      Promise.resolve(handle.dispose()).catch(() => {})
    }
  }
}

/**
 * 决策代理人：串行排队，一次会话覆盖一批卡。
 * 事件（session/event、agent/status）由 wire.ts 路由给它自己的 waiter。
 */
export class Decision {
  readonly waiter = new Waiter()
  readonly #getCtx: () => HostRuntime | null
  readonly #settings: SettingsStore
  readonly #cards: Store
  readonly #precedents: PrecedentStore
  readonly #log: Log
  #queue: Promise<unknown> = Promise.resolve()

  constructor({ getCtx, settings, cards, precedents, log }: DecisionOptions) {
    this.#getCtx = getCtx
    this.#settings = settings
    this.#cards = cards
    this.#precedents = precedents
    this.#log = log || (() => {})
  }

  /** 排队串行：不并发开一堆决策会话。 */
  enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(job, job)
    this.#queue = next.catch(() => {})
    return next
  }

  /** 观察者建完卡后调用：排队但立即返回，不阻塞观察者的记录落盘。 */
  enqueueCards(cards: Card[]): void {
    const ids = cards.map((card) => card.id)
    if (!ids.length) return
    this.enqueue(() => this.run(ids)).catch((err: unknown) =>
      this.#log(`运行失败：${messageOf(err)}`),
    )
  }

  /** 面板「重新出票拟」：显式动作，不受 decisionEnabled 影响。 */
  redecide(cardId: string): void {
    this.enqueue(() => this.run([cardId], true)).catch((err: unknown) =>
      this.#log(`重跑失败：${messageOf(err)}`),
    )
  }

  async run(cardIds: string[], force = false): Promise<DecisionRunResult> {
    const config = this.#settings.get()
    if (!config.decisionEnabled && !force) return skip('决策阶段已关闭')
    const cards = cardIds
      .map((id) => this.#cards.find(id))
      .filter((card): card is Card => !!card && !isClosed(card.status))
    if (!cards.length) return skip('没有需要决策的卡')
    const ctx = this.#getCtx()
    if (!ctx?.agents || !ctx.sessionController) {
      return await this.#failed(cards, '宿主缺少 agents / sessionController，决策未运行')
    }
    const limit = config.decisionPrecedentLimit
    const userText = buildDecisionInput(
      cards,
      this.#precedents.list(limit),
      limit,
      config.maxInputBytes,
    )
    const knownIds = new Set(cards.map((card) => card.id))
    let last: DecisionAttempt | null = null
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      last = await runDecisionAttempt({
        ctx,
        config,
        userText,
        attempt,
        waiter: this.waiter,
        log: this.#log,
      })
      const drafts = last.ok ? parseAdvice(last.text, knownIds) : null
      if (last.ok && drafts) return await this.#applyAll(cards, drafts, last)
      last = {
        ...last,
        ok: false,
        reason: last.ok ? '输出不是可解析的票拟 JSON' : last.reason || '未知原因',
      }
      this.#log(`第 ${attempt} 次失败：${last.reason}`)
    }
    return await this.#failed(cards, (last && last.reason) || '未知原因')
  }

  async #applyAll(
    cards: Card[],
    drafts: AdviceDraft[],
    last: DecisionAttempt,
  ): Promise<DecisionRunResult> {
    const byId = new Map(cards.map((card) => [card.id, card]))
    let advised = 0
    let corrected = 0
    for (const draft of drafts) {
      const card = byId.get(draft.cardId)
      if (!card) continue
      try {
        const result = await applyAdvice(this.#cards, card, draft)
        advised += 1
        if (result.corrected) corrected += 1
      } catch (err) {
        this.#log(`写回失败：${draft.cardId} — ${messageOf(err)}`)
      }
    }
    this.#log(
      `完成：${advised}/${cards.length} 张出票拟（纠正车道 ${corrected} 张），会话 ${last.sessionId}`,
    )
    return { ok: true, advised, attempts: last.attempt, sessionId: last.sessionId }
  }

  /** 失败只记日志与卡事件：卡仍然可用，人还能自己处理。 */
  async #failed(cards: Card[], reason: string): Promise<DecisionRunResult> {
    for (const card of cards) {
      await this.#cards.patch(card.id, {}, 'decision-failed').catch(() => {})
    }
    this.#log(`失败（${cards.length} 张卡）：${reason}`)
    return { ...skip(reason) }
  }
}

function skip(reason: string): DecisionRunResult {
  return { ok: false, advised: 0, attempts: 0, sessionId: '', reason }
}
