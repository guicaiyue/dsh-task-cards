// 闸门 × 授权反转（P1）：可逆放行的审计、不可逆的 ask 通道、消息文案。
// 从 gate.ts 拆出，控制单文件行数。

import { asRecord, asString, type ToolExecutionLike } from '../host-api'
import { classifyTurnCall, type GateDecision } from './classify'
import type { GateStatsStore } from './gate-stats'
import type { Inspection } from './hooks'

export function askDenyText(decision: GateDecision): string {
  return `需要确认：${decision.reasons.join(', ') || decision.effect}。已进 ask 通道（不建卡），请在面板作答；超时按默认继续。`
}

export function sessionOf(exec: ToolExecutionLike): string {
  const agent = asRecord(exec.agent)
  return asString(agent.id) || asString(agent.sessionId) || ''
}

export function cwdOf(exec: ToolExecutionLike): string {
  const agent = asRecord(exec.agent)
  return asString(asRecord(asRecord(agent.session).header).cwd) || ''
}

export interface GateAutonomyDeps {
  settings: () => { turnGate: 'off' | 'high-risk' | 'all'; autonomyMode: 'auto' | 'supervised' }
  recordAutonomy?: (entry: {
    sessionId: string
    tool: string
    effect: string
    target: string
    reasons: string[]
    cwd: string
  }) => void
  /** 策略版本（approval-policy 的实际 version）。 */
  policyVersion?: () => number
  createAsk?: (entry: {
    goalId: string
    sessionId: string
    /** 去重键：guard 与 pre-execute 会各判一次同一次调用，靠它只留一条 ask。 */
    key: string
    question: string
    defaultAnswer: string
    blocking: boolean
    reason: string
    effect: 'read' | 'write-code' | 'external' | 'spend' | 'destructive'
    policyVersion: number
    cwd: string
  }) => void
}

/** 可逆仓内写放行 → 写 autonomy:auto 审计（只记录，不打断执行）。 */
export function auditAllowedWrite(deps: GateAutonomyDeps, exec: ToolExecutionLike): void {
  const cwd = cwdOf(exec)
  const decision = classifyTurnCall(
    { tool: exec.name, args: asRecord(exec.arguments), cwd },
    { mode: deps.settings().turnGate, cwd },
  )
  if (decision.gate || decision.effect === 'read') return
  deps.recordAutonomy?.({
    sessionId: sessionOf(exec),
    tool: exec.name,
    effect: decision.effect,
    target: decision.target,
    reasons: decision.reasons,
    cwd,
  })
}

/** 不可逆动作进 ask 通道：带默认答案，不建卡。 */
export function createAskFor(deps: GateAutonomyDeps, inspection: Inspection, cwd = ''): void {
  const decision = inspection.decision
  // 默认答案由**效果分类**决定，不再只看判据文字：曾经 `rule:destructive-sql` 不匹配
  // 旧的 `/prod-db|spend|.../` 正则，于是「删数据的 SQL」拿到的默认答案竟是「按最小改动继续」，
  // 6 小时过期收尾时等于默认放行（真实账本 2026-11-11 的两条 ask 就是这样）。
  const reasons = decision.reasons.join(' ')
  const refuses =
    decision.effect === 'destructive' ||
    decision.effect === 'spend' ||
    /prod-db|destructive|spend|publish|rm-outside|git-push-main|docker-volume-rm|secret-path/.test(
      reasons,
    )
  deps.createAsk?.({
    goalId: '',
    sessionId: inspection.sessionId,
    key: `${inspection.sessionId}:${inspection.key}`,
    question: `需要确认（${decision.reasons.join(', ') || '不可逆动作'}）：${decision.target}`,
    defaultAnswer: refuses ? '不执行（保持现状）' : '按最小改动继续',
    blocking: decision.effect === 'destructive' || decision.effect === 'spend',
    reason: decision.reasons.join(', '),
    effect: decision.effect,
    policyVersion: deps.policyVersion?.() ?? 1,
    cwd,
  })
}

/** 判定之后的自动处置：放行写 autonomy:auto 审计；拒绝进 ask 通道并记零静默账。 */
export function settleAutomatically(
  deps: GateAutonomyDeps,
  exec: ToolExecutionLike,
  inspection: Inspection | null,
  stats: GateStatsStore,
): void {
  if (!inspection) {
    auditAllowedWrite(deps, exec)
    return
  }
  if ((deps.settings().autonomyMode ?? 'auto') === 'auto') stats.bump('denied')
  createAskFor(deps, inspection, cwdOf(exec))
}
