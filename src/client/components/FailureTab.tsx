// 失败排查：只列 failed / unknown 的卡；选中后并排对照「要求 / 结果 / 判定」。
//
// 结论条先给一句话答案（判成什么、谁判的、为什么），三栏再给证据；
// 补救动作只做真实存在的入口：查看详情、打开会话，不发明端点。

import { useState } from 'react'

import { type FailureCaseState, useFailureCases } from '../hooks/useFailureCases'
import { stageOf, traceShort, waitLabelKey } from '../stage'
import { durationLabel, timeLabel } from '../time'
import type { Card, CaseDetail, Translate } from '../types'

export interface FailureTabProps {
  t: Translate
  cards: Card[]
  onOpenDetail: (card: Card) => void
  onOpenSession: (sessionId: string) => void
}

type CaseEventView = CaseDetail['events'][number]
type EvidenceView = CaseDetail['evidence'][number]

const ACTOR_KEYS: Record<string, string> = {
  observer: 'failActorObserver',
  decision: 'failActorDecision',
  scheduler: 'failActorScheduler',
  executor: 'failActorExecutor',
  verifier: 'failActorVerifier',
  user: 'failActorUser',
  system: 'failActorSystem',
}

const AUTHORITY_KEYS: Record<string, string> = {
  delegated: 'failAuthorityDelegated',
  user: 'failAuthorityUser',
  system: 'failAuthoritySystem',
}

function needsTriage(card: Card): boolean {
  return card.deliveryState === 'failed' || card.deliveryState === 'unknown'
}

/** 结论用验收口径：失败 / 无法判定。 */
function verdictKey(card: Card): string {
  return card.deliveryState === 'unknown' ? 'caseVerifyUnknown' : 'caseVerifyFailed'
}

function verifyEvents(caseInfo: CaseInfo): CaseEventView[] {
  if (!caseInfo) return []
  return caseInfo.events.filter((event) => event.phase === 'verify')
}

type CaseInfo = CaseDetail | null

/** 谁判的：验收器=系统、决策者、用户；其它角色从事件里推不出来时按系统算。 */
function judgeKey(event: CaseEventView | undefined): string {
  if (!event) return 'failJudgeNone'
  if (event.actor === 'decision') return 'failJudgeDecision'
  if (event.actor === 'user') return 'failJudgeUser'
  return 'failJudgeSystem'
}

export function FailureTab({
  t,
  cards,
  onOpenDetail,
  onOpenSession,
}: FailureTabProps): JSX.Element {
  const rows = cards.filter(needsTriage)
  const [picked, setPicked] = useState('')
  const selected: Card | null = rows.find((card) => card.id === picked) ?? rows[0] ?? null
  const caseState = useFailureCases(selected)
  if (!selected) {
    return (
      <div className="dtc-fail">
        <p className="dtc-fail-empty">{t('failEmpty')}</p>
        <p className="dtc-fail-hint">{t('failEmptyHint')}</p>
      </div>
    )
  }
  const verify = verifyEvents(caseState.caseInfo)
  return (
    <div className="dtc-fail">
      <div className="dtc-fail-head">
        <span className="dtc-fail-title">{t('failListTitle')}</span>
        <span className="dtc-fail-count">{t('failListCount', { n: rows.length })}</span>
        <span className="dtc-fail-hint">{t('failSelectHint')}</span>
      </div>
      <ConclusionBar
        t={t}
        card={selected}
        events={verify}
        onOpenDetail={onOpenDetail}
        onOpenSession={onOpenSession}
      />
      <div className="dtc-fail-body">
        <ul className="dtc-fail-list">
          {rows.map((card) => (
            <li key={card.id}>
              <FailureRow
                t={t}
                card={card}
                active={card.id === selected.id}
                onPick={() => setPicked(card.id)}
              />
            </li>
          ))}
        </ul>
        <div className="dtc-fail-cols">
          <RequirementCol t={t} card={selected} />
          <EvidenceCol t={t} state={caseState} />
          <VerdictCol t={t} events={verify} />
        </div>
      </div>
    </div>
  )
}

function FailureRow(props: { t: Translate; card: Card; active: boolean; onPick: () => void }) {
  const { t, card, active, onPick } = props
  const stage = stageOf(card)
  const wait = waitLabelKey(card)
  const tone = card.deliveryState === 'unknown' ? 'is-unknown' : 'is-failed'
  return (
    <button
      type="button"
      className={`dtc-fail-item${active ? ' is-active' : ''}`}
      aria-pressed={active}
      onClick={onPick}
    >
      <span className="dtc-fail-item-top">
        <span className={`dtc-fail-badge ${tone}`}>{t(stage.labelKey)}</span>
        <span className="dtc-fail-item-title">{card.title}</span>
      </span>
      {wait ? (
        <span className="dtc-fail-item-wait">{t('failWait', { reason: t(wait) })}</span>
      ) : null}
      <span className="dtc-fail-item-foot">
        {card.traceId ? <span className="dtc-fail-trace">tr-{traceShort(card)}</span> : null}
        <span className="dtc-fail-item-time">{timeLabel(card.updatedAt)}</span>
      </span>
    </button>
  )
}

