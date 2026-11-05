// 阻塞式提问生成的卡：选项就是回答入口，点一下把答案发回原会话。

import type { Card, Translate } from '../types'

interface Props {
  t: Translate
  card: Card
  busy: boolean
  onAnswer: (card: Card, option: string) => void
  disabled?: boolean
}

export function QuestionOptions({ t, card, busy, onAnswer, disabled = false }: Props) {
  const items = card.question?.items || []
  if (!items.length) return null
  const options = items.flatMap((item) => (item.options || []).map((label) => ({ label, item })))
  if (!options.length) return null
  return (
    <div className="dtc-options">
      <span className="dtc-hint">{t('answerHint')}</span>
      {options.map((option) => (
        <button
          key={`${card.id}-${option.item.id}-${option.label}`}
          type="button"
          className="dtc-option"
          disabled={busy || disabled}
          onClick={() => onAnswer(card, option.label)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
