// 详情弹窗顶部的「这张卡本身」：标题、明细、选项、动作。

import { isClosed } from '../../shared/state'
import type { Card, CardActionName, Translate } from '../types'
import { QuestionOptions } from './QuestionOptions'

interface Props {
  t: Translate
  card: Card
  busy: boolean
  onAction: (card: Card, action: CardActionName, option?: string) => void
}

export function ModalCardBlock({ t, card, busy, onAction }: Props) {
  const closed = isClosed(card.status)
  return (
    <div className="dtc-card-block">
      <div className="dtc-card-block-title">{card.title}</div>
      {card.detail ? <div className="dtc-card-block-detail">{card.detail}</div> : null}
      {card.origin?.reason ? (
        <div className="dtc-origin-reason">{t('originReason', { reason: card.origin.reason })}</div>
      ) : null}
      <QuestionOptions
        t={t}
        card={card}
        busy={busy}
        onAnswer={(target, option) => onAction(target, 'answer', option)}
        disabled={closed}
      />
      {closed ? (
        <div className="dtc-hint">{t('alreadyClosed')}</div>
      ) : (
        <CardBlockActions t={t} card={card} busy={busy} onAction={onAction} />
      )}
    </div>
  )
}

function CardBlockActions({ t, card, busy, onAction }: Props) {
  return (
    <div className="dtc-actions" style={{ marginTop: '10px' }}>
      {card.kind === 'decision' ? (
        <button
          type="button"
          className="dtc-btn is-primary"
          disabled={busy}
          onClick={() => onAction(card, 'approve')}
        >
          {t('approve')}
        </button>
      ) : null}
      {card.kind === 'info' && card.source === 'human' ? (
        <button
          type="button"
          className="dtc-btn is-primary"
          disabled={busy}
          onClick={() => onAction(card, 'acknowledge')}
        >
          {t('know')}
        </button>
      ) : null}
      {card.kind === 'auto' ? (
        <button
          type="button"
          className="dtc-btn is-primary"
          disabled={busy}
          onClick={() => onAction(card, 'run-now')}
        >
          {t('runNow')}
        </button>
      ) : null}
      {card.kind === 'info' ? null : (
        <button
          type="button"
          className="dtc-btn"
          disabled={busy}
          onClick={() => onAction(card, 'dismiss')}
        >
          {t('dismiss')}
        </button>
      )}
      <button
        type="button"
        className="dtc-btn is-danger"
        disabled={busy}
        onClick={() => onAction(card, 'delete')}
      >
        {t('remove')}
      </button>
    </div>
  )
}
