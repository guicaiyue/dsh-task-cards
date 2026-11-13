// 闸门建卡（单实例去重）：从 gate.ts 拆出，控制单文件行数。

import { isCardClosed } from '../../shared/state'
import type { Store } from '../cards/store'
import type { Log, ToolExecutionLike } from '../host-api'
import { usedAtOf } from './allow'
import { createGateCard } from './card'
import type { Inspection } from './hooks'
import { inspectCall } from './hooks'

export interface CardOnceDeps {
  cards: Store
  log: Log
  now: () => number
  cardsByKey: Map<string, { cardId: string; at: number }>
}

export async function createCardOnce(
  deps: CardOnceDeps,
  inspection: Inspection,
): Promise<string | null> {
  const registered = deps.cardsByKey.get(inspection.key)
  if (registered) {
    const existing = registered.cardId ? deps.cards.find(registered.cardId) : null
    // 上一张卡已经结束/删除：同一签名再拦应该建新卡，而不是指向旧卡。
    // 券已经用掉（宽限期结束后的再次拦截）→ 需要一张新卡，不再指向旧卡。
    if (existing && !isCardClosed(existing) && usedAtOf(inspection.key) === null)
      return registered.cardId
    deps.cardsByKey.delete(inspection.key)
  }
  const at = deps.now()
  deps.cardsByKey.set(inspection.key, { cardId: '', at }) // 先占位：并发命中不双建
  const card = await createGateCard(
    { cards: deps.cards, log: deps.log },
    {
      decision: inspection.decision,
      toolName: inspection.toolName,
      sessionId: inspection.sessionId,
      permitKey: inspection.key,
      at,
    },
  )
  deps.cardsByKey.set(inspection.key, { cardId: card.id, at })
  deps.log(`闸门建卡：${card.id}（${inspection.decision.effect}）`)
  return card.id
}

/** 宿主没有前置钩子：只建卡 + 标注「不支持前置拦截」，绝不假装拦住。 */
export async function observeCallOnce(
  cards: Store,
  settings: () => { turnGate: 'off' | 'high-risk' | 'all' },
  log: Log,
  mode: 'guard' | 'observe-only' | string,
  sessionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (mode !== 'observe-only') return
  const { degradeObserve } = await import('./card')
  const { asRecord, asString } = await import('../host-api')
  await degradeObserve(
    { cards, log },
    {
      sessionId,
      tool: asString(data.name),
      args: asRecord(data.arguments ?? data.args),
      mode: settings().turnGate ?? 'high-risk',
    },
  )
}

/** 一次工具调用的观察入口（宿主无前置钩子时降级建卡；auto 模式 gate 已先短路）。 */
export function observeToolCall(
  deps: {
    mode: 'guard' | 'observe-only' | string
    calls: { guard: number; preExecute: number }
    markUnavailable: (reason: string) => void
    observe: (sessionId: string, data: Record<string, unknown>) => Promise<void>
  },
  sessionId: string,
  data: Record<string, unknown>,
): void {
  if (deps.mode !== 'observe-only' && deps.calls.guard + deps.calls.preExecute === 0)
    deps.markUnavailable('真实工具调用未触发 guard/pre-execute 回调')
  void deps.observe(sessionId, data).catch(() => undefined)
}

/** 判定一次工具调用（券/去重/分类），从 gate.ts 拆出。 */
export function inspectFor(
  deps: { settings: () => unknown; log: Log; graceMs?: number },
  exec: ToolExecutionLike,
  now: number,
  cardsByKey: Map<string, { cardId: string; at: number }>,
): Inspection | null {
  return inspectCall({
    exec,
    settings: deps.settings as never,
    now,
    cardsByKey,
    log: deps.log,
    ...(deps.graceMs !== undefined ? { graceMs: deps.graceMs } : {}),
  })
}
