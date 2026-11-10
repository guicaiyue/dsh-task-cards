// 案例状态机：阶段映射、迁移表与可重放的 transition/replay。
//
// 这里是「唯一真相」的纯函数版本：不碰存储、不读时钟、不生成 id。
// 落盘由 host/kernel 负责，测试可以穷举所有迁移组合。

import type { Actor, Authority, CasePhase, DeliveryState, WaitReason } from './contract'
import { CASE_PHASES, DELIVERY_STATES } from './contract'

export interface CaseEvent {
  id: string
  caseId: string
  traceId: string
  at: number
  phase: CasePhase
  from: DeliveryState
  to: DeliveryState
  actor: Actor
  authority: Authority
  reason: string
  evidenceRefs: string[]
  policyVersion: number
  attempt?: number
  meta?: Record<string, unknown>
}

export type TransitionErrorCode =
  | 'UNKNOWN_FROM'
  | 'ILLEGAL_TRANSITION'
  | 'ACTOR_NOT_ALLOWED'
  | 'SAME_STATE'

export interface TransitionInput {
  from: DeliveryState
  to: DeliveryState
  actor: Actor
  authority: Authority
  reason: string
  evidenceRefs?: string[]
  policyVersion: number
  attempt?: number
  meta?: Record<string, unknown>
}

export type TransitionResult =
  | { ok: true; phase: CasePhase }
  | { ok: false; code: TransitionErrorCode; reason: string }

/** 每个投递状态属于哪个阶段：给面板和事件用，不在别处重复定义。 */
const PHASE_OF: Record<DeliveryState, CasePhase> = {
  idle: 'sense',
  waiting: 'decide',
  leased: 'execute',
  dispatched: 'execute',
  executed: 'execute',
  verifying: 'verify',
  confirmed: 'closed',
  failed: 'closed',
  unknown: 'verify',
  invalidated: 'closed',
}

/** 允许的迁移：from → { to: 允许的 actor 集合 }。 */
const TRANSITIONS: Record<DeliveryState, Partial<Record<DeliveryState, readonly Actor[]>>> = {
  idle: {
    waiting: ['scheduler', 'system', 'user'],
    invalidated: ['system'],
  },
  waiting: {
    leased: ['scheduler'],
    idle: ['scheduler', 'system', 'user'],
    invalidated: ['system', 'user'],
  },
  leased: {
    dispatched: ['scheduler', 'executor'],
    waiting: ['scheduler'],
    idle: ['scheduler', 'system'],
    unknown: ['scheduler'],
    invalidated: ['system'],
  },
  dispatched: {
    executed: ['executor', 'system'],
    unknown: ['scheduler', 'system'],
    failed: ['executor', 'system'],
    invalidated: ['system'],
  },
  executed: {
    verifying: ['verifier', 'system'],
    failed: ['verifier', 'system'],
    unknown: ['verifier', 'system'],
  },
  verifying: {
    confirmed: ['verifier', 'system', 'decision', 'user'],
    failed: ['verifier', 'system', 'decision', 'user'],
    unknown: ['verifier', 'system', 'decision', 'user'],
  },
  confirmed: {
    idle: ['scheduler', 'user'],
    invalidated: ['system', 'user'],
  },
  failed: {
    idle: ['scheduler', 'system', 'user'],
    waiting: ['scheduler'],
    invalidated: ['system', 'user'],
  },
  unknown: {
    idle: ['scheduler', 'decision', 'system', 'user'],
    waiting: ['decision', 'scheduler'],
    failed: ['decision', 'verifier'],
    invalidated: ['system', 'user'],
  },
  invalidated: {
    idle: ['user', 'system'],
  },
}

export { statusForDelivery } from './case-contract'

/** 这张卡的投递状态属于哪个阶段。 */
export function phaseOf(state: DeliveryState): CasePhase {
  return PHASE_OF[state]
}

/** 迁移是否合法（状态 + 角色双重校验）。 */
export function canTransition(from: DeliveryState, to: DeliveryState, actor: Actor): boolean {
  const allowed = TRANSITIONS[from]?.[to]
  return Array.isArray(allowed) && allowed.includes(actor)
}

/**
 * 校验一次迁移意图。
 *
 * 只做判断，不产生事件：调用方（kernel/transition）负责落盘与生成 id/at。
 * 这样同一个函数既能被路由用，也能被 UI 预判用。
 */
export function transition(input: TransitionInput): TransitionResult {
  if (!DELIVERY_STATES.includes(input.from)) {
    return { ok: false, code: 'UNKNOWN_FROM', reason: `未知的起点状态：${input.from}` }
  }
  if (input.from === input.to) {
    return { ok: false, code: 'SAME_STATE', reason: '起点与终点相同，不该产生事件' }
  }
  if (!DELIVERY_STATES.includes(input.to)) {
    return { ok: false, code: 'ILLEGAL_TRANSITION', reason: `未知的终点状态：${input.to}` }
  }
  const allowed = TRANSITIONS[input.from]?.[input.to]
  if (!allowed) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      reason: `${input.from} → ${input.to} 不在允许的迁移表里`,
    }
  }
  if (!allowed.includes(input.actor)) {
    return {
      ok: false,
      code: 'ACTOR_NOT_ALLOWED',
      reason: `${input.actor} 无权把 ${input.from} 推到 ${input.to}`,
    }
  }
  return { ok: true, phase: PHASE_OF[input.to] }
}

/** 从事件流重放：返回当前投递状态与阶段；坏事件（to 未知）跳过。 */
export function replay(events: readonly CaseEvent[]): {
  deliveryState: DeliveryState
  phase: CasePhase
  revisions: number
} {
  let state: DeliveryState = 'idle'
  let revisions = 0
  for (const event of events) {
    if (!DELIVERY_STATES.includes(event.to)) continue
    state = event.to
    revisions += 1
  }
  return { deliveryState: state, phase: PHASE_OF[state], revisions }
}

/** 从卡片快照推导等待原因优先级：给 tick 用，纯函数可测。 */
const WAIT_PRIORITY: readonly WaitReason[] = [
  'awaiting-decision',
  'already-dispatched',
  'awaiting-user-escalation',
  'wip-limit',
  'session-busy',
  'awaiting-receipt',
  'awaiting-verification',
  'retrying',
  'preempted',
  'lease-expired',
  'queued',
]

/** 多个原因同时成立时，取最能解释「卡在哪」的那一个。 */
export function pickWaitReason(reasons: readonly WaitReason[]): WaitReason | null {
  for (const candidate of WAIT_PRIORITY) {
    if (reasons.includes(candidate)) return candidate
  }
  return reasons[0] ?? null
}

/** 常量导出，给测试与面板复用，避免各自硬编码。 */
export const CASE_STATE_NAMES = DELIVERY_STATES
export const CASE_PHASE_NAMES = CASE_PHASES
