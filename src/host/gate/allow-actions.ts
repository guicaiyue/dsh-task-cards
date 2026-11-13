// 面板券动作（从 gate.ts 拆出，控制单文件行数）。

import type { Card } from '../../shared/contract'
import { grantAllow, keyOfCard, revokeFor } from './hooks'

export interface AllowActionDeps {
  cardsByKey: Map<string, { cardId: string; at: number }>
  now: () => number
  log: (line: string) => void
}

/** 面板批准：发一张一次性放行券（同语义身份下一次调用通过）。 */
export function allowOnceFor(deps: AllowActionDeps, card: Card): void {
  const key = keyOfCard(card)
  if (!key) return
  const note = grantAllow({ card, cardsByKey: deps.cardsByKey, key, now: deps.now() })
  if (note) deps.log(`闸门发券：${note}（10 分钟内一次）key=${key}`)
}

/** 面板拒绝：清掉可能的券与去重登记。 */
export function clearAllowFor(deps: AllowActionDeps, card: Card): void {
  const key = keyOfCard(card)
  if (key) revokeFor(card, deps.cardsByKey, key)
}
