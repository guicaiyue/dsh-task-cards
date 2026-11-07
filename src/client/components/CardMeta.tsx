// 卡片行里的元信息：种类、来源、时间、计划时间、执行时间、上次失败。

import { timeLabel } from '../time'
import type { Card, Translate } from '../types'

interface Props {
  t: Translate
  card: Card
  closed: boolean
}

export function CardMeta({ t, card, closed }: Props) {
  const kindLabel =
    card.kind === 'decision'
      ? t('groupDecision')
      : card.kind === 'auto'
        ? t('groupAuto')
        : t('groupInfo')
  const chipClass =
    card.kind === 'decision' ? ' is-decision' : card.kind === 'auto' ? ' is-auto' : ''
  return (
    <div className="dtc-meta">
      <span className={`dtc-chip${chipClass}`}>{kindLabel}</span>
      <span>{card.source === 'agent' ? t('fromAgent') : t('fromHuman')}</span>
      {card.silent ? <span className="dtc-chip is-silent">{t('silentChip')}</span> : null}
      <span>{timeLabel(closed ? card.updatedAt : card.createdAt)}</span>
      {card.kind === 'auto' && card.dueAt && !closed ? (
        <span>{t('dueAt', { time: timeLabel(card.dueAt) })}</span>
      ) : null}
      {card.executedAt ? <span>{t('ranAt', { time: timeLabel(card.executedAt) })}</span> : null}
      {card.lastError ? (
        <span className="dtc-chip is-decision">
          {t('failReason', { reason: card.lastError.slice(0, 60) })}
        </span>
      ) : null}
    </div>
  )
}
