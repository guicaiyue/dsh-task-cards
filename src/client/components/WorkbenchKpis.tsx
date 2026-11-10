// 工作台顶部的五个 KPI：数值 + 一句话拆解，口径来自 stage.ts。

import { kpiDetailOf, kpiOf } from '../stage'
import type { Card, StatsView, Translate } from '../types'

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 1000) / 10}%`
}

function num(value: number | null): string {
  return value === null ? '—' : String(value)
}

/** 面板六项 KPI 只读 /stats 的 groups.real（与 curl 同源，不许本地另算）。 */
function ratesText(t: Translate, stats: StatsView | null): string {
  const server = stats?.groups.real
  if (!server) return t('kpiServerLoading')
  return t('kpiServer', {
    delegatedRate: pct(server.delegatedRate),
    overrideRate: pct(server.overrideRate),
    escalationRate: pct(server.escalationRate),
    waitRate: pct(server.waitRate),
    cardsPerTurn: num(server.cardsPerTurn),
    interventionsPerTurn: num(server.interventionsPerTurn),
    noticePerTurn: num(server.noticePerTurn),
    unknownRate: pct(server.unknownToHumanRate),
    turns: stats?.turns ?? 0,
    sha: (stats?.dataSource.cardsSha256 ?? '').slice(0, 6),
  })
}

export function Kpis({
  t,
  cards,
  stats,
}: {
  t: Translate
  cards: Card[]
  stats: StatsView | null
}) {
  const kpi = kpiOf(cards)
  const detail = kpiDetailOf(cards)
  const items = [
    [
      'kpiPending',
      kpi.pending,
      'wait',
      t('kpiPendingDetail', { escalated: detail.escalated, undecided: detail.undecided }),
    ],
    [
      'kpiDelegated',
      kpi.delegated,
      'run',
      t('kpiDelegatedDetail', { secretary: detail.secretary, system: detail.system }),
    ],
    [
      'kpiRunning',
      kpi.running,
      'run',
      t('kpiRunningDetail', { approved: detail.approved, executing: detail.executing }),
    ],
    ['kpiVerifying', kpi.verifying, 'unknown', t('kpiVerifyingDetail', { n: detail.verifying })],
    [
      'kpiAttention',
      kpi.attention,
      'fail',
      t('kpiAttentionDetail', { failed: detail.failed, unknown: detail.unknown }),
    ],
  ] as const
  const summary = t('kpiSummary', {
    pending: kpi.pending,
    escalated: kpi.escalated,
    delegated: kpi.delegated,
    overridden: kpi.overridden,
  })
  const rates = ratesText(t, stats)
  return (
    <div className="dtc-kpis is-five">
      {items.map(([key, value, tone, sub]) => (
        <div key={key} className={`dtc-kpi is-${tone}`}>
          <div className="dtc-kpi-value">{value}</div>
          <div className="dtc-kpi-label">{t(key)}</div>
          <div className="dtc-kpi-detail">{sub}</div>
        </div>
      ))}
      <div className="dtc-kpi-note">{summary}</div>
      <div className="dtc-kpi-note">{rates}</div>
    </div>
  )
}
