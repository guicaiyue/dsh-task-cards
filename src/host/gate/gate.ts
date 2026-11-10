// 回合内闸门：危险动作在回合内就被拦住，不等回合结束。
//
// 前置路径：`tools.guard` + `tools/pre-execute`（global:true，绕开 ctx 作用域过滤），
// 两条任一收到回调即拦截；实测都收不到时**诚实降级**为只建卡（observe-only），
// 由 session/event 的 tool/call 触发，卡片写明「本宿主未提供可用的前置拦截」。

import type { Card, Settings } from '../../shared/contract'
import type { Store } from '../cards/store'
import type { Log, ToolExecutionLike } from '../host-api'
import { asRecord, asString } from '../host-api'
import { clearAllows } from './allow'
import { createGateCard, degradeObserve, denyText, logSelfTest } from './card'
import {
  type AgentScopeCtx,
  attachAgentScope,
  type GateRootLike,
  grantAllow,
  type Inspection,
  inspectCall,
  installHooks,
  keyOfCard,
  pruneCards,
  revokeFor,
} from './hooks'
import { readJudged, writeJudged } from './judged'

const CARD_KEY = Symbol.for('dsh-task-cards.gate-cards')

interface CardRef {
  cardId: string
  at: number
}

export type { GateRootLike } from './hooks'

export type GateMode = 'guard' | 'pre-execute' | 'observe-only'

export interface TurnGateDeps {
  cards: Store
  settings: () => Settings
  log: Log
  now?: () => number
  /** 券核销后的宽限期（默认 5s；测试可设 0 还原严格一次性）。 */
  graceMs?: number
}

function sharedMap<V>(key: symbol): Map<string, V> {
  const bag = globalThis as unknown as Record<symbol, Map<string, V> | undefined>
  const existing = bag[key]
  if (existing) return existing
  const created = new Map<string, V>()
  bag[key] = created
  return created
}

export class TurnGate {
  readonly #deps: TurnGateDeps
  readonly #cardsByKey = sharedMap<CardRef>(CARD_KEY)
  #mode: GateMode = 'observe-only'
  #attached = false
  #guardActive = false
  #calls = 0
  #guardCalls = 0
  readonly #agentHooks = new Set<string>()
  #listenerRegistered = false

  constructor(deps: TurnGateDeps) {
    this.#deps = deps
  }

  get mode(): GateMode {
    return this.#mode
  }

