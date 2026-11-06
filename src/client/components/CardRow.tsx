// 一行卡片：左侧色轨标 kind，中间标题/明细/元信息/票拟，右侧动作。
// 同一行既能在会话树里出现，也能单独使用，所以只接最小 props。

import { useEffect, useRef } from 'react'

import { isClosed } from '../../shared/state'
import type { Card, Translate } from '../types'
import { AdviceChip } from './AdviceChip'
import { CardActions, type CardHandlers } from './CardActions'
import { CardMeta } from './CardMeta'
import { QuestionOptions } from './QuestionOptions'

interface Props extends CardHandlers {
  t: Translate
  card: Card
  busy: boolean
  onAnswer: (card: Card, option: string) => void
  onRedecide: (card: Card) => void
}

export function CardRow({ t, card, busy, onAction, onAnswer, onDetail, onRedecide }: Props) {
  const isDecision = card.kind === 'decision'
  const isAuto = card.kind === 'auto'
  const closed = isClosed(card.status)
  const cls = `dtc-card${isDecision ? ' is-decision' : isAuto ? ' is-auto' : ''}${closed ? ' is-closed' : ''}`
  // 观察者写的 info 卡是通知：渲染到就算已读，不再要人点一下。
  // 只对 agent 卡——人手写的备忘还要人自己勾掉。
  const autoRead = useRef(false)
  useEffect(() => {
    if (autoRead.current) return
    if (busy || card.kind !== 'info' || card.source !== 'agent' || card.status !== 'open') return
    autoRead.current = true
    onAction(card, 'acknowledge')
  }, [busy, card, onAction])
  return (
    <div className={cls}>
      <div className="dtc-rail" />
      <div className="dtc-main">
        <div className="dtc-text">{card.title}</div>
        {card.detail ? <div className="dtc-detail">{card.detail}</div> : null}
        <CardMeta t={t} card={card} closed={closed} />
        {isDecision && (card.advice || !closed) ? (
          <AdviceChip t={t} card={card} busy={busy} onRedecide={onRedecide} />
        ) : null}
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
