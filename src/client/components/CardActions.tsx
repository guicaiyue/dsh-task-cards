// 卡片行右侧的按钮组：按 kind/source/status 决定出现哪几个。
//
// 观察者写的 info 卡是通知：看到即已读（CardRow 里自动 acknowledge），
// 不给「知道了 / 忽略」这种没有行为差异的二选一。人手写的备忘才需要自己勾掉。

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

/** 主操作：决策卡批准、手写备忘知道了、自动卡立即执行。通知卡没有主操作。 */
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
  if (card.source === 'agent') return null
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

/** 其余操作：忽略/重开、查看详情、删除。通知卡只有删除（它已经自动已读）。 */
function RestActions({ t, card, busy, closed, onAction, onDetail }: Props) {
  const remove = (
    <button
      type="button"
      className="dtc-btn is-danger"
      disabled={busy}
      onClick={() => onAction(card, 'delete')}
    >
      {t('remove')}
    </button>
  )
  // 通知卡没有「忽略」：忽略一条通知和读过它没有区别，判例库也不该收这个选择。
  if (card.kind === 'info') {
    return <>{remove}</>
  }
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
      {remove}
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
