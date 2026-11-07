// 卡片行右侧的按钮组：按 kind/source/status 决定出现哪几个。
//
// 观察者写的 info 卡是通知：看到即已读（CardRow 里自动 acknowledge），
// 不给「知道了 / 忽略」这种没有行为差异的二选一。人手写的备忘才需要自己勾掉。

import { needsExplicitConfirm } from '../advice'
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

/** 决策卡主操作：澄清/高风险确认先看详情，其余直接批准并执行。 */
function DecisionPrimary({ t, card, busy, onAction, onDetail }: Props) {
  const openDetail = () =>
    onDetail({ card, title: card.title, sessionId: card.origin?.sessionId || '' })
  if (card.ask === 'clarification') {
    return (
      <button type="button" className="dtc-btn is-primary" disabled={busy} onClick={openDetail}>
        {t('clarifyOpen')}
      </button>
    )
  }
  if (card.ask === 'permission' && needsExplicitConfirm(card.advice)) {
    return (
      <button type="button" className="dtc-btn is-primary" disabled={busy} onClick={openDetail}>
        {t('confirmInDetail')}
      </button>
    )
  }
  return (
    <button
      type="button"
      className="dtc-btn is-primary"
      disabled={busy}
      onClick={() => onAction(card, 'approve')}
    >
      {card.ask === 'permission' ? t('approveAndRun') : t('approve')}
    </button>
  )
}

/** 主操作：决策卡批准、手写备忘知道了、自动卡立即执行。通知卡没有主操作。 */
function PrimaryAction(props: Props) {
  const { t, card, busy, onAction } = props
  if (card.kind === 'decision') return <DecisionPrimary {...props} />
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

/** 删除：所有车道都有。 */
function RemoveButton({ t, card, busy, onAction }: Props) {
  return (
    <button
      type="button"
      className="dtc-btn is-danger"
      disabled={busy}
      onClick={() => onAction(card, 'delete')}
    >
      {t('remove')}
    </button>
  )
}

/** 关闭动作：重开 / 许可拒绝 / 普通忽略。 */
function CloseAction({ t, card, busy, closed, onAction }: Props) {
  if (closed) {
    return (
      <button
        type="button"
        className="dtc-btn"
        disabled={busy}
        onClick={() => onAction(card, 'reopen')}
      >
        {t('reopen')}
      </button>
    )
  }
  if (card.kind === 'decision' && card.ask === 'permission') {
    return (
      <button
        type="button"
        className="dtc-btn is-danger"
        disabled={busy}
        onClick={() => onAction(card, 'deny')}
      >
        {t('deny')}
      </button>
    )
  }
  return (
    <button
      type="button"
      className="dtc-btn"
      disabled={busy}
      onClick={() => onAction(card, 'dismiss')}
    >
      {t('dismiss')}
    </button>
  )
}

/** 决策卡查看详情。 */
function DetailButton({ t, card, busy, closed, onDetail }: Props) {
  if (card.kind !== 'decision' || closed) return null
  return (
    <button
      type="button"
      className="dtc-btn"
      disabled={busy}
      onClick={() => onDetail({ card, title: card.title, sessionId: card.origin?.sessionId || '' })}
    >
      {t('detail')}
    </button>
  )
}

/** 其余操作：通知卡只有删除；其它卡是关闭 + 详情 + 删除。 */
function RestActions(props: Props) {
  if (props.card.kind === 'info') return <RemoveButton {...props} />
  return (
    <>
      <CloseAction {...props} />
      <DetailButton {...props} />
      <RemoveButton {...props} />
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
