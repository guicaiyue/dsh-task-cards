// 面板顶部：标题 + 刷新；下面是四个 KPI。

import { groupCards } from '../../shared/state'
import type { Card, Translate } from '../types'

interface Props {
  t: Translate
  cards: Card[]
  onRefresh: () => void
}

export function PanelHeader({ t, onRefresh }: Props) {
  return (
    <div className="dtc-head">
      <div>
        <div className="dtc-eyebrow">{t('eyebrow')}</div>
        <h1 className="dtc-title">{t('title')}</h1>
        <div className="dtc-sub">{t('subtitle')}</div>
      </div>
      <div className="dtc-spacer" />
      <button type="button" className="dtc-btn" onClick={onRefresh}>
        {t('refresh')}
      </button>
    </div>
  )
}

export function KpiRow({ t, cards }: { t: Translate; cards: Card[] }) {
  const groups = groupCards(cards)
  return (
    <div className="dtc-kpis">
      <div className="dtc-kpi is-decision">
        <div className="dtc-kpi-label">{t('kpiDecision')}</div>
        <div className="dtc-kpi-value">{groups.decision.length}</div>
      </div>
      <div className="dtc-kpi">
        <div className="dtc-kpi-label">{t('kpiInfo')}</div>
        <div className="dtc-kpi-value">{groups.info.length}</div>
      </div>
      <div className="dtc-kpi is-auto">
        <div className="dtc-kpi-label">{t('kpiAuto')}</div>
        <div className="dtc-kpi-value">{groups.auto.length}</div>
      </div>
      <div className="dtc-kpi">
        <div className="dtc-kpi-label">{t('kpiClosed')}</div>
        <div className="dtc-kpi-value">{groups.closed.length}</div>
      </div>
    </div>
  )
}

export function TabBar({
  t,
  tab,
  onChange,
}: {
  t: Translate
  tab: 'cards' | 'settings'
  onChange: (tab: 'cards' | 'settings') => void
}) {
  return (
    <div className="dtc-tabs">
      <button
        type="button"
        className={`dtc-tab${tab === 'cards' ? ' is-active' : ''}`}
        onClick={() => onChange('cards')}
      >
        {t('tabCards')}
      </button>
      <button
        type="button"
        className={`dtc-tab${tab === 'settings' ? ' is-active' : ''}`}
        onClick={() => onChange('settings')}
      >
        {t('tabSettings')}
      </button>
    </div>
  )
}
