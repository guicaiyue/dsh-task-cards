// 生命周期漂移修复：旧数据里 status 与 deliveryState 各写各的。
//
// 事故残留的典型形状：status=open + deliveryState=unknown/confirmed，面板于是继续
// 把已处理的卡挂在「要我决策」里，人以为没处理、还会重复批准。这里只在启动与对账时
// 把这类「卡还在待处理车道、但投递状态已经走完」的残留纠正一次；人的主动决定
// （dismiss / acknowledge / scheduled 自动动作）一律不覆盖。

import { statusForDelivery } from '../../shared/case'
import type { CardStatus } from '../../shared/contract'
import type { Store } from '../cards/store'
import type { Log } from '../host-api'

export interface DriftDeps {
  cards: Store
  log?: Log
}

/** 只修「还占着人的车道」的那两种状态；scheduled 是自动动作的落点，不能动。 */
const REPAIRABLE = new Set<CardStatus>(['open', 'acknowledged'])

/**
 * 扫一遍卡，把 status 与投递状态不一致的残留改回派生值。
 * 返回被纠正的卡 id；幂等（第二次跑没有可改的）。
 */
export async function repairLifecycleDrift(deps: DriftDeps): Promise<string[]> {
  const fixed: string[] = []
  for (const card of deps.cards.list()) {
    const expected = statusForDelivery(card.deliveryState ?? 'idle')
    if (!expected) continue
    if (!REPAIRABLE.has(card.status)) continue
    if (card.status === expected) continue
    await deps.cards.patch(card.id, { status: expected }, 'lifecycle-drift')
    fixed.push(card.id)
    deps.log?.(
      `生命周期纠正：${card.id} ${card.status} → ${expected}（投递状态 ${card.deliveryState ?? 'idle'}）`,
    )
  }
  return fixed
}
