// 面板顶部：标题 + 一行状态 + 七屏导航（与 OpenDesign 原型一致）。

import { isCardClosed } from '../../shared/state'
import { needsAttention } from '../stage'
import type { Card, PanelTab, Translate } from '../types'

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'workbench', label: 'tabWorkbench' },
  { id: 'detail', label: 'tabDetail' },
  { id: 'failure', label: 'tabFailure' },
  { id: 'policy', label: 'tabPolicy' },
  { id: 'records', label: 'tabRecords' },
  { id: 'settings', label: 'tabSettings' },
  { id: 'session', label: 'tabSession' },
]

interface Props {
  t: Translate
  cards: Card[]
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  onRefresh: () => void
  onReconcile?: () => void
  busy?: boolean
  recordsCount?: number
}

function attentionCount(cards: Card[]): number {
  return cards.filter(needsAttention).length
}

export function PanelHeader({
  t,
  cards,
  tab,
  onTab,
  onRefresh,
  onReconcile,
  busy,
  recordsCount,
}: Props) {
  const open = cards.filter((card) => !isCardClosed(card)).length
  const pending = cards.filter(
    (card) =>
      (card.deliveryState === 'idle' || card.deliveryState === 'waiting') && !isCardClosed(card),
  ).length
  const attention = attentionCount(cards)
  const counts: Partial<Record<PanelTab, number>> = {
    workbench: cards.length,
    failure: attention,
    records: recordsCount,
  }
  return (
    <>
      <div className="dtc-head">
        <div>
          <div className="dtc-eyebrow">DSH · TASK CARDS</div>
          <h1 className="dtc-title">{t('nav')}</h1>
          <div className="dtc-sub">
            {t('statusLine', { cards: cards.length, open, pending, attention })}
          </div>
        </div>
        <div className="dtc-spacer" />
        {onReconcile ? (
          <button type="button" className="dtc-btn" disabled={busy} onClick={onReconcile}>
            {t('reconcile')}
          </button>
        ) : null}
        <button type="button" className="dtc-btn is-primary" disabled={busy} onClick={onRefresh}>
          {t('refresh')}
        </button>
      </div>
      <nav className="dtc-tabs" aria-label={t('tabNav')}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`dtc-tab${item.id === tab ? ' is-active' : ''}`}
            onClick={() => onTab(item.id)}
          >
            {t(item.label)}
            {typeof counts[item.id] === 'number' ? (
              <span className="dtc-tab-count">{counts[item.id]}</span>
            ) : null}
          </button>
        ))}
      </nav>
    </>
  )
}
