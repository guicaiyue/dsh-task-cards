// 阻塞提醒：待答卡超 10 分钟 → 写 ask:blocked 事件（带时长）；答完/关掉 → ask:unblocked。
// 只提醒、不替人答；notify/suggest 只影响面板与日志，off 时完全不扫。

import type { Card, Settings } from '../../shared/contract'
import {
  ASK_BLOCK_THRESHOLD_MS,
  ASK_SUGGEST_THRESHOLD_MS,
  askWaitMs,
  isBlockedAsk,
} from '../../shared/state'
import type { Store } from '../cards/store'
import type { Log } from '../host-api'

export interface BlockedSweepDeps {
  cards: Store
  settings: () => Settings
  log: Log
  now?: () => number
}

/** 最近一条 ask 状态事件（answered 不算：答完仍要补 ask:unblocked）。 */
function needsUnblock(card: Card): boolean {
  const last = lastAskEvent(card)
  return last === 'ask:blocked' || last === 'ask:auto-continued'
}

function lastAskEvent(card: Card): 'ask:blocked' | 'ask:unblocked' | 'ask:auto-continued' | null {
  const events = card.events
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const type = events[i]?.type ?? ''
    if (type === 'ask:blocked' || type === 'ask:unblocked' || type === 'ask:auto-continued')
      return type
  }
  return null
}

/** 扫一轮：返回本轮新阻塞的卡数（side effect：写事件 + 可选日志/建议标记）。 */
export async function sweepBlockedAsks(deps: BlockedSweepDeps): Promise<number> {
  const now = (deps.now ?? Date.now)()
  let blocked = 0
  for (const card of deps.cards.list()) {
    const waited = askWaitMs(card as never, now)
    if (waited === null) {
      // 从阻塞恢复到可答/关闭：补一条 unblocked（时长按创建到现在的实际等待算）。
      if (needsUnblock(card)) {
        const durationMs = Math.max(0, now - (card.createdAt || now))
        const auto = lastAskEvent(card) === 'ask:auto-continued'
        await deps.cards
          .patch(card.id, {}, { type: 'ask:unblocked', meta: { durationMs, auto } })
          .catch(() => undefined)
      }
      continue
    }
    const isBlocked = waited >= ASK_BLOCK_THRESHOLD_MS
    if (!isBlocked) {
      if (needsUnblock(card)) {
        const auto = lastAskEvent(card) === 'ask:auto-continued'
        await deps.cards
          .patch(card.id, {}, { type: 'ask:unblocked', meta: { durationMs: waited, auto } })
          .catch(() => undefined)
      }
      continue
    }
    blocked += 1
    if (lastAskEvent(card) === 'ask:blocked') continue
    const minutes = Math.round(waited / 60_000)
    await deps.cards
      .patch(card.id, card.severity === 'high' ? {} : { severity: 'high' }, {
        type: 'ask:blocked',
        meta: {
          durationMs: waited,
          minutes,
          sessionId: card.origin?.sessionId ?? '',
          action: deps.settings().askTimeoutAction,
        },
      })
      .catch(() => undefined)
    const action = deps.settings().askTimeoutAction
    if (action !== 'off') {
      const suggest =
        action === 'suggest' && waited >= ASK_SUGGEST_THRESHOLD_MS
          ? `（建议：${card.advice?.options?.[card.advice.chosen]?.name ?? card.advice?.summary ?? '见票拟'}）`
          : ''
      deps.log(
        `阻塞提醒：${card.title} 已等 ${minutes}m，会话 ${card.origin?.sessionId ?? '?'}${suggest}`,
      )
    }
  }
  return blocked
}

export { ASK_BLOCK_THRESHOLD_MS, ASK_SUGGEST_THRESHOLD_MS, isBlockedAsk }