/** 顶部结论条：这张卡判成什么、谁判的、一句话原因，以及下一步与本地入口。 */
function ConclusionBar(props: {
  t: Translate
  card: Card
  events: CaseEventView[]
  onOpenDetail: (card: Card) => void
  onOpenSession: (sessionId: string) => void
}) {
  const { t, card, events, onOpenDetail, onOpenSession } = props
  const last = events[events.length - 1]
  const sessionId = card.origin?.sessionId || ''
  const reason = last?.reason || card.lastError || ''
  const unknown = card.deliveryState === 'unknown'
  const nextKey = unknown ? 'failNextUnknown' : 'failNextFailed'
  const openDetail = () => onOpenDetail(card)
  const openSession = () => onOpenSession(sessionId)
  return (
    <div className={`dtc-fail-conclusion${unknown ? ' is-unknown' : ''}`}>
      <div className="dtc-fail-conclusion-top">
        <span className="dtc-fail-verdict">{t(verdictKey(card))}</span>
        <span className="dtc-fail-meta">{t('failJudge', { judge: t(judgeKey(last)) })}</span>
        {card.traceId ? <span className="dtc-fail-meta">tr-{traceShort(card)}</span> : null}
      </div>
      <p className="dtc-fail-reason">{reason || t('failReasonFallback')}</p>
      <p className="dtc-fail-next">{t('failNextStep', { step: t(nextKey) })}</p>
      <div className="dtc-fail-actions">
        <button type="button" className="dtc-fail-btn is-primary" onClick={openDetail}>
          {t('failOpenDetail')}
        </button>
        <button type="button" className="dtc-fail-btn" disabled={!sessionId} onClick={openSession}>
          {t('failOpenSession')}
        </button>
        {sessionId ? null : <span className="dtc-fail-hint">{t('failNoSession')}</span>}
      </div>
    </div>
  )
}

function Field(props: { t: Translate; labelKey: string; value: string; mono?: boolean }) {
  const { t, labelKey, value, mono } = props
  return (
    <div className="dtc-fail-field">
      <span className="dtc-fail-field-label">{t(labelKey)}</span>
      <span className={mono ? 'dtc-fail-mono' : 'dtc-fail-text'}>{value}</span>
    </div>
  )
}

/** ① 卡片要求：这张卡到底要求做到什么。 */
function RequirementCol({ t, card }: { t: Translate; card: Card }) {
  const advice = card.advice
  return (
    <section className="dtc-fail-col">
      <h4 className="dtc-fail-col-h">{t('failColRequirement')}</h4>
      <div className="dtc-fail-lead">{card.title}</div>
      {card.detail ? <p className="dtc-fail-text">{card.detail}</p> : null}
      {advice?.action ? <Field t={t} labelKey="failReqAction" value={advice.action} mono /> : null}
      {advice?.scope ? <Field t={t} labelKey="failReqScope" value={advice.scope} mono /> : null}
      {advice?.effect ? (
        <Field t={t} labelKey="failReqEffect" value={t(`effect_${advice.effect}`)} />
      ) : null}
    </section>
  )
}

function specText(t: Translate, spec: EvidenceView['spec']): string {
  if (spec.kind === 'exit') return t('failSpecExit', { cmd: spec.cmd, code: spec.expect })
  if (spec.kind === 'file') {
    return spec.expect === 'exists'
      ? t('failSpecFileExists', { path: spec.path })
      : t('failSpecFileAbsent', { path: spec.path })
  }
  return t('failSpecHttp', { url: spec.url, code: spec.expect })
}

/** ② 实际结果：checker 取到的边界事实。 */
function EvidenceCol({ t, state }: { t: Translate; state: FailureCaseState }) {
  const evidence = state.caseInfo?.evidence ?? []
  const empty = !state.loading && !state.error && !evidence.length
  return (
    <section className="dtc-fail-col">
      <h4 className="dtc-fail-col-h">{t('failColActual')}</h4>
      {state.loading && !evidence.length ? (
        <p className="dtc-fail-note">{t('failEvidenceLoading')}</p>
      ) : null}
      {state.error ? (
        <p className="dtc-fail-note">{t('failEvidenceError', { error: state.error })}</p>
      ) : null}
      {empty ? <p className="dtc-fail-note">{t('failEvidenceEmpty')}</p> : null}
      {evidence.map((record) => (
        <div key={record.id} className="dtc-fail-evi">
          <div className="dtc-fail-evi-head">
            <span className={record.ok ? 'dtc-fail-ok' : 'dtc-fail-bad'}>
              {record.ok ? t('failOk') : t('failNotOk')}
            </span>
            <span className="dtc-fail-dur">
              {t('failDuration', { duration: durationLabel(record.durationMs) })}
            </span>
          </div>
          <span className="dtc-fail-mono">{specText(t, record.spec)}</span>
          {record.detail ? <p className="dtc-fail-text">{record.detail}</p> : null}
          {record.error ? <p className="dtc-fail-note">{record.error}</p> : null}
        </div>
      ))}
    </section>
  )
}

/** ③ 验收判定：verify 阶段的事件（谁、什么授权、为什么、何时）。 */
function VerdictCol({ t, events }: { t: Translate; events: CaseEventView[] }) {
  return (
    <section className="dtc-fail-col">
      <h4 className="dtc-fail-col-h">{t('failColVerdict')}</h4>
      {events.length ? null : <p className="dtc-fail-note">{t('failVerdictEmpty')}</p>}
      {events.map((event) => (
        <div key={event.id} className="dtc-fail-verify">
          <span className="dtc-fail-meta">
            {t('failVerdictActor', { actor: t(ACTOR_KEYS[event.actor] ?? 'failActorSystem') })}
          </span>
          <span className="dtc-fail-meta">
            {t('failVerdictAuthority', {
              authority: t(AUTHORITY_KEYS[event.authority] ?? 'failAuthoritySystem'),
            })}
          </span>
          {event.reason ? (
            <p className="dtc-fail-text">{t('failVerdictReason', { reason: event.reason })}</p>
          ) : null}
          <p className="dtc-fail-note">{t('failVerdictAt', { time: timeLabel(event.at) })}</p>
        </div>
      ))}
    </section>
  )
}
