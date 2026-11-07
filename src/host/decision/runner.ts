// 跑一次决策会话：一批新建的卡 + 判例 → 票拟草稿 → 写回卡（必要时自动执行）。
//
// 和观察者一样是「无工具会话 + 事件驱动等回合结束 + 失败重试一次」；
// 差别是它的写操作只有三件：card.advice、decision → info 的车道纠正，
// 以及「撤回不需要人动手」那一类票拟的自动执行（与人批红共用同一个投递函数）。
// 失败只记日志与卡事件，绝不抛出：卡本身必须仍然可用。
// 每次运行都落一条 phase='decision' 的执行记录（哪怕空手而归）。

import type { Card } from '../../shared/contract'
import { isClosed } from '../../shared/state'
import type { PrecedentStore, RecordStore, SettingsStore, Store } from '../cards/store'
import type { HostRuntime, Log } from '../host-api'
import { Waiter } from '../observer/waiter'
import { applyAdvice } from './apply'
import { autoApplyAdvice } from './autoapply'
import { resolveClarification } from './clarify'
import { buildDecisionInput } from './input'
import { type AdviceDraft, parseAdvice } from './parse'
import { type DecisionPreview, previewDecision } from './preview'
import { addDecisionRecord, type DecisionRecordStatus } from './record'
import { guardVagueReference } from './reference'
import { type DecisionAttempt, runDecisionAttempt } from './session'

export interface DecisionRunResult {
  ok: boolean
  /** 这次出了几张票拟。 */
  advised: number
  /** 这次自动执行了几张（投递成功才算）。 */
  applied: number
  attempts: number
  sessionId: string
  reason?: string
}

export interface DecisionOptions {
  getCtx: () => HostRuntime | null
  settings: SettingsStore
  cards: Store
  precedents: PrecedentStore
  records: RecordStore
  log?: Log
}

/** 一次运行失败或空手而归之后要写的记录。 */
interface RecordIntent {
  cards: Card[]
  last: DecisionAttempt | null
  status: DecisionRecordStatus
  startedAt: number
  userText: string
  cardsCreated?: number
  applied?: number
  corrected?: number
  error?: string
}

