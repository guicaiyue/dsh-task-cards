// 执行回执：dispatched 之后，等 origin 会话「确实又起了一轮并结束」，才落 executed。
//
// 为什么必须等：session adapter 的「执行」只是把一句话投回原会话，投递成功不等于
// agent 已经做完（以前「派发即视为执行完成」，验收总在做事之前跑）。回执定义：
// origin 会话回合号超过派发时回合号、且该回合最终回复非空；超时/报错/空回复一律 failed。

import { type ExecutionResult, hasReceipt } from '../../shared/execution'
import type { Store } from '../cards/store'
import type { Log, SessionEventLike } from '../host-api'
import { asNumber, asRecord, asString } from '../host-api'
import type { Journal } from '../kernel/journal'
import type { TransitionOutcome, TransitionRequest } from '../kernel/transition'

export const RECEIPT_TIMEOUT_MS = 180_000
const SWEEP_INTERVAL_MS = 15_000
const TRACKED_SESSIONS = 200

/** 跨热重载保留的登记表：HMR 不停在飞的回执。 */
const PENDING_KEY = Symbol.for('dsh-task-cards.receipt-pending')
const TURNS_KEY = Symbol.for('dsh-task-cards.receipt-turns')

interface TurnMark {
  turn: number
  replyChars: number
}

export interface PendingReceipt {
  cardId: string
  sessionId: string
  dispatchedTurn: number
  at: number
}

export interface ReceiptDeps {
  cards: Store
  journal: Journal
  apply: (req: TransitionRequest) => Promise<TransitionOutcome>
  /** DTC_VERIFY=on 时注入：回执到、落 executed 之后再验收（不再同 tick）。 */
  verify?: (caseId: string) => Promise<unknown>
  log: Log
  now?: () => number
  timeoutMs?: number
  /** TTL 从设置读（面板可调）；缺省回 timeoutMs / RECEIPT_TIMEOUT_MS。 */
  settings?: () => { receiptTimeoutMs?: number }
}

function sharedMap<V>(key: symbol): Map<string, V> {
  const bag = globalThis as unknown as Record<symbol, Map<string, V> | undefined>
  const existing = bag[key]
  if (existing) return existing
  const created = new Map<string, V>()
  bag[key] = created
  return created
}

function textLengthOf(message: unknown): number {
  const content = asRecord(message).content
  if (!Array.isArray(content)) return 0
  return content
    .map((block) => {
      const entry = asRecord(block)
      return entry.type === 'text' && typeof entry.text === 'string' ? entry.text.trim() : ''
    })
    .filter(Boolean)
    .join('\n').length
}

export class ReceiptTracker {
  readonly #deps: ReceiptDeps
  readonly #pending = sharedMap<PendingReceipt>(PENDING_KEY)
  readonly #turns = sharedMap<TurnMark>(TURNS_KEY)
  #timer: ReturnType<typeof setInterval> | null = null
  #busy = false

  constructor(deps: ReceiptDeps) {
    this.#deps = deps
  }

  get size(): number {
    return this.#pending.size
  }

  #now(): number {
    return (this.#deps.now ?? Date.now)()
  }

  /** 派发时 origin 会话的回合号；回执必须比它大。 */
  currentTurn(sessionId: string): number {
    return this.#turns.get(sessionId)?.turn ?? 0
  }

