// 会话详情弹窗：一张卡 + 它所属会话的时间线。

import { useEffect, useRef, useState } from 'react'
import { timeLabel } from '../time'
import type { Card, CardActionName, DetailState, Translate, Turn } from '../types'
import { ModalCardBlock } from './ModalCardBlock'
import { TurnBlock } from './TurnBlock'

const DEFAULT_VISIBLE_TURNS = 3

interface Props {
  t: Translate
  detail: DetailState
  busy: boolean
  onClose: () => void
  onOpenSession: (sessionId: string) => void
  onAction: (card: Card, action: CardActionName, option?: string) => void
}

export function DetailModal({ t, detail, busy, onClose, onOpenSession, onAction }: Props) {
  const [showAll, setShowAll] = useState(false)
  const maskRef = useRef<HTMLDivElement | null>(null)

  // Esc 关闭 + 点遮罩关闭：都挂在 document 上，
  // 静态容器只负责布局，不挂交互 handler（也避免 a11y 误伤）。
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
  }, [onClose])

  return (
    <div className="dtc-modal-mask" ref={maskRef}>
      <div
        className="dtc-modal"
        role="dialog"
        aria-modal="true"
        aria-label={detail.title || t('modalTitle')}
      >
        <ModalHeader t={t} detail={detail} onClose={onClose} onOpenSession={onOpenSession} />
        {detail.card ? (
          <ModalCardBlock t={t} card={detail.card} busy={busy} onAction={onAction} />
        ) : null}
        <ModalMetaBar t={t} detail={detail} />
        <div className="dtc-modal-body">
          <ModalTimeline
            t={t}
            detail={detail}
            showAll={showAll}
            onShowAll={() => setShowAll(true)}
          />
        </div>
      </div>
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
