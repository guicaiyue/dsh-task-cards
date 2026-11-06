// 观察者：一个回合结束后，另开一个「没有工具」的会话，把最后那段回复总结成卡。
//
// 三条约束来自需求本身：
//   - 不碰原会话：只读事件，不往原会话里投任何东西；
//   - 不靠模型自觉：解析失败重试一次，再失败记异常并放弃这张卡；
//   - 可追溯：记录模型、输入输出、token、工具调用次数、耗时。

import type { Card, ObserverRecord } from '../../shared/contract'
import type { RecordStore, SettingsStore, Store } from '../cards/store'
import type { HostRuntime, Log } from '../host-api'
import { buildPayload } from './payload'
import {
  type ObserverTurnInput,
  type RunOnceResult,
  runObserverSession,
  shouldObserve,
} from './session'
import { Waiter } from './waiter'

export interface ObserverOptions {
  getCtx: () => HostRuntime | null
  settings: SettingsStore
  cards: Store
  records: RecordStore
  log?: Log
  /** 建卡成功后的回调（决策阶段接手这批卡）；不允许阻塞观察者的记录落盘。 */
  onCardsCreated?: (cards: Card[]) => void
}

export class Observer {
  readonly waiter = new Waiter()
  readonly #getCtx: () => HostRuntime | null
  readonly #settings: SettingsStore
  readonly #cards: Store
  readonly #records: RecordStore
  readonly #log: Log
  readonly #onCardsCreated: ((cards: Card[]) => void) | undefined
  #queue: Promise<unknown> = Promise.resolve()

  constructor({ getCtx, settings, cards, records, log, onCardsCreated }: ObserverOptions) {
    this.#getCtx = getCtx
    this.#settings = settings
    this.#cards = cards
    this.#records = records
    this.#log = log || (() => {})
    this.#onCardsCreated = onCardsCreated
  }

  /** 排队串行：不并发开一堆观察者会话。 */
  enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(job, job)
    this.#queue = next.catch(() => {})
    return next
  }

  async run(input: ObserverTurnInput): Promise<ObserverRecord | null> {
    const config = this.#settings.get()
    const reply = String(input.replyText || '').trim()
    if (!shouldObserve(config, reply)) return null

    const ctx = this.#getCtx()
    if (!ctx || !ctx.agents || !ctx.sessionController) {
      return this.#records.add({
        phase: 'observer',
        status: 'error',
        originSessionId: input.originSessionId,
        turn: input.turn,
        error: '宿主缺少 agents / sessionController，观察者未运行',
        attempts: 0,
      })
    }

    const startedAt = Date.now()
    const payload = buildPayload(input.turns, reply, config.maxInputBytes)
    const userText = `以下是某次会话最近几轮的输入与模型最终输出（越靠后越新）。请判断最后一轮结束后有没有值得留下的事，并只输出 JSON。\n\n<conversation>\n${payload}\n</conversation>`
    let last: RunOnceResult | null = null

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      last = await runObserverSession({
        ctx,
        config,
        input,
        userText,
        attempt,
        waiter: this.waiter,
        log: this.#log,
      })
      if (last.ok) break
      this.#log(`观察者第 ${attempt} 次失败：${last.reason}`)
    }

    const base = this.#baseRecord(input, payload, last, Date.now() - startedAt)
    if (!last || !last.ok) {
      return this.#records.add({
        ...base,
        status: 'invalid',
        error: (last && last.reason) || '未知原因',
        cardsCreated: 0,
      })
    }

    const created = await this.#createCards(input, last)
    // 交给决策阶段（排队，立刻返回）；记录落盘不因它延后。
    this.#notifyCreated(created)
    const entry = await this.#records.add({
      ...base,
      status: created.length > 0 ? 'ok' : 'empty',
      cardsCreated: created.length,
      cardIds: created.map((card) => card.id),
    })
    this.#log(
      `观察者：${input.originSessionId} 回合 ${input.turn} → ${entry.status} ${created.length} 张卡，` +
        `${(base.usage && base.usage.inputTokens) || 0}/${(base.usage && base.usage.outputTokens) || 0} tok，${base.durationMs}ms`,
    )
    return entry
  }

  #baseRecord(
    input: ObserverTurnInput,
    payload: string,
    last: RunOnceResult | null,
    durationMs: number,
  ): Omit<ObserverRecord, 'id' | 'at' | 'status'> {
    return {
      phase: 'observer',
      originSessionId: input.originSessionId,
      turn: input.turn,
      observerSessionId: last ? last.sessionId : undefined,
      model: last ? last.model : undefined,
      inputChars: payload.length,
      outputChars: last && last.text ? last.text.length : 0,
      usage: (last && last.usage) || undefined,
      toolCalls: last ? last.toolCalls : undefined,
      durationMs,
      attempts: last ? last.attempts : undefined,
      excerpt: last && last.text ? last.text.slice(0, 400) : '',
    }
  }

  #notifyCreated(cards: Card[]): void {
    if (!cards.length || !this.#onCardsCreated) return
    try {
      this.#onCardsCreated(cards)
    } catch (err) {
      // 决策阶段出问题不能影响观察者本身：日志记一句就过。
      this.#log(`交接决策阶段失败：${(err as Error)?.message || String(err)}`)
    }
  }

  async #createCards(input: ObserverTurnInput, last: RunOnceResult): Promise<Card[]> {
    const created: Card[] = []
    for (const draft of last.cards || []) {
      const card = await this.#cards.create(draft.title, {
        detail: draft.detail,
        source: 'agent',
        kind: draft.kind,
        severity: draft.severity,
        action: draft.action,
        origin: {
          sessionId: input.originSessionId,
          turn: input.turn,
          observerSessionId: last.sessionId,
          reason: draft.reason,
        },
      })
      created.push(card)
    }
    return created
  }
}
