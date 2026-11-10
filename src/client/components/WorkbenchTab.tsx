// 工作台：五个 KPI + 过滤 + 会话/平铺两种视图 + 富卡片行。
//
// 口径全部来自 stage.ts（kpiOf / filterCards / filterCounts），这里只摆版式。

import { useMemo, useState } from 'react'
import { laneOf, sortCards } from '../../shared/state'
import { FILTERS, filterCards, filterCounts, type WorkbenchFilter } from '../stage'
import { timeLabel } from '../time'
import type { AnswerSelection, Card, CardActionName, CardProgress, Translate } from '../types'
import { CardComposer } from './CardComposer'
import { CardRow } from './CardRow'
import { Kpis } from './WorkbenchKpis'

export interface SessionGroup {
  sessionId: string
  cards: Card[]
}

/** 按会话分组；组顺序跟组内最该处理的卡，组内保持 sortCards 的顺序。 */
export function groupBySession(cards: Card[]): SessionGroup[] {
  const groups = new Map<string, Card[]>()
  for (const card of cards) {
    const id = card.origin?.sessionId || ''
    const list = groups.get(id)
    if (list) list.push(card)
    else groups.set(id, [card])
  }
  return [...groups.entries()].map(([sessionId, list]) => ({ sessionId, cards: list }))
}

export interface WorkbenchProps {
  t: Translate
  cards: Card[]
  busy: boolean
  loading: boolean
  stats: import('../types').StatsView | null
  draft: string
  titles: Record<string, string>
  progress: Record<string, CardProgress>
  onDraftChange: (value: string) => void
  onAdd: () => void
  onAction: (card: Card, action: CardActionName, option?: string) => void
  onAnswer: (card: Card, option: string, answers?: AnswerSelection[]) => void
  onRedecide: (card: Card) => void
  onOpenDetail: (card: Card) => void
  onOpenSession: (sessionId: string) => void
  onSelectSession: (sessionId: string) => void
  onReconcile: () => void
  /** 决策者暂停时顶部横幅要说明有多少卡在等。 */
  paused?: boolean
}

export function WorkbenchTab(props: WorkbenchProps) {
  const { t, cards, busy, loading, draft } = props
  const [filter, setFilter] = useState<WorkbenchFilter>('all')
  const [flat, setFlat] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const counts = useMemo(() => filterCounts(cards), [cards])
  const visible = useMemo(() => sortCards(filterCards(cards, filter)), [cards, filter])
  return (
    <section className="dtc-wb">
      {props.paused ? (
        <div className="dtc-paused">
          <span>{t('pausedBanner', { n: counts.pending })}</span>
        </div>
      ) : null}
      <Kpis t={t} cards={cards} stats={props.stats} />
      <FilterBar
        t={t}
        counts={counts}
        filter={filter}
        flat={flat}
        busy={busy}
        onFilter={setFilter}
        onFlat={setFlat}
        onReconcile={props.onReconcile}
      />
      <CardComposer
        t={t}
        draft={draft}
        busy={busy}
        onChange={props.onDraftChange}
        onAdd={props.onAdd}
      />
      {loading && !cards.length ? <p className="dtc-empty">{t('loading')}</p> : null}
      {!loading && !visible.length ? (
        <p className="dtc-empty">{filter === 'all' ? t('emptyAll') : t('emptyFilter')}</p>
      ) : null}
      {flat ? (
        <div className="dtc-cards">
          {visible.map((card) => (
            <Row key={card.id} {...props} card={card} sessionLabel={labelOf(card, props.titles)} />
          ))}
        </div>
      ) : (
        <div className="dtc-groups">
          {groupBySession(visible).map((group) => (
            <Group
              key={group.sessionId || 'manual'}
              {...props}
              group={group}
              collapsed={Boolean(collapsed[group.sessionId])}
              onToggle={() =>
                setCollapsed((prev) => ({ ...prev, [group.sessionId]: !prev[group.sessionId] }))
              }
            />
          ))}
        </div>
      )}
    </section>
  )
}

