// 会话详情弹窗：一张卡（含票拟）+ 它所属会话的时间线。

import { useEffect, useRef, useState } from 'react'
import { isClosed } from '../../shared/state'
import { timeLabel } from '../time'
import type { Card, CardActionName, DetailState, Precedent, Translate, Turn } from '../types'
import { AdviceBlock } from './AdviceBlock'
import { ModalCardBlock } from './ModalCardBlock'
import { TurnBlock } from './TurnBlock'

const DEFAULT_VISIBLE_TURNS = 3

interface Props {
  t: Translate
  detail: DetailState
  /** 判例库：票拟里引用了编号时点开可看。 */
  precedents: Precedent[]
  busy: boolean
  onClose: () => void
  onOpenSession: (sessionId: string) => void
  onAction: (card: Card, action: CardActionName, option?: string) => void
  onAdopt: (card: Card, index: number) => void
  onReworked: (card: Card, note: string) => void
}

export function DetailModal({
  t,
  detail,
  precedents,
  busy,
  onClose,
  onOpenSession,
  onAction,
  onAdopt,
  onReworked,
}: Props) {
  const [showAll, setShowAll] = useState(false)
  const maskRef = useRef<HTMLDivElement | null>(null)
  useModalDismiss(maskRef, onClose)
  const card = detail.card

  return (
    <div className="dtc-modal-mask" ref={maskRef}>
      <div
        className="dtc-modal"
        role="dialog"
        aria-modal="true"
        aria-label={detail.title || t('modalTitle')}
      >
        <ModalHeader t={t} detail={detail} onClose={onClose} onOpenSession={onOpenSession} />
        {card ? <ModalCardBlock t={t} card={card} busy={busy} onAction={onAction} /> : null}
        <ModalMetaBar t={t} detail={detail} />
        <ModalBody
          t={t}
          detail={detail}
          precedents={precedents}
          busy={busy}
          showAll={showAll}
          onShowAll={() => setShowAll(true)}
          onAdopt={onAdopt}
          onReworked={onReworked}
        />
      </div>
    </div>
  )
}

// Esc 关闭 + 点遮罩关闭：都挂在 document 上，
// 静态容器只负责布局，不挂交互 handler（也避免 a11y 误伤）。
function useModalDismiss(maskRef: { current: HTMLDivElement | null }, onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onDown = (event: MouseEvent) => {
      if (event.target === maskRef.current) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [maskRef, onClose])
}

interface BodyProps {
  t: Translate
  detail: DetailState
  precedents: Precedent[]
  busy: boolean
  showAll: boolean
  onShowAll: () => void
  onAdopt: (card: Card, index: number) => void
  onReworked: (card: Card, note: string) => void
}

function ModalBody({
  t,
  detail,
  precedents,
  busy,
  showAll,
  onShowAll,
  onAdopt,
  onReworked,
}: BodyProps) {
  const card = detail.card
  const advice = card?.advice ?? null
  return (
    <div className="dtc-modal-body">
      {card && advice ? (
        <AdviceBlock
          t={t}
          advice={advice}
          cardKind={card.kind}
          precedents={precedents}
          busy={busy}
          closed={isClosed(card.status)}
          onAdopt={(index) => onAdopt(card, index)}
          onReworked={(note) => onReworked(card, note)}
        />
      ) : null}
      <ModalTimeline t={t} detail={detail} showAll={showAll} onShowAll={onShowAll} />
    </div>
  )
}

interface HeaderProps {
  t: Translate
  detail: DetailState
  onClose: () => void
  onOpenSession: (sessionId: string) => void
}

function ModalHeader({ t, detail, onClose, onOpenSession }: HeaderProps) {
  return (
    <div className="dtc-modal-head">
      <div className="dtc-modal-title">{detail.title || detail.sessionId || t('modalTitle')}</div>
      {detail.sessionId ? (
        <button
          type="button"
          className="dtc-btn is-primary"
          onClick={() => onOpenSession(detail.sessionId)}
        >
          {t('openSession')}
        </button>
      ) : null}
      <button type="button" className="dtc-btn" onClick={onClose}>
        {t('close')}
      </button>
    </div>
  )
}

function ModalMetaBar({ t, detail }: { t: Translate; detail: DetailState }) {
  const turns = detail.turns
  return (
    <div className="dtc-modal-meta">
      <span>{t('metaTurns', { n: turns.length })}</span>
      {turns.length ? (
        <span>{t('lastAt', { time: timeLabel(turns[turns.length - 1]?.at) })}</span>
      ) : null}
      {detail.sessionId ? <code>{detail.sessionId}</code> : null}
    </div>
  )
}

interface TimelineProps {
  t: Translate
  detail: DetailState
  showAll: boolean
  onShowAll: () => void
}

function ModalTimeline({ t, detail, showAll, onShowAll }: TimelineProps) {
  const turns = detail.turns
  if (detail.loading) return <div className="dtc-hint">{t('loading')}</div>
  if (turns.length === 0) return <div className="dtc-hint">{detail.error || t('modalEmpty')}</div>
  const visible = showAll ? turns : turns.slice(-DEFAULT_VISIBLE_TURNS)
  const hidden = turns.length - visible.length
  return (
    <div className="dtc-timeline">
      {hidden > 0 ? (
        <button type="button" className="dtc-btn dtc-earlier" onClick={onShowAll}>
          {t('showEarlier', { n: hidden })}
        </button>
      ) : null}
      {visible.map((turn: Turn, index: number) => (
        <TurnBlock
          key={`${turn.at ?? ''}-${turn.user.slice(0, 12)}`}
          t={t}
          turn={turn}
          index={hidden + index}
        />
      ))}
    </div>
  )
}
