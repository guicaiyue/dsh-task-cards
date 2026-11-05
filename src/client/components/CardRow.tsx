// 一行卡片：左侧色轨标 kind，中间标题/明细/元信息，右侧动作。
// 同一行既能在会话树里出现，也能单独使用，所以只接最小 props。

import { isClosed } from '../../shared/state'
import type { Card, Translate } from '../types'
import { CardActions, type CardHandlers } from './CardActions'
import { CardMeta } from './CardMeta'
import { QuestionOptions } from './QuestionOptions'

interface Props extends CardHandlers {
  t: Translate
  card: Card
  busy: boolean
  onAnswer: (card: Card, option: string) => void
}

export function CardRow({ t, card, busy, onAction, onAnswer, onDetail }: Props) {
  const isDecision = card.kind === 'decision'
  const isAuto = card.kind === 'auto'
  const closed = isClosed(card.status)
  const cls = `dtc-card${isDecision ? ' is-decision' : isAuto ? ' is-auto' : ''}${closed ? ' is-closed' : ''}`
  return (
    <div className={cls}>
      <div className="dtc-rail" />
      <div className="dtc-main">
        <div className="dtc-text">{card.title}</div>
        {card.detail ? <div className="dtc-detail">{card.detail}</div> : null}
        <CardMeta t={t} card={card} closed={closed} />
        {card.interaction === 'question' && !closed ? (
          <QuestionOptions t={t} card={card} busy={busy} onAnswer={onAnswer} />
        ) : null}
      </div>
      <CardActions
        t={t}
        card={card}
        busy={busy}
        closed={closed}
        onAction={onAction}
        onDetail={onDetail}
      />
    </div>
  )
}
