// 详情弹窗顶部的「这张卡本身」：标题、明细、来源、车道专属动作。

import { useState } from 'react'
import { isClosed } from '../../shared/state'
import { blockedReasonLabel, effectLabel, needsExplicitConfirm } from '../advice'
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
  // 旧卡可能只被票拟纠正过车道，顶层 ask 还没回填；展示时以票拟为准。
  const ask = card.ask || card.advice?.ask || 'judgment'
  return (
    <div className="dtc-card-block">
      <div className="dtc-card-block-title">{card.title}</div>
      {card.detail ? <div className="dtc-card-block-detail">{card.detail}</div> : null}
      <SourceBlock t={t} card={card} />
      <QuestionOptions
        t={t}
        card={card}
        busy={busy}
        onAnswer={(target, option) => onAction(target, 'answer', option)}
        disabled={closed}
      />
      {closed ? (
        <div className="dtc-hint">{t('alreadyClosed')}</div>
      ) : ask === 'permission' ? (
        <PermissionBlock t={t} card={card} busy={busy} onAction={onAction} />
      ) : ask === 'clarification' ? (
        <ClarificationBlock t={t} card={card} busy={busy} onAction={onAction} />
      ) : (
        <CardBlockActions t={t} card={card} busy={busy} onAction={onAction} />
      )}
    </div>
  )
}

function SourceBlock({ t, card }: { t: Translate; card: Card }) {
  const origin = card.origin
  if (!origin) return null
  return (
    <div className="dtc-source-block">
      {origin.triggerText ? (
        <div className="dtc-source-row">
          <span>{t('sourceTrigger')}</span>
          <span>{origin.triggerText}</span>
        </div>
      ) : null}
      {origin.userQuote && origin.userQuote !== origin.triggerText ? (
        <div className="dtc-source-row">
          <span>{t('sourceUser')}</span>
          <span>{origin.userQuote}</span>
        </div>
      ) : null}
      {origin.sourceKind === 'card-answer' ? (
        <div className="dtc-source-row">
          <span>{t('sourceSystem')}</span>
          <span>{origin.sourceCardId || t('sourceSystemUnknown')}</span>
        </div>
      ) : null}
      {origin.uiCardId ? (
        <div className="dtc-source-row">
          <span>{t('sourceUi')}</span>
          <span>{origin.uiCardId}</span>
        </div>
      ) : null}
      {origin.reason ? (
        <div className="dtc-origin-reason">{t('originReason', { reason: origin.reason })}</div>
      ) : null}
    </div>
  )
}

function PermissionBlock({ t, card, busy, onAction }: Props) {
  const advice = card.advice
  const [confirmed, setConfirmed] = useState(false)
  const risky = needsExplicitConfirm(advice)
  return (
    <div className="dtc-permission">
      <div className="dtc-permission-title">{t('permissionWillDo')}</div>
      <div className="dtc-permission-action">{advice?.action || card.detail || card.title}</div>
      <div className="dtc-permission-meta">
        <span>{t('permissionScope', { scope: advice?.scope || '—' })}</span>
        <span>{t('permissionEffect', { effect: effectLabel(t, advice?.effect) })}</span>
        <span>{t('permissionReversible', { value: advice?.reversible ? t('yes') : t('no') })}</span>
      </div>
      {advice?.blockedReasons?.length ? (
        <div className="dtc-hint">
          {t('blockedReasons', {
            reasons: advice.blockedReasons
              .map((reason) => blockedReasonLabel(t, reason))
              .join('；'),
          })}
        </div>
      ) : null}
      {risky ? (
        <label className="dtc-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>{t('confirmRisk')}</span>
        </label>
      ) : null}
      <div className="dtc-actions">
        <button
          type="button"
          className="dtc-btn is-primary"
          disabled={busy || (risky && !confirmed)}
          onClick={() => onAction(card, 'approve')}
        >
          {t('approveAndRun')}
        </button>
        <button
          type="button"
          className="dtc-btn is-danger"
          disabled={busy}
          onClick={() => onAction(card, 'deny')}
        >
          {t('deny')}
        </button>
      </div>
    </div>
  )
}

function ClarificationBlock({ t, card, busy, onAction }: Props) {
  const [value, setValue] = useState('')
  const advice = card.advice
  const question = advice?.question || card.detail || card.title
  const candidates = advice?.candidates || []
  return (
    <div className="dtc-clarification">
      <div className="dtc-permission-title">{t('clarifyQuestion')}</div>
      <div className="dtc-permission-action">{question}</div>
      {candidates.length ? (
        <div className="dtc-actions">
          {candidates.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="dtc-btn"
              disabled={busy}
              onClick={() => onAction(card, 'answer', candidate)}
            >
              {candidate}
            </button>
          ))}
        </div>
      ) : null}
      <div className="dtc-actions">
        <input
          className="dtc-input"
          value={value}
          placeholder={t('clarifyPlaceholder')}
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          type="button"
          className="dtc-btn is-primary"
          disabled={busy || !value.trim()}
          onClick={() => onAction(card, 'answer', value.trim())}
        >
          {t('clarifySubmit')}
        </button>
      </div>
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
    </div>
  )
}
