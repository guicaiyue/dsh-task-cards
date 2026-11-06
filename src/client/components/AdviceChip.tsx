// 卡片行里的一行票拟：结论 chip（结论 + 一句话摘要 + 把握），没票拟时给出重出按钮。
//
// 只占一行，不挤掉标题/时间/kind；摘要过长用 CSS 省略，hover 看全文。

import { confidenceLabel, verdictLabel, verdictTone } from '../advice'
import type { Card, Translate } from '../types'

interface Props {
  t: Translate
  card: Card
  busy: boolean
  onRedecide: (card: Card) => void
}

export function AdviceChip({ t, card, busy, onRedecide }: Props) {
  const advice = card.advice
  if (!advice) {
    return (
      <div className="dtc-advice-line">
        <span className="dtc-chip is-pending">{t('advicePending')}</span>
        <button type="button" className="dtc-btn" disabled={busy} onClick={() => onRedecide(card)}>
          {t('adviceRedecide')}
        </button>
      </div>
    )
  }
  return (
    <div className="dtc-advice-line">
      <span className={`dtc-chip ${verdictTone(advice.verdict)}`}>
        {verdictLabel(t, advice.verdict)}
      </span>
      {advice.summary ? (
        <span className="dtc-advice-line-summary" title={advice.summary}>
          {advice.summary}
        </span>
      ) : null}
      <span className="dtc-advice-line-confidence">{confidenceLabel(t, advice.confidence)}</span>
    </div>
  )
}
