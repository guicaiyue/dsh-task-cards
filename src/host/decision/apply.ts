// 把解析出来的票拟写回卡。
//
// 代理人只做两件写操作：写 card.advice、把错标的 decision 降为 info。
// 车道纠正只允许 decision → info（可逆、不需要人动手）；反方向不落盘，只在
// advice.lane 里说明——他判断错了可以自己把卡改回来，代价为零。
// 不执行 action、不发消息、不删数据。

import type { Advice, Card, CardKind, Verdict } from '../../shared/contract'
import { CONFIDENCE_VALUE } from '../../shared/contract'
import type { Store } from '../cards/store'
import { sanitizeAll } from '../evidence/guard'
import type { ApprovalPolicy } from '../policy/store'
import type { AdviceDraft } from './parse'
import { route } from './route'

export interface ApplyAdviceResult {
  card: Card
  /** 车道纠正是否真的落盘了（false 只是票拟里写明了建议车道）。 */
  corrected: boolean
}

/** 只允许 decision → info；info/auto 想升成 decision 不落盘。 */
export function laneCorrection(card: Card, draft: AdviceDraft): CardKind | null {
  if (draft.lane !== 'info') return null
  return card.kind === 'decision' ? 'info' : null
}

function toAdvice(draft: AdviceDraft, applied: boolean): Advice {
  return {
    verdict: draft.verdict,
    summary: draft.summary,
    options: draft.options,
    basis: draft.basis,
    precedentIds: draft.precedentIds,
    chosen: draft.chosen,
    autoApply: draft.autoApply,
    confidence: draft.confidence,
    question: draft.question,
    answer: draft.answer,
    lane: draft.lane,
    ask: draft.ask ?? 'judgment',
    effect: draft.effect ?? 'write-code',
    requires: draft.requires ?? [],
    action: draft.action, // optional
    scope: draft.scope,
    reversible: draft.reversible ?? false,
    candidates: draft.candidates ?? [],
    blockedReasons: draft.blockedReasons ?? [],
    applied,
    at: Date.now(),
  }
}

export interface AdviceDeps {
  policy?: ApprovalPolicy
  recordVerdict?: (verdict: Verdict) => Promise<unknown>
}

export async function applyAdvice(
  cards: Store,
  card: Card,
  draft: AdviceDraft,
  deps: AdviceDeps = {},
): Promise<ApplyAdviceResult> {
  const { policy, recordVerdict } = deps
  const nextKind = laneCorrection(card, draft)
  // 先记车道纠正（事件 lane:info），再写票拟；两条事件都能在卡上看到。
  if (nextKind) await cards.patch(card.id, { kind: nextKind }, 'lane:info')
  const advice = toAdvice(draft, nextKind !== null)
  // 车道也要落回卡片顶层：面板行和详情块都读 card.ask，只写 advice.ask 会让
  // 旧卡重拟后仍显示「判断」。
  const decided = policy
    ? route({
        card,
        advice: {
          ...advice,
          verdict: advice.verdict,
          reversible: advice.reversible,
          precedentIds: advice.precedentIds,
        },
        policy,
      })
    : null
  const proposedAcceptance = sanitizeAll(advice.acceptance, process.cwd())
  const patch: Partial<Card> = {
    advice,
    ...(proposedAcceptance.length ? { acceptance: proposedAcceptance } : {}),
    ...(draft.ask !== undefined ? { ask: draft.ask } : {}),
    // 阶段 B：授权路由落盘（user/secretary/auto + 依据 + 策略版本）。
    ...(decided && policy
      ? { route: { ...decided, policyVersion: policy.version, at: Date.now() } }
      : {}),
    // wait 结构不完整 → 服务端降级 escalate（不靠提示词自觉）。
    ...(decided?.reason.startsWith('wait-structure-missing')
      ? { decision: 'escalated_user' as const }
      : {}),
  }
  // 阶段 B：delegated 票写独立 Verdict（可审计：谁在什么策略版本下批的）。
  if (decided?.decider === 'secretary' && policy && recordVerdict) {
    await recordVerdict({
      id: `v-${card.id}-${card.decisionSeq ?? 0}-${Date.now()}`,
      cardId: card.id,
      decisionSeq: card.decisionSeq ?? 0,
      actor: 'secretary',
      actorType: 'secretary',
      authority: 'delegated',
      policyVersion: policy.version,
      channel: 'system',
      decision: 'approve',
      rationale: decided.reason,
      confidence: advice.confidenceScore ?? CONFIDENCE_VALUE[advice.confidence],
      evidenceRefs: advice.precedentIds,
      at: Date.now(),
    }).catch(() => undefined)
  }
  const patched = await cards.patch(card.id, patch, 'advised')
  return { card: patched, corrected: nextKind !== null }
}
