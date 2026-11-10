// 记录屏：跨卡的最近事件。排障第一入口 —— 先看「它到底动没动」。
//
// 行可点：打开对应卡的详情（卡片不存在时给一句说明，不假装成功）。

import { useMemo, useState } from 'react'
import { useRecords } from '../hooks/useRecords'
import { timeLabel } from '../time'
import type { Card, RecordRow, Translate } from '../types'

const PHASE_FILTERS = ['all', 'sense', 'decide', 'execute', 'verify', 'closed'] as const
type PhaseFilter = (typeof PHASE_FILTERS)[number]

interface Props {
  t: Translate
  active: boolean
  cards: Card[]
  onDetail: (card: Card) => void
}

const PHASE_KEYS: Record<string, string> = {
  sense: 'recordPhaseSense',
  decide: 'recordPhaseDecide',
  execute: 'recordPhaseExecute',
  verify: 'recordPhaseVerify',
  closed: 'recordPhaseClosed',
  observe: 'recordPhaseObserve',
}

export function RecordsTab({ t, active, cards, onDetail }: Props) {
  const state = useRecords(active)
  const [phase, setPhase] = useState<PhaseFilter>('all')
  const [query, setQuery] = useState('')
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const visible = useMemo(
    () => state.records.filter((row) => matchRow(row, phase, query, byId.get(row.caseId))),
    [state.records, phase, query, byId],
  )
  if (state.loading && !state.records.length)
    return <p className="dtc-rec-empty">{t('recordLoading')}</p>
  if (state.error)
    return <p className="dtc-rec-empty">{t('recordError', { error: state.error })}</p>
  if (!state.records.length) return <p className="dtc-rec-empty">{t('recordEmpty')}</p>
  return (
    <div className="dtc-rec">
      <div className="dtc-rec-head">
        <span>{t('recordCount', { n: state.records.length })}</span>
        {state.truncated ? <span className="dtc-rec-hint">{t('recordTruncated')}</span> : null}
        <span className="dtc-spacer" />
        <input
          className="dtc-input dtc-rec-search"
          value={query}
          placeholder={t('recordSearch')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="dtc-btn" onClick={state.refresh}>
          {t('refresh')}
        </button>
      </div>
      <div className="dtc-filterbar">
        {PHASE_FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            className={`dtc-filter${phase === item ? ' is-on' : ''}`}
            onClick={() => setPhase(item)}
          >
            {t(PHASE_KEYS[item] ?? 'filter_all')}
          </button>
        ))}
      </div>
      {!visible.length ? <p className="dtc-rec-empty">{t('recordNoMatch')}</p> : null}
      <ul className="dtc-rec-list">
        {visible.map((row) => (
          <RecordLine
            key={row.id}
            t={t}
            row={row}
            card={byId.get(row.caseId)}
            onDetail={onDetail}
          />
        ))}
      </ul>
    </div>
  )
}

/** 一行是否命中：阶段 + 关键词（traceId / 卡 id / 标题 / 原因）。 */
function matchRow(row: RecordRow, phase: PhaseFilter, query: string, card?: Card): boolean {
  if (phase !== 'all' && row.phase !== phase) return false
  const text = query.trim().toLowerCase()
  if (!text) return true
  const haystack = [row.traceId, row.caseId, row.reason, card?.title || ''].join(' ').toLowerCase()
  return haystack.includes(text)
}

function RecordLine({
  t,
  row,
  card,
  onDetail,
}: {
  t: Translate
  row: RecordRow
  card?: Card
  onDetail: (card: Card) => void
}) {
  return (
    <li className="dtc-rec-row">
      <span className="dtc-rec-time">{timeLabel(row.at)}</span>
      <span className="dtc-chip">{t(PHASE_KEYS[row.phase] ?? 'recordPhaseOther')}</span>
      <span className="dtc-rec-main">
        <b className="dtc-rec-title">{card ? card.title : row.caseId}</b>
        <span className="dtc-rec-reason">{row.reason}</span>
      </span>
      <code className="dtc-rec-trace">{row.traceId || row.caseId}</code>
      {card ? (
        <button type="button" className="dtc-btn" onClick={() => onDetail(card)}>
          {t('recordOpen')}
        </button>
      ) : null}
    </li>
  )
}