  /** 派发成功（消息已接受）后登记：等这个会话下一次 idle。 */
  track(cardId: string, sessionId: string, dispatchedTurn: number): void {
    this.#pending.set(cardId, {
      cardId,
      sessionId,
      dispatchedTurn,
      at: this.#now(),
    })
  }

  /** 接上宿主事件与定时器；attach 之后先做一次恢复（重启/HMR 找回在飞回执）。 */
  async attach(root: {
    on(type: string, handler: (...args: unknown[]) => void): unknown
  }): Promise<number> {
    root.on('session/event', (...args: unknown[]) => this.#onSessionEvent(args))
    root.on('agent/status', (...args: unknown[]) => {
      void this.#onAgentStatus(args)
    })
    root.on('agent/error', (...args: unknown[]) => {
      void this.#onAgentError(args)
    })
    const restored = await this.restore()
    if (!this.#timer) {
      const timer = setInterval(() => {
        void this.sweep()
      }, SWEEP_INTERVAL_MS)
      timer.unref?.()
      this.#timer = timer
    }
    return restored
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
  }

  /** 从 journal 找回「已派发但还没回执」的卡：重启/HMR 不丢在飞状态。 */
  async restore(): Promise<number> {
    let restored = 0
    for (const card of this.#deps.cards.list()) {
      if (card.deliveryState !== 'dispatched' || this.#pending.has(card.id)) continue
      const { events } = await this.#deps.journal.read(card.id)
      const dispatched = events.filter((event) => event.to === 'dispatched').pop()
      const turn = asNumber(asRecord(dispatched?.meta).turn) ?? 0
      this.#pending.set(card.id, {
        cardId: card.id,
        sessionId: card.origin?.sessionId ?? '',
        dispatchedTurn: turn,
        at: dispatched?.at ?? this.#now(),
      })
      restored += 1
    }
    return restored
  }

  /** 定时清理：超过 timeoutMs 还没回执 → failed/no-receipt。 */
  async sweep(): Promise<number> {
    if (this.#busy) return 0
    this.#busy = true
    try {
      const now = this.#now()
      const timeout =
        this.#deps.settings?.().receiptTimeoutMs ?? this.#deps.timeoutMs ?? RECEIPT_TIMEOUT_MS
      let failed = 0
      for (const receipt of [...this.#pending.values()]) {
        if (now - receipt.at < timeout) continue
        this.#pending.delete(receipt.cardId)
        await this.#fail(receipt, 'no-receipt')
        failed += 1
      }
      return failed
    } finally {
      this.#busy = false
    }
  }

  #onSessionEvent(args: unknown[]): void {
    try {
      const sessionId = asString(asRecord(args[0]).id)
      if (!sessionId) return
      const event = asRecord(args[1]) as unknown as SessionEventLike
      if (event.type !== 'assistant/message') return
      const data = asRecord(event.data)
      const mark: TurnMark = {
        turn: asNumber(data.turn) ?? this.#turns.get(sessionId)?.turn ?? 0,
        replyChars: textLengthOf(data.message),
      }
      this.#turns.set(sessionId, mark)
      if (this.#turns.size > TRACKED_SESSIONS) {
        const oldest = this.#turns.keys().next().value
        if (oldest !== undefined) this.#turns.delete(oldest)
      }
    } catch (err) {
      this.#deps.log(`回执：会话事件处理失败 — ${messageOf(err)}`)
    }
  }

  async #onAgentStatus(args: unknown[]): Promise<void> {
    try {
      const payload = asRecord(args[0])
      const agent = asRecord(payload.agent)
      const sessionId = asString(agent.id) || asString(agent.sessionId)
      if (!sessionId || asString(payload.status) !== 'idle') return
      await this.resolve(sessionId)
    } catch (err) {
      this.#deps.log(`回执：agent/status 处理失败 — ${messageOf(err)}`)
    }
  }

  async #onAgentError(args: unknown[]): Promise<void> {
    try {
      const payload = asRecord(args[0])
      const agent = asRecord(payload.agent)
      const sessionId = asString(agent.id) || asString(agent.sessionId)
      if (!sessionId) return
      for (const receipt of [...this.#pending.values()]) {
        if (receipt.sessionId !== sessionId) continue
        this.#pending.delete(receipt.cardId)
        await this.#fail(receipt, 'receipt-error')
      }
    } catch (err) {
      this.#deps.log(`回执：agent/error 处理失败 — ${messageOf(err)}`)
    }
  }

  /** 某个会话 idle 了：对它在飞的每一张卡判回执。 */
  async resolve(sessionId: string): Promise<number> {
    const mark = this.#turns.get(sessionId)
    let settled = 0
    for (const receipt of [...this.#pending.values()]) {
      if (receipt.sessionId !== sessionId) continue
      if (!mark || mark.turn <= receipt.dispatchedTurn) continue
      this.#pending.delete(receipt.cardId)
      if (mark.replyChars === 0) await this.#fail(receipt, 'empty-reply')
      else await this.#succeed(receipt, mark)
      settled += 1
    }
    return settled
  }

  async #succeed(receipt: PendingReceipt, mark: TurnMark): Promise<void> {
    const card = this.#deps.cards.find(receipt.cardId)
    if (!card || card.deliveryState !== 'dispatched') {
      this.#deps.log(
        `回执丢弃：${receipt.cardId} 已不在 dispatched（${card?.deliveryState ?? 'gone'}）`,
      )
      return
    }
    const result: ExecutionResult = {
      planId: card.id,
      executor: 'session',
      status: 'succeeded',
      dispatchedTurn: receipt.dispatchedTurn,
      receiptTurn: mark.turn,
      replyChars: mark.replyChars,
      durationMs: this.#now() - receipt.at,
      at: this.#now(),
    }
    await this.#deps.apply({
      cardId: card.id,
      to: 'executed',
      actor: 'executor',
      authority: 'system',
      reason: `回执到达：origin 会话第 ${mark.turn} 回合已结束（回复 ${mark.replyChars} 字）`,
      waitReason: null,
      meta: { execution: result },
    })
    this.#deps.log(`执行回执：${card.id} 回合 ${mark.turn}（回复 ${mark.replyChars} 字）`)
    if (!hasReceipt(result)) return
    if (!this.#deps.verify) return
    try {
      await this.#deps.verify(card.id)
    } catch (err) {
      this.#deps.log(`自动验收失败：${card.id} — ${messageOf(err)}`)
    }
  }

  async #fail(receipt: PendingReceipt, reason: string): Promise<void> {
    const card = this.#deps.cards.find(receipt.cardId)
    if (!card || card.deliveryState !== 'dispatched') return
    try {
      await this.#deps.apply({
        cardId: card.id,
        to: 'failed',
        actor: 'system',
        authority: 'system',
        reason: `执行没有拿到回执：${reason}`,
        waitReason: 'awaiting-user-escalation',
      })
      await this.#deps.cards.patch(card.id, { lastError: failTextOf(reason) }, 'receipt-failed')
    } catch (err) {
      this.#deps.log(`回执失败落账出错：${card.id} — ${messageOf(err)}`)
    }
    this.#deps.log(`执行无回执：${card.id}（${reason}），已进需关注`)
  }
}

function messageOf(err: unknown): string {
  return (err as Error)?.message || String(err)
}

/** 失败原因 → 人读的一句话（lastError 直接显示在面板行内）。 */
function failTextOf(reason: string): string {
  if (reason === 'receipt-error') return 'receipt-error: origin 会话报错，执行没跑完'
  if (reason === 'empty-reply') return 'empty-reply: 回执回合的最终回复为空'
  return 'no-receipt: 派发后会话没有继续，没拿到回执'
}
