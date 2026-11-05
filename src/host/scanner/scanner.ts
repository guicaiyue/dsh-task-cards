// 卡片只是 JSON 的一种展现；真正让它们「动起来」的是这个扫描器。
//
// 每隔一段时间扫一遍到点的自动卡（kind=auto + status=scheduled + dueAt<=now），
// 在原会话里替用户补一句话（例如「模型 429 了，10 分钟后重试」这类），
// 成功就把卡收掉，失败就把卡退回「要我知晓」，不留静默失败。

import type { Card } from '../../shared/contract'
import type { Store } from '../cards/store'
import type { HostRuntime, Log } from '../host-api'

export interface ScannerOptions {
  getCtx: () => HostRuntime | null
  cards: Store
  log?: Log
  intervalMs?: number
}

export interface ScanResult {
  id: string
  ok: boolean
  error?: string
}

export class Scanner {
  readonly #getCtx: () => HostRuntime | null
  readonly #cards: Store
  readonly #log: Log
  readonly intervalMs: number
  #timer: NodeJS.Timeout | null = null
  #running = false

  constructor({ getCtx, cards, log, intervalMs = 30000 }: ScannerOptions) {
    this.#getCtx = getCtx
    this.#cards = cards
    this.#log = log || (() => {})
    this.intervalMs = intervalMs
  }

  start(): void {
    if (this.#timer) return
    this.#timer = setInterval(() => {
      this.tick().catch((err: unknown) =>
        this.#log(`扫描失败：${(err as Error)?.message || String(err)}`),
      )
    }, this.intervalMs)
    this.#timer.unref?.()
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
  }

  /** 扫一遍到点的卡；串行执行，避免同一会话被并发投递。 */
  async tick(now: number = Date.now()): Promise<ScanResult[]> {
    if (this.#running) return []
    this.#running = true
    try {
      const due = this.#cards.due(now)
      const results: ScanResult[] = []
      for (const card of due) results.push(await this.execute(card))
      return results
    } finally {
      this.#running = false
    }
  }

  /** 执行一张卡的自动动作。手动「立即执行」也走这里。 */
  async execute(card: Card): Promise<ScanResult> {
    const ctx = this.#getCtx()
    const action = card.action
    const target = action?.sessionId || card.origin?.sessionId
    const controller = new AbortController()
    try {
      if (!ctx?.sessionController) throw new Error('宿主缺少 sessionController')
      if (!target) throw new Error('卡片没有可回访的会话')
      if (!action?.input) throw new Error('自动动作缺少要补的那句话')
      await ctx.sessionController.prompt(
        {
          requestId: `card-auto-${Date.now().toString(36)}`,
          sessionId: target,
          mode: 'queue',
          content: [{ type: 'text', text: action.input }],
        },
        controller.signal,
      )
      await this.#cards.patch(
        card.id,
        { status: 'done', executedAt: Date.now(), lastError: null },
        'auto-executed',
      )
      this.#log(`自动处理完成：${card.title}`)
      return { id: card.id, ok: true }
    } catch (err) {
      const message = (err as Error)?.message || String(err)
      // 退回「要我知晓」：自动失败必须可见，不能静默。
      await this.#cards
        .patch(card.id, { status: 'open', lastError: message }, 'auto-failed')
        .catch(() => {})
      this.#log(`自动处理失败：${card.title} — ${message}`)
      return { id: card.id, ok: false, error: message }
    } finally {
      try {
        controller.abort()
      } catch {
        /* 已经结束 */
      }
    }
  }
}
