// 阻塞式提问生成的卡：选项就是回答入口。
//
// 单题卡保持「点一下直接作答」；多题卡**逐题分组**，每题只能选一个，全部选完才给提交——
// 真实事故里 3 题 7 个选项被平铺，点一个选项被当成所有题的答案。

import { useState } from 'react'

import type { AnswerSelection, Card, Translate } from '../types'

type Items = NonNullable<Card['question']>['items']

interface Props {
  t: Translate
  card: Card
  busy: boolean
  onAnswer: (card: Card, option: string, answers?: AnswerSelection[]) => void
  disabled?: boolean
}

/** 投递文本兜底：逐题「问题 → 选择」，宿主侧还会再按 answers 结构化投递。 */
function pickText(items: Items, answers: AnswerSelection[]): string {
  return answers
    .map(
      (answer, index) => `${items[index]?.question ?? answer.id} → ${answer.selected.join(' / ')}`,
    )
    .join('；')
}

/** 多题：逐题分组 + 全部选完才可提交。 */
function MultiQuestion({ t, card, items, busy, onAnswer, disabled }: Props & { items: Items }) {
  const [picked, setPicked] = useState<Record<string, string>>({})
  const complete = items.every((item) => picked[item.id])
  const submit = () => {
    if (!complete) return
    const answers: AnswerSelection[] = items.map((item) => ({
      id: item.id,
      selected: [picked[item.id] ?? ''],
    }))
    onAnswer(card, pickText(items, answers), answers)
  }
  return (
    <div className="dtc-options">
      <span className="dtc-hint">{t('answerEachHint')}</span>
      {items.map((item) => (
        <div className="dtc-qitem" key={`${card.id}-${item.id}`}>
          <div className="dtc-qitem-title">{item.question}</div>
          <div className="dtc-qrow">
            {(item.options || []).map((label) => (
              <button
                key={`${card.id}-${item.id}-${label}`}
                type="button"
                className={`dtc-option${picked[item.id] === label ? ' is-picked' : ''}`}
                disabled={busy || disabled}
                onClick={() => setPicked((prev) => ({ ...prev, [item.id]: label }))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        className="dtc-btn is-primary"
        disabled={busy || disabled || !complete}
        onClick={submit}
      >
        {t('answerSubmit')}
      </button>
    </div>
  )
}

export function QuestionOptions(props: Props) {
  const { t, card, busy, onAnswer, disabled = false } = props
  const items = card.question?.items || []
  if (!items.length) return null
  const hasOptions = items.some((item) => (item.options || []).length > 0)
  if (!hasOptions) return null

  // 单题卡：保持原有的一键作答，不退化。
  if (items.length === 1) {
    const only = items[0]
    return (
      <div className="dtc-options">
        <span className="dtc-hint">{t('answerHint')}</span>
        {(only?.options || []).map((label) => (
          <button
            key={`${card.id}-${only?.id}-${label}`}
            type="button"
            className="dtc-option"
            disabled={busy || disabled}
            onClick={() => onAnswer(card, label)}
          >
            {label}
          </button>
        ))}
      </div>
    )
  }
  return (
    <MultiQuestion
      t={t}
      card={card}
      items={items}
      busy={busy}
      onAnswer={onAnswer}
      disabled={disabled}
    />
  )
}
