// 票拟的文案与配色映射：枚举值 → 人话 + 一个样式基调。
//
// 词条全部在 locale/{zh,en}.ts（值必须是字符串）；这里只拼键名，不写中文。

import type {
  AdviceVerdict,
  Card,
  CardKind,
  CardSeverity,
  PrecedentOutcome,
  Translate,
} from './types'

const VERDICT_TONE: Record<AdviceVerdict, string> = {
  approve: 'is-approve',
  reject: 'is-reject',
  modify: 'is-modify',
  wait: 'is-wait',
}

const OUTCOME_TONE: Record<PrecedentOutcome, string> = {
  unknown: 'is-unknown',
  valid: 'is-valid',
  reworked: 'is-reworked',
}

/** 结论的样式基调：批准/不批/改后批/待补，四个颜色不同的 chip。 */
export function verdictTone(verdict: AdviceVerdict): string {
  return VERDICT_TONE[verdict] || VERDICT_TONE.wait
}

/** 判例后果的样式基调：reworked 要标红。 */
export function outcomeTone(outcome: PrecedentOutcome): string {
  return OUTCOME_TONE[outcome] || OUTCOME_TONE.unknown
}

export function verdictLabel(t: Translate, verdict: AdviceVerdict): string {
  return t(`verdict_${verdict}`)
}

export function confidenceLabel(t: Translate, confidence: CardSeverity): string {
  return t(`confidence_${confidence}`)
}

export function outcomeLabel(t: Translate, outcome: PrecedentOutcome): string {
  return t(`outcome_${outcome}`)
}

export function laneLabel(t: Translate, lane: CardKind): string {
  return t(`lane_${lane}`)
}

/** 影响等级 → 人话：read / write-code / destructive / external / spend。 */
export function effectLabel(t: Translate, effect?: string): string {
  return t(`effect_${effect || 'write-code'}`)
}

/** 自动执行被拦的原因 → 人话；未知原因原样显示，方便排查。 */
export function blockedReasonLabel(t: Translate, reason: string): string {
  if (reason.startsWith('missing-capability:')) {
    return t('blockedMissing', { cap: reason.slice('missing-capability:'.length) })
  }
  if (reason === 'deictic-without-target') return t('blockedDeictic')
  if (reason.startsWith('effect:'))
    return t('blockedEffect', { effect: effectLabel(t, reason.slice(7)) })
  return t('blockedGeneric', { reason })
}

/** 系统是否已经替用户执行过这张卡的票拟（宿主写 advice-applied 事件）。 */
export function isAdviceApplied(card: Pick<Card, 'events'>): boolean {
  return card.events.some((event) => event.type === 'advice-applied')
}
