// 决定状态机：唯一权威状态是 Card.decision；status 只是派生视图（面板仍读 status）。

import type { Card, DecisionState } from './contract'

/** 旧卡推导：没有 decision 时按 kind/ask/status 推断，保证老数据语义不变。 */
export function deriveDecision(card: Card): DecisionState {
  if (card.decision) return card.decision
  if (card.status === 'done' || card.status === 'dismissed') return 'closed'
  if (card.kind !== 'decision') return 'notice'
  const state = card.deliveryState
  if (state === 'confirmed' || state === 'failed' || state === 'invalidated') return 'closed'
  if (state === 'executed' || state === 'verifying') return 'approved'
  if (card.advice) return 'card_ready'
  return card.status === 'open' ? 'pending_secretary' : 'escalated_user'
}

/** decision → 面板 status 的派生（单一映射，只在迁移/读视图处用）。 */
export function statusOfDecision(decision: DecisionState): Card['status'] {
  switch (decision) {
    case 'approved':
    case 'closed':
      return 'done'
    case 'rejected':
      return 'dismissed'
    case 'notice':
      return 'acknowledged'
    default:
      return 'open'
  }
}

/** 写入路径用：投递状态/status 变化后该落哪个 decision（显式 decision 优先）。 */
export function decisionAfter(card: Card): DecisionState {
  const state = card.deliveryState
  if (state === 'confirmed' || state === 'failed' || state === 'invalidated') return 'closed'
  if (state === 'verifying' || state === 'executed' || state === 'dispatched' || state === 'leased')
    return 'approved'
  if (state === 'waiting') return 'pending_secretary'
  if (card.kind !== 'decision') return 'notice'
  if (card.status === 'done' || card.status === 'dismissed') return 'closed'
  return card.advice ? 'card_ready' : 'pending_secretary'
}

/** 迁移：旧卡没有 decision 时按推导值补齐；返回是否改动。 */
export function fillDecision(card: Card): boolean {
  if (card.decision) return false
  card.decision = deriveDecision(card)
  return true
}