interface FilterBarProps {
  t: Translate
  counts: Record<WorkbenchFilter, number>
  filter: WorkbenchFilter
  flat: boolean
  busy: boolean
  onFilter: (filter: WorkbenchFilter) => void
  onFlat: (flat: boolean) => void
  onReconcile: () => void
  /** 决策者暂停时顶部横幅要说明有多少卡在等。 */
  paused?: boolean
}

function FilterBar(props: FilterBarProps) {
  const { t, counts, filter, flat, busy } = props
  return (
    <div className="dtc-filterbar">
      <div className="dtc-viewtoggle">
        <button
          type="button"
          className={`dtc-filter${flat ? '' : ' is-on'}`}
          onClick={() => props.onFlat(false)}
        >
          {t('viewSession')}
        </button>
        <button
          type="button"
          className={`dtc-filter${flat ? ' is-on' : ''}`}
          onClick={() => props.onFlat(true)}
        >
          {t('viewFlat')}
        </button>
      </div>
      {FILTERS.map((item) => (
        <button
          key={item}
          type="button"
          className={`dtc-filter${filter === item ? ' is-on' : ''}`}
          onClick={() => props.onFilter(item)}
        >
          {t(`filter_${item}`)}
          <span className="dtc-filter-count">{counts[item]}</span>
        </button>
      ))}
      <div className="dtc-spacer" />
      <button type="button" className="dtc-btn" disabled={busy} onClick={props.onReconcile}>
        {t('reconcile')}
      </button>
    </div>
  )
}

interface GroupProps extends WorkbenchProps {
  group: SessionGroup
  collapsed: boolean
  onToggle: () => void
}

function Group({ t, group, collapsed, titles, onToggle, ...rest }: GroupProps) {
  // 与 KPI 同源：待处理 = 待决定 + 需关注（执行中/已结束都不算）。
  const pending = group.cards.filter((card) => {
    const lane = laneOf(card)
    return lane === 'decision' || lane === 'attention'
  }).length
  const latest = Math.max(...group.cards.map((card) => card.updatedAt))
  return (
    <div className="dtc-group">
      <div className="dtc-group-head">
        <button type="button" className="dtc-group-caret" onClick={onToggle}>
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="dtc-group-id">{shortSession(group.sessionId)}</span>
        <button
          type="button"
          className="dtc-group-title"
          onClick={() => rest.onSelectSession(group.sessionId)}
        >
          {group.sessionId ? titles[group.sessionId] || group.sessionId : t('manualTree')}
        </button>
        <span className="dtc-group-meta">
          {t('groupCards', { n: group.cards.length, p: pending })}
        </span>
        <span className="dtc-group-meta">{timeLabel(latest)}</span>
        {group.sessionId ? (
          <button
            type="button"
            className="dtc-btn"
            onClick={() => rest.onOpenSession(group.sessionId)}
          >
            {t('openSession')}
          </button>
        ) : null}
      </div>
      {collapsed ? null : (
        <div className="dtc-cards">
          {group.cards.map((card, index) => (
            <Row
              key={card.id}
              {...rest}
              t={t}
              titles={titles}
              card={card}
              seq={{ index: index + 1, total: group.cards.length }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Row(
  props: WorkbenchProps & {
    card: Card
    sessionLabel?: string
    seq?: { index: number; total: number }
  },
) {
  const { card, sessionLabel, seq, ...rest } = props
  return (
    <CardRow
      t={rest.t}
      card={card}
      busy={rest.busy}
      progress={rest.progress[card.id]}
      sessionLabel={sessionLabel}
      seq={seq}
      onAction={rest.onAction}
      onAnswer={rest.onAnswer}
      onRedecide={rest.onRedecide}
      onDetail={(target) => rest.onOpenDetail(target.card || card)}
    />
  )
}

function labelOf(card: Card, titles: Record<string, string>): string | undefined {
  const id = card.origin?.sessionId
  if (!id) return undefined
  return shortSession(id) || titles[id]
}

function shortSession(id: string): string {
  if (!id) return ''
  return id.length > 8 ? `s-${id.slice(-4)}` : id
}