  /** 诊断：宿主到底有没有回调进来（guard / pre-execute 各自计数）。 */
  get calls(): { guard: number; preExecute: number } {
    return { guard: this.#guardCalls, preExecute: this.#calls }
  }

  /** 测试/重置用：清掉跨实例共享的券与去重登记（生产热重载语义保留）。 */
  reset(): void {
    clearAllows()
    this.#cardsByKey.clear()
    this.#guardActive = false
    this.#calls = 0
    this.#guardCalls = 0
    this.#mode = 'observe-only'
  }

  #now(): number {
    return (this.#deps.now ?? Date.now)()
  }

  /** 接上宿主：guard + pre-execute 都注册；都收不到回调时诚实降级。 */
  attach(root: GateRootLike): void {
    if (this.#attached) return
    this.#attached = true
    const installed = installHooks(root, {
      owner: this,
      handler: async (...args: unknown[]) => this.preExecuteHandler(args),
      guardCall: (exec: unknown) => this.guardCall(exec),
      selfTest: () =>
        logSelfTest({
          mode: this.#mode,
          guardActive: this.#guardActive,
          settings: this.#deps.settings,
          log: this.#deps.log,
        }),
      log: this.#deps.log,
    })
    this.#guardActive = installed.guardActive
    this.#listenerRegistered = installed.listenerRegistered
    this.#mode = installed.mode
  }

  /**
   * 实测降级：宿主接口都在，但真实会话的工具调用一次也没回调 → 不再假装能拦，
   * 切到 observe-only（只建「未拦截」卡 + 明确文案）。
   */
  markUnavailable(reason: string): void {
    if (this.#mode === 'observe-only') return
    this.#mode = 'observe-only'
    this.#deps.log(
      `闸门降级：本会话未接入前置拦截（${reason}）；覆盖范围=已挂载 agent 作用域的会话，此后只建卡片不拦截`,
    )
  }

  /**
   * pre-execute 处理器：**即使 guard 已接管也要再判一次**。
   *
   * 真实故障：guard 接管日志有、但宿主没有回调（作用域/接线原因），
   * 而旧代码在 pre-execute 里因 guardActive 直接 next() → 两条路都没拦住。
   * 现在不管 guard 是否接管，waterfall 一触发就判定；建卡用 #cardsByKey 去重。
   */
  /** 把 pre-execute 挂到 agent 作用域（宿主按 ctx 过滤 listener 时的兜底）。 */
  attachAgent(sessionId: string, ctx: AgentScopeCtx | null): void {
    attachAgentScope({
      sessionId,
      ctx,
      attached: this.#agentHooks,
      handler: (...args: unknown[]) => this.preExecuteHandler(args),
      log: this.#deps.log,
    })
  }

  async preExecuteHandler(args: unknown[]): Promise<unknown> {
    const exec = asRecord(args[0]) as unknown as ToolExecutionLike
    const next = args[1] as (() => Promise<{ kind: string }>) | undefined
    this.#calls += 1
    if (!this.#guardActive) this.#mode = 'pre-execute'
    const callId = asString(asRecord(exec).callId) || asString(asRecord(exec).token) || '(无)'
    this.#deps.log(`闸门回调（pre-execute #${this.#calls}）：${exec.name} callId=${callId}`)
    const allowed = await next?.()
    // guard 已经判过这次执行（宿主先 waterfall 后 guard 的顺序在此之前不会发生，
    // 但重入/二次派发会）：复用结论，不重复判定。
    const judged = readJudged(exec)
    if (judged.hit) return judged.deny ? { kind: 'deny', reason: judged.deny } : allowed
    const deny = await this.preExecuteCall(exec)
    writeJudged(exec, deny ?? undefined)
    return deny ? { kind: 'deny', reason: deny } : allowed
  }

  /** tools.guard 路径：同步判定（必须同步返回 deny），建卡走异步补。 */
  guardCall(exec: unknown): string | undefined {
    const value = asRecord(exec) as unknown as ToolExecutionLike
    this.#guardCalls += 1
    if (this.#guardCalls <= 5 || this.#guardCalls % 50 === 0)
      this.#deps.log(
        `闸门回调（guard #${this.#guardCalls}）：${value.name} callId=${
          asString(asRecord(value).callId) || asString(asRecord(value).token) || '(无)'
        }`,
      )
    // pre-execute 已经判过这次执行：直接复用结论，不再消费券、不再建卡。
    const judged = readJudged(value)
    if (judged.hit) {
      this.#deps.log(`闸门复用判定（guard，同一次执行）：${judged.deny ? 'deny' : 'allow'}`)
      return judged.deny
    }
    const inspection = this.#inspect(value)
    if (!inspection) return undefined
    // #createCard 内部会在第一个 await 之前同步占位，并发/重试同 key 不会各建一张。
    if (!this.#cardsByKey.has(inspection.key))
      void this.#createCard(inspection).catch((err: unknown) =>
        this.#deps.log(`闸门建卡失败：${messageOf(err)}`),
      )
    const deny = denyText(inspection.decision, inspection.existing)
    writeJudged(value, deny)
    return deny
  }

  /** tools/pre-execute 路径：可以等建卡完再 deny（reason 里带卡 id）。 */
  async preExecuteCall(exec: ToolExecutionLike): Promise<string | null> {
    const inspection = this.#inspect(exec)
    if (!inspection) return null
    const cardId = await this.#createCard(inspection).catch((err: unknown) => {
      this.#deps.log(`闸门建卡失败：${messageOf(err)}`)
      return null
    })
    return denyText(inspection.decision, cardId)
  }

  #inspect(exec: ToolExecutionLike): Inspection | null {
    return inspectCall({
      exec,
      settings: this.#deps.settings,
      now: this.#now(),
      cardsByKey: this.#cardsByKey,
      log: this.#deps.log,
      ...(this.#deps.graceMs !== undefined ? { graceMs: this.#deps.graceMs } : {}),
    })
  }

  async #createCard(inspection: Inspection): Promise<string | null> {
    const registered = this.#cardsByKey.get(inspection.key)
    if (registered) return registered.cardId || null
    const at = this.#now()
    this.#cardsByKey.set(inspection.key, { cardId: '', at }) // 先占位：并发命中不双建
    const card = await createGateCard(
      { cards: this.#deps.cards, log: this.#deps.log },
      {
        decision: inspection.decision,
        toolName: inspection.toolName,
        sessionId: inspection.sessionId,
        permitKey: inspection.key,
        at,
      },
    )
    this.#cardsByKey.set(inspection.key, { cardId: card.id, at })
    this.#prune()
    this.#deps.log(`闸门建卡：${card.id}（${inspection.decision.effect}）`)
    return card.id
  }

  /** 宿主没有前置钩子：只建卡 + 标注「不支持前置拦截」，绝不假装拦住。 */
  async observeCall(sessionId: string, data: Record<string, unknown>): Promise<void> {
    if (this.#mode !== 'observe-only') return
    const mode = this.#deps.settings().turnGate ?? 'high-risk'
    await degradeObserve(
      { cards: this.#deps.cards, log: this.#deps.log },
      {
        sessionId,
        tool: asString(data.name),
        args: asRecord(data.arguments ?? data.args),
        mode,
      },
    )
  }

  /** 面板批准：发一张一次性放行券（同语义身份下一次调用通过）。 */
  allowOnce(card: Card): void {
    const key = keyOfCard(card)
    if (!key) return
    const note = grantAllow({ card, cardsByKey: this.#cardsByKey, key, now: this.#now() })
    if (note) this.#deps.log(`闸门发券：${note}（10 分钟内一次）key=${key}`)
  }

  /** 面板拒绝：清掉可能的券与去重登记。 */
  clearAllow(card: Card): void {
    const key = keyOfCard(card)
    if (!key) return
    revokeFor(card, this.#cardsByKey, key)
  }

  /** 一次工具调用的观察入口（session/event 的 tool/call）：能力边界判定 + 降级建卡。 */
  onToolCallObserved(sessionId: string, data: Record<string, unknown>): void {
    const calls = this.calls
    if (this.#mode !== 'observe-only' && calls.guard + calls.preExecute === 0)
      this.markUnavailable('真实工具调用未触发 guard/pre-execute 回调')
    void this.observeCall(sessionId, data).catch(() => undefined)
  }

  #prune(): void {
    pruneCards(this.#cardsByKey, this.#now())
  }
}

function messageOf(err: unknown): string {
  return (err as Error)?.message || String(err)
}
