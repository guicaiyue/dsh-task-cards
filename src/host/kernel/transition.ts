// 唯一写入口：状态迁移只能走这里。
//
// 顺序是「先记事件，再改快照」：进程在两步之间挂掉时，事件里已经有这次
// 迁移，replay 会把快照纠正回来；反之（先改快照）就会丢事件、无法解释。

import {
  type CaseEvent,
  phaseOf,
  statusForDelivery,
  type TransitionErrorCode,
  transition,
} from '../../shared/case'
import type { Actor, Authority, Card, DeliveryState, WaitReason } from '../../shared/contract'
import { type Store, StoreError } from '../cards/store'
import type { Journal } from './journal'

export interface TransitionDeps {
  cards: Store
  journal: Journal
  now?: () => number
  nextId?: () => string
}

export interface TransitionRequest {
  cardId: string
  to: DeliveryState
  actor: Actor
  authority: Authority
  reason: string
  /** CAS：调用方拿到的旧令牌；不匹配直接 409，不写事件。 */
  expectedSeq?: number
  /** CAS：调用方以为的当前状态；不匹配直接 409。 */
  expectedState?: DeliveryState
  waitReason?: WaitReason | null
  evidenceRefs?: string[]
  policyVersion?: number
  attempt?: number
  meta?: Record<string, unknown>
}

export interface TransitionOutcome {
  card: Card
  event: CaseEvent
}

export function newTraceId(now: number = Date.now(), rand: number = Math.random()): string {
  const tail = Math.floor(rand * 36 ** 6)
    .toString(36)
    .padStart(6, '0')
  return `tr-${now.toString(36)}${tail}`
}

function conflict(reason: string): StoreError {
  return new StoreError('CAS_CONFLICT', reason)
}

/** CAS 前置检查：令牌或状态对不上就 409，绝不写事件。 */
function assertCas(card: Card, req: TransitionRequest): { from: DeliveryState; seq: number } {
  const from: DeliveryState = card.deliveryState ?? 'idle'
  const seq = card.decisionSeq ?? 0
  if (req.expectedSeq !== undefined && req.expectedSeq !== seq) {
    throw conflict(`卡已变化：期望 ${req.expectedSeq}，当前 ${seq}`)
  }
  if (req.expectedState !== undefined && req.expectedState !== from) {
    throw conflict(`卡状态已变：期望 ${req.expectedState}，当前 ${from}`)
  }
  return { from, seq }
}

function buildEvent(input: {
  card: Card
  from: DeliveryState
  req: TransitionRequest
  phase: CaseEvent['phase']
  at: number
  id: string
}): CaseEvent {
  const { card, from, req, phase, at, id } = input
  return {
    id,
    caseId: card.id,
    traceId: card.traceId || newTraceId(at, Math.random()),
    at,
    phase,
    from,
    to: req.to,
    actor: req.actor,
    authority: req.authority,
    reason: req.reason,
    evidenceRefs: req.evidenceRefs ?? [],
    policyVersion: req.policyVersion ?? 3,
    ...(req.attempt !== undefined ? { attempt: req.attempt } : {}),
    ...(req.meta ? { meta: req.meta } : {}),
  }
}

/**
 * 校验并应用一次迁移。
 *
 * 抛出的 StoreError.code 只有三种：NOT_FOUND / CAS_CONFLICT / 状态机错误码。
 * 路由层据此回 404 / 409 / 400，不需要再猜。
 */
export async function applyTransition(
  deps: TransitionDeps,
  req: TransitionRequest,
): Promise<TransitionOutcome> {
  const now = deps.now ?? Date.now
  const nextId = deps.nextId ?? (() => `e-${now()}-${Math.random().toString(36).slice(2, 8)}`)

  const card = deps.cards.find(req.cardId)
  if (!card) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')

  const { from, seq } = assertCas(card, req)
  const nowMs = now()

  const checked = transition({
    from,
    to: req.to,
    actor: req.actor,
    authority: req.authority,
    reason: req.reason,
    evidenceRefs: req.evidenceRefs,
    policyVersion: req.policyVersion ?? 3,
    attempt: req.attempt,
    meta: req.meta,
  })
  if (!checked.ok) throw new StoreError(checked.code as TransitionErrorCode, checked.reason)

  const event = buildEvent({ card, from, req, phase: checked.phase, at: nowMs, id: nextId() })

  // 先落事件：宁可多一条「已意图」，不可少一条「已发生」。
  await deps.journal.append(event)

  const changes: Partial<Card> = {
    deliveryState: req.to,
    decisionSeq: seq + 1,
    authority: req.authority,
    waitReason: req.waitReason ?? null,
  }
  // status 是 deliveryState 的派生值：同一次 patch 里一起写，杜绝两套状态各写各的。
  const status = statusForDelivery(req.to)
  if (status) changes.status = status
  // 退回 idle 的语义是「交回给人」：卡片重新进入待处理，不能留在已结束状态。
  if (req.to === 'idle') changes.status = 'open'
  if (req.to === 'invalidated') changes.invalidatedReason = req.reason
  if (req.to === 'idle') changes.invalidatedReason = null

  const patched = await deps.cards.patch(card.id, changes, `case:${req.to}`)
  return { card: patched, event }
}

export interface NoteRequest {
  cardId: string
  reason: string
  waitReason?: WaitReason | null
  actor?: Actor
  authority?: Authority
  meta?: Record<string, unknown>
}

/**
 * 记录一次「停在原地」的原因：不改状态，只写事件与 waitReason。
 *
 * 等原因是注释不是迁移，所以不走 transition()；但同样必须先落事件，
 * 面板才能解释「它为什么没动」。
 */
export async function noteCase(deps: TransitionDeps, req: NoteRequest): Promise<Card> {
  const now = deps.now ?? Date.now
  const nextId = deps.nextId ?? (() => `e-${now()}-${Math.random().toString(36).slice(2, 8)}`)
  const card = deps.cards.find(req.cardId)
  if (!card) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')
  const state: DeliveryState = card.deliveryState ?? 'idle'
  const event: CaseEvent = {
    id: nextId(),
    caseId: card.id,
    traceId: card.traceId || newTraceId(now(), Math.random()),
    at: now(),
    phase: phaseOf(state),
    from: state,
    to: state,
    actor: req.actor ?? 'scheduler',
    authority: req.authority ?? 'system',
    reason: req.reason,
    evidenceRefs: [],
    policyVersion: 3,
    ...(req.meta ? { meta: req.meta } : {}),
  }
  await deps.journal.append(event)
  return deps.cards.patch(card.id, { waitReason: req.waitReason ?? null }, `case:wait`)
}
