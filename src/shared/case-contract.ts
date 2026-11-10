// 案例闭环的枚举与类型：从 contract.ts 拆出来，避免它越过 300 行预算。
//
// contract.ts 会 re-export 这里的一切，外部 import 路径保持不变。
// 这个文件只放纯常量与纯函数、不 import zod：客户端可以安全地值导入它
// （shared/state.ts 就靠这一点拿生命周期映射，避免把 zod 打进 bundle）。

/** 案例四层闭环的阶段：感知 → 决策 → 执行 → 验收 → 关闭。 */
export const CASE_PHASES = ['sense', 'decide', 'execute', 'verify', 'closed'] as const
/**
 * 投递/执行/验收状态。卡上的历史 status 仍保留，deliveryState 只描述「计划走到哪」。
 *
 * 契约（不变量）：**`waiting` 必须伴随 `status='done'`**。这是 `statusForDelivery()` 的
 * 派生结果，由 `host/kernel/transition.ts` 在同一次 patch 内写下。任何绕过 transition
 * 直接写 `deliveryState='waiting'`（或写 waiting 却不写 status）的路径都算 bug：
 * 调度器按 `waiting && status==='done'` 选就绪集，破坏它会让卡既不派发也解释不了。
 */
export const DELIVERY_STATES = [
  'idle',
  'waiting',
  'leased',
  'dispatched',
  'executed',
  'verifying',
  'confirmed',
  'failed',
  'unknown',
  'invalidated',
] as const
/** 为什么会停在原地：每个「等一下」都要能说清原因。 */
export const WAIT_REASONS = [
  'awaiting-decision',
  'awaiting-user-escalation',
  'queued',
  'session-busy',
  'wip-limit',
  'awaiting-receipt',
  'awaiting-verification',
  'preempted',
  'lease-expired',
  'retrying',
  /** 幂等键命中：同一次入队已经派发过，调度器拒绝重复投递。 */
  'already-dispatched',
  /** 依赖的计划还没完成（拓扑等待）。 */
  'depends-on',
  /** 重试次数用尽：执行失败已升级人工。 */
  'retry-exhausted',
] as const
/** 谁在动这张卡：写进事件流，排查时不用猜。 */
export const ACTORS = [
  'observer',
  'decision',
  'scheduler',
  'executor',
  'verifier',
  'user',
  'system',
] as const
/** 这次决定的权限来源：秘书在授权范围内 = delegated，用户本人 = user。 */
export const AUTHORITIES = ['delegated', 'user', 'system'] as const

export type CasePhase = (typeof CASE_PHASES)[number]
export type DeliveryState = (typeof DELIVERY_STATES)[number]
export type WaitReason = (typeof WAIT_REASONS)[number]
export type Actor = (typeof ACTORS)[number]
export type Authority = (typeof AUTHORITIES)[number]

/** 卡片的处理状态：人还需不需要动它。它是 deliveryState 的派生值（见 statusForDelivery）。 */
export const CARD_STATUSES = ['open', 'acknowledged', 'scheduled', 'done', 'dismissed'] as const
export type CardStatus = (typeof CARD_STATUSES)[number]

/**
 * 投递状态 → 卡片应有的 status。这是全链路唯一的一份映射。
 *
 * 一旦卡进了执行链路（deliveryState ≠ idle），它就不再占人的车道：批准/入队/派发/
 * 验收/失败/未知都由投递状态表达，status 收成 done；对账失效收成 dismissed。
 * idle 不约束：那是人自己管的待办/通知。
 * 需要人介入的失败与未知靠 deliveryState 徽标 + KPI「需关注」+ 失败排查页表达，
 * 而不是把它留在待决策车道——那正是面板误判、重复批准的来源。
 */
const STATUS_FOR_DELIVERY: Record<DeliveryState, CardStatus | null> = {
  idle: null,
  waiting: 'done',
  leased: 'done',
  dispatched: 'done',
  executed: 'done',
  verifying: 'done',
  confirmed: 'done',
  failed: 'done',
  unknown: 'done',
  invalidated: 'dismissed',
}

/** 这次投递状态要求的 status；null 表示不约束（idle）。 */
export function statusForDelivery(state: DeliveryState): CardStatus | null {
  return STATUS_FOR_DELIVERY[state] ?? null
}