function messageOf(err: unknown): string {
  return (err as Error)?.message || String(err)
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
  readonly #records: RecordStore
  readonly #log: Log
  #queue: Promise<unknown> = Promise.resolve()

  constructor({ getCtx, settings, cards, precedents, records, log }: DecisionOptions) {
    this.#getCtx = getCtx
    this.#settings = settings
    this.#cards = cards
    this.#precedents = precedents
    this.#records = records
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
    const startedAt = Date.now()
    const config = this.#settings.get()
    if (!config.decisionEnabled && !force) {
      return await this.#stop(cardIds, 'empty', '决策阶段已关闭', startedAt)
    }
    const cards = this.#decidable(cardIds)
    if (!cards.length) return await this.#stop(cardIds, 'empty', '没有需要决策的卡', startedAt)
    const ctx = this.#getCtx()
    if (!ctx?.agents || !ctx.sessionController) {
      return await this.#failed(cards, '宿主缺少 agents / sessionController，决策未运行', 'error', {
        last: null,
        startedAt,
        userText: '',
      })
    }
    const userText = buildDecisionInput(
      cards,
      this.#precedents.list(config.decisionPrecedentLimit),
      config.decisionPrecedentLimit,
      config.maxInputBytes,
      (id) => this.#cards.find(id),
    )
    const knownIds = new Set(cards.map((card) => card.id))
    // 一张卡约 10-15s；批量时按张数放大，避免 3 张就撞 60s 超时。
    const timeoutMs = Math.min(180000, config.timeoutMs + Math.max(0, cards.length - 1) * 30000)
    let last: DecisionAttempt | null = null
    let parseFailed = false
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      last = await runDecisionAttempt({
        ctx,
        config,
        userText,
        attempt,
        waiter: this.waiter,
        log: this.#log,
        timeoutMs,
      })
      parseFailed = false
      const drafts = last.kind === 'ok' ? parseAdvice(last.text, knownIds) : null
      if (drafts) return await this.#applied(cards, drafts, last, userText, startedAt)
      if (last.kind === 'ok') {
        // 会话跑通了，是输出的形状不对：重试一次，最终按「不可解析」记。
        parseFailed = true
        last = { ...last, kind: 'session', reason: '输出不是可解析的票拟 JSON' }
      }
      this.#log(`第 ${attempt} 次失败：${last.reason}`)
    }
    const reason = (last && last.reason) || '未知原因'
    return await this.#failed(cards, reason, parseFailed ? 'invalid' : 'error', {
      last,
      startedAt,
      userText,
    })
  }

  /** 只读预演：与真实执行共用提示词/输入，但不写卡、不投递、不记执行记录。 */
  async preview(cardIds: string[]): Promise<DecisionPreview> {
    const ctx = this.#getCtx()
    if (!ctx) return { ok: false, cards: [], drafts: [], reason: '宿主未就绪' }
    return previewDecision(
      {
        ctx,
        config: this.#settings.get(),
        cards: this.#cards,
        precedents: this.#precedents,
        waiter: this.waiter,
        log: this.#log,
      },
      cardIds,
    )
  }

  /** 一张卡都没跑（开关关着 / 没有待决策的卡）：记一条空记录，不动任何卡。 */
  async #stop(
    cardIds: string[],
    status: DecisionRecordStatus,
    reason: string,
    startedAt: number,
  ): Promise<DecisionRunResult> {
    const cards = this.#decidable(cardIds)
    await this.#record({ cards, last: null, status, startedAt, userText: '', error: reason })
    return skip(reason)
  }

  /** 跑完一轮：写回票拟、纠正车道、按边界自动执行，最后落记录。 */
  async #applied(
    cards: Card[],
    drafts: AdviceDraft[],
    last: DecisionAttempt,
    userText: string,
    startedAt: number,
  ): Promise<DecisionRunResult> {
    const byId = new Map(cards.map((card) => [card.id, card]))
    const allowed = this.#settings.get().decisionAutoApply
    let advised = 0
    let corrected = 0
    let applied = 0
    for (const draft of drafts) {
      const card = byId.get(draft.cardId)
      if (!card) continue
      try {
        const resolved = resolveClarification(card, guardVagueReference(card, draft))
        const result = await applyAdvice(this.#cards, card, resolved)
        advised += 1
        if (result.corrected) corrected += 1
        const auto = await autoApplyAdvice(this.#autoDeps(allowed), result.card)
        if (auto) applied += 1
      } catch (err) {
        this.#log(`写回失败：${draft.cardId} — ${messageOf(err)}`)
      }
    }
    this.#log(
      `完成：${advised}/${cards.length} 张出票拟（纠正车道 ${corrected} 张，自动执行 ${applied} 张），会话 ${last.sessionId}`,
    )
    await this.#record({
      cards,
      last,
      status: advised > 0 ? 'ok' : 'empty',
      startedAt,
      userText,
      cardsCreated: advised,
      applied,
      corrected,
    })
    return { ok: true, advised, applied, attempts: last.attempt, sessionId: last.sessionId }
  }

  #autoDeps(allowed: boolean) {
    return {
      cards: this.#cards,
      getCtx: this.#getCtx,
      log: (line: string) => this.#log(`自动执行：${line}`),
      allowed,
      diagnostics: this.#settings.get().autoApproveDiagnostics,
    }
  }

  /** 失败只记日志与卡事件：卡仍然可用，人还能自己处理。 */
  async #failed(
    cards: Card[],
    reason: string,
    status: DecisionRecordStatus,
    rest: { last: DecisionAttempt | null; startedAt: number; userText: string },
  ): Promise<DecisionRunResult> {
    for (const card of cards) {
      await this.#cards.patch(card.id, {}, 'decision-failed').catch(() => {})
    }
    this.#log(`失败（${cards.length} 张卡）：${reason}`)
    await this.#record({ ...rest, cards, status, error: reason })
    return skip(reason)
  }

  /** 记录写失败不能影响决策本身：吞掉只记日志。 */
  async #record(intent: RecordIntent): Promise<void> {
    const { cards, last, userText } = intent
    try {
      await addDecisionRecord(this.#records, {
        status: intent.status,
        cards,
        sessionId: last?.sessionId || '',
        model: last?.model,
        inputChars: userText.length,
        outputChars: last?.text ? last.text.length : 0,
        usage: last?.usage,
        toolCalls: last?.toolCalls,
        durationMs: Date.now() - intent.startedAt,
        attempts: last?.attempt ?? 0,
        cardsCreated: intent.cardsCreated ?? 0,
        applied: intent.applied ?? 0,
        corrected: intent.corrected ?? 0,
        excerpt: last?.text ? last.text.slice(0, 400) : '',
        error: intent.error,
      })
    } catch (err) {
      this.#log(`执行记录写入失败：${messageOf(err)}`)
    }
  }

  #decidable(cardIds: string[]): Card[] {
    return cardIds
      .map((id) => this.#cards.find(id))
      .filter((card): card is Card => !!card && !isClosed(card.status))
  }
}

function skip(reason: string): DecisionRunResult {
  return { ok: false, advised: 0, applied: 0, attempts: 0, sessionId: '', reason }
}

/** 面板当时打开着某张卡：澄清卡可以直接用它作为答案，不再问用户。 */
