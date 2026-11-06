// 卡片行右侧的按钮组：按 kind/status 决定出现哪几个。

import type { Card, CardActionName, Translate } from '../types'

export interface CardHandlers {
  onAction: (card: Card, action: CardActionName, option?: string) => void
  onDetail: (target: { card: Card; title: string; sessionId: string }) => void
}

interface Props extends CardHandlers {
  t: Translate
  card: Card
  busy: boolean
  closed: boolean
}

/** 主操作：决策卡批准、知晓卡知道了、自动卡立即执行。 */
function PrimaryAction({ t, card, busy, onAction }: Props) {
  if (card.kind === 'decision') {
    return (
      <button
        type="button"
        className="dtc-btn is-primary"
        disabled={busy}
        onClick={() => onAction(card, 'approve')}
      >
        {t('approve')}
      </button>
    )
  }
  if (card.kind === 'auto') {
    return (
      <button
        type="button"
        className="dtc-btn is-primary"
        disabled={busy}
        onClick={() => onAction(card, 'run-now')}
      >
        {t('runNow')}
      </button>
    )
  }
  return (
    <button
      type="button"
      className="dtc-btn is-primary"
      disabled={busy}
      onClick={() => onAction(card, 'acknowledge')}
    >
      {t('know')}
    </button>
  )
}

/** 其余操作：忽略/重开、查看详情、删除。 */
function RestActions({ t, card, busy, closed, onAction, onDetail }: Props) {
  return (
    <>
      {closed ? (
        <button
          type="button"
          className="dtc-btn"
          disabled={busy}
          onClick={() => onAction(card, 'reopen')}
        >
          {t('reopen')}
        </button>
      ) : (
        <button
          type="button"
          className="dtc-btn"
          disabled={busy}
          onClick={() => onAction(card, 'dismiss')}
        >
          {t('dismiss')}
        </button>
      )}
      {card.kind === 'decision' && !closed ? (
        <button
          type="button"
          className="dtc-btn"
          disabled={busy}
          onClick={() =>
            onDetail({ card, title: card.title, sessionId: card.origin?.sessionId || '' })
          }
        >
          {t('detail')}
        </button>
      ) : null}
      <button
        type="button"
        className="dtc-btn is-danger"
        disabled={busy}
        onClick={() => onAction(card, 'delete')}
      >
        {t('remove')}
      </button>
    </>
  )
}

export function CardActions(props: Props) {
  return (
    <div className="dtc-actions">
      {props.closed ? null : <PrimaryAction {...props} />}
      <RestActions {...props} />
    </div>
  )
}
