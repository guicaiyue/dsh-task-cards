// 卡片枚举字段的兜底：未知值一律降级，不让脏数据把状态机带偏。

import type { Card, CardKind, CardSeverity } from '../../shared/contract'

export function normalizeKind(value: unknown): CardKind {
  return value === 'decision' || value === 'auto' ? value : 'info'
}

export function normalizeSeverity(value: unknown): CardSeverity {
  return value === 'high' || value === 'low' ? value : 'normal'
}

export function normalizeAsk(value: unknown): Card['ask'] {
  return value === 'permission' || value === 'clarification' ? value : 'judgment'
}
