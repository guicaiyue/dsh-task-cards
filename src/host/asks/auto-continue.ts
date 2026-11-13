// P2：待答卡超时按默认答案自动继续（askAutoContinue 默认开；blocking=true 无限等）。

import type { Card, Settings } from '../../shared/contract'
import type { Store } from '../cards/store'
import type { Log } from '../host-api'

export interface AutoContinueDeps {
  cards: Store
  settings: () => Settings
  log: Log
  /** 把默认答案投回原会话（与人工作答同一条投递通道）。 */
  deliver: (card: Card, text: string) => Promise<void>
  now?: () => number
}

export function timeoutMsOf(settings: Settings): number {
  return (settings.askTimeoutMinutes ?? 10) * 60_000
}

/** 扫一轮：到点且未答的卡按 defaultAnswer 继续；返回自动继续的卡数。 */
export async function sweepAutoContinue(deps: AutoContinueDeps): Promise<number> {
  const settings = deps.settings()
  if (settings.askAutoContinue === false) return 0
  const now = (deps.now ?? Date.now)()
  const timeoutMs = timeoutMsOf(settings)
  let count = 0
  for (const card of deps.cards.list()) {
    if (card.kind !== 'decision' || card.status !== 'open' || card.answer) continue
    if (!card.defaultAnswer || card.blocking) continue
    if (card.events.some((event) => event.type === 'ask:auto-continued')) continue
    const waited = now - (card.createdAt || now)
    if (waited < timeoutMs) continue
    const answer = card.defaultAnswer
    await deps
      .deliver(card, answer)
      .catch((err: unknown) =>
        deps.log(`默认答案投递失败：${(err as Error)?.message || String(err)}`),
      )
    await deps.cards
      .patch(
        card.id,
        { answer, answeredVia: 'auto', status: 'done' },
        {
          type: 'ask:auto-continued',
          meta: { timeoutMs, answer, defaultAnswer: answer, auto: true, waitedMs: waited },
        },
      )
      .catch((err: unknown) => deps.log(`自动继续写卡失败：${(err as Error)?.message}`))
    deps.log(`超时自动继续：${card.id}（默认：${answer.slice(0, 40)}）`)
    count += 1
  }
  return count
}

/** blocking 的 ask 只在被作答时离开待答集合；人几小时没来，就按默认答案收尾（不可逆的默认是「不执行」）。 */
export const STALE_BLOCKING_MS = 6 * 60 * 60_000

interface OpenAsk {
  id: string
  defaultAnswer: string
  blocking: boolean
  createdAt: number
  policyVersion: number
  sessionId: string
}

/**
 * 会话结束之后没人会再来答的 blocking 提问：等够 STALE_BLOCKING_MS 按默认答案收尾。
 *
 * 不猜会话死活（宿主没有可靠的「会话已结束」信号），只按时间收口；
 * 默认答案对不可逆动作本来就是「不执行（保持现状）」，因此收尾方向是安全的。
 */
export async function expireBlockingAsks(deps: {
  asks: { open(): OpenAsk[]; answer(id: string, answer: string, auto?: boolean): Promise<unknown> }
  settings: () => Settings
  log: Log
  audit?: (askId: string, waitedMs: number, answer: string) => void
  now?: () => number
}): Promise<number> {
  if (deps.settings().askAutoContinue === false) return 0
  const now = (deps.now ?? Date.now)()
  let count = 0
  for (const ask of deps.asks.open()) {
    if (!ask.blocking || !ask.defaultAnswer) continue
    const waited = now - ask.createdAt
    if (waited < STALE_BLOCKING_MS) continue
    await deps.asks.answer(ask.id, ask.defaultAnswer, true).catch(() => undefined)
    deps.audit?.(ask.id, waited, ask.defaultAnswer)
    deps.log(`blocking ask 过期收尾：${ask.id}（默认：${ask.defaultAnswer.slice(0, 40)}）`)
    count += 1
  }
  return count
}

/** ask 通道（asks.json）：非 blocking 且带默认答案的，超时标记自动继续并写审计。 */
export async function sweepAskStore(deps: {
  asks: {
    open(): OpenAsk[]
    answer(id: string, answer: string, auto?: boolean): Promise<unknown>
  }
  settings: () => Settings
  log: Log
  audit?: (askId: string, timeoutMs: number, defaultAnswer: string) => void
  now?: () => number
}): Promise<number> {
  const settings = deps.settings()
  if (settings.askAutoContinue === false) return 0
  const now = (deps.now ?? Date.now)()
  const timeoutMs = timeoutMsOf(settings)
  let count = 0
  for (const ask of deps.asks.open()) {
    if (ask.blocking || !ask.defaultAnswer) continue
    if (now - ask.createdAt < timeoutMs) continue
    await deps.asks.answer(ask.id, ask.defaultAnswer, true).catch(() => undefined)
    deps.audit?.(ask.id, timeoutMs, ask.defaultAnswer)
    deps.log(`ask 超时自动继续：${ask.id}`)
    count += 1
  }
  return count
}
