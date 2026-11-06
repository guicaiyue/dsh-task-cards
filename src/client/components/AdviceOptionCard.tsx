// 票拟里的一个方案：名称、成本、长期收益、最坏情况，加一个「采纳」按钮。
//
// 四栏就是用户批红时对照的东西；answer 是采纳后替用户发回原会话的那句话。

import { verdictLabel, verdictTone } from '../advice'
import type { AdviceOption, Translate } from '../types'

interface Props {
  t: Translate
  option: AdviceOption
  index: number
  busy: boolean
  closed: boolean
  onAdopt: (index: number) => void
}

export function AdviceOptionCard({ t, option, index, busy, closed, onAdopt }: Props) {
  return (
    <div className="dtc-advice-option">
      <div className="dtc-advice-option-head">
        <span className="dtc-advice-option-name">{option.name}</span>
        <span className={`dtc-chip ${verdictTone(option.verdict)}`}>
          {verdictLabel(t, option.verdict)}
        </span>
        <button
          type="button"
          className="dtc-btn is-primary"
          disabled={busy || closed}
          onClick={() => onAdopt(index)}
        >
          {t('adviceAdopt')}
        </button>
      </div>
      <dl className="dtc-advice-facts">
        <Fact label={t('adviceCost')} value={option.cost} />
        <Fact label={t('adviceGain')} value={option.gain} />
        <Fact label={t('adviceWorst')} value={option.worst} />
      </dl>
      {option.answer ? (
        <div className="dtc-advice-answer">{t('adviceAnswer', { answer: option.answer })}</div>
      ) : null}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || '—'}</dd>
    </div>
  )
}
