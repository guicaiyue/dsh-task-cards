// 决策排水（水平触发）：扫 pending_secretary 且没有票拟的卡，补派给决策代理人。
//
// 边沿触发的漏洞：手动/POST /cards 建的卡、迁移后没票拟的卡、重启后的卡都躺在
// pending_secretary 无人问津。这里按 tick 水平重扫，最多 N=3 张/轮，同卡重试上限 2 次
// + 5 分钟退避，失败写事件，不无限打模型。Settings.autoDecide=false 时直接不排水。

import type { Card, Settings } from '../../shared/contract'
import type { Store } from '../cards/store'
import type { Log } from '../host-api'

export const DRAIN_EVENT = 'decision:drain'
const MAX_PER_ROUND = 3
const MAX_ATTEMPTS = 2
const BACKOFF_MS = 5 * 60 * 1000

export interface DecisionDrainDeps {
  cards: Store
  enqueue: (cards: Card[]) => void
  settings: () => Settings
  log: Log
  now?: () => number
}

interface Attempt {
  count: number
  lastAt: number
}

function attemptsOf(card: Card): Attempt {
  const events = card.events.filter((event) => event.type === DRAIN_EVENT)
  return {
    count: events.length,
    lastAt: events.reduce((max, event) => Math.max(max, event.at), 0),
  }
}

/** 扫一轮：返回本轮入队的卡数（side effect：enqueue + 写 decision:drain 事件）。 */
export function drainPendingDecisions(deps: DecisionDrainDeps): number {
  if (!deps.settings().autoDecide) return 0
  const now = (deps.now ?? Date.now)()
  const pending = deps.cards
    .list()
    .filter((card) => card.decision === 'pending_secretary' && !card.advice)
  const eligible = pending.filter((card) => {
    const attempt = attemptsOf(card)
    if (attempt.count >= MAX_ATTEMPTS) return false
    return now - attempt.lastAt >= BACKOFF_MS
  })
  const picked = eligible.slice(0, MAX_PER_ROUND)
  if (picked.length) {
    deps.enqueue(picked)
    for (const card of picked) {
      deps.cards
        .patch(card.id, {}, DRAIN_EVENT)
        .catch((err: unknown) => deps.log(`决策排水事件写入失败：${(err as Error)?.message}`))
    }
  }
  if (pending.length || picked.length) {
    deps.log(
      `决策排水：本轮处理 ${picked.length} 张（剩余 ${pending.length - picked.length} 张 pending_secretary）`,
    )
  }
  return picked.length
}
