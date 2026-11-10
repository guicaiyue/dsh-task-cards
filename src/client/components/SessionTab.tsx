// 会话屏：一个会话的时间线 + 这个会话里的任务卡节点。
//
// 卡片按 origin.turn 归到对应轮次；没有轮次（或轮次超出时间线）的卡统一放末尾「其它卡」。
// 只做面板内的时间线：宿主「打开会话」的能力没从这个组件的 props 透出，留给接线方。

import { useMemo } from 'react'

import { isCardClosed } from '../../shared/state'
import { useSessionTimeline } from '../hooks/useSessionTimeline'
import { useTitles } from '../hooks/useTitles'
import { stageOf, traceShort, waitLabelKey } from '../stage'
import { timeLabel } from '../time'
import type { Card, Translate, Turn } from '../types'

export interface SessionTabProps {
  t: Translate
  cards: Card[]
  sessionId: string
  onSelectSession: (sessionId: string) => void
  onOpenDetail: (card: Card) => void
}

interface SessionEntry {
  id: string
  title: string
  count: number
  pending: number
}

/** 会话短码：长 id 只留尾巴，够在一排下拉里认出是哪个会话。 */
function shortSession(id: string): string {
  return id.length > 10 ? id.slice(-6) : id
}

function sessionLabel(entry: SessionEntry): string {
  const short = shortSession(entry.id)
  return entry.title ? `${short} · ${entry.title}` : short
}

function isPending(card: Card): boolean {
  const state = card.deliveryState
  return (state === 'idle' || state === 'waiting') && !isCardClosed(card)
}

/** 会话清单：从卡片的 origin.sessionId 去重，标题优先用宿主给的名字，兜底用卡标题。 */
function useSessions(cards: Card[], titles: Record<string, string>): SessionEntry[] {
  return useMemo(() => {
    const map = new Map<string, SessionEntry>()
    for (const card of cards) {
      const id = card.origin?.sessionId || ''
      if (!id) continue
      const entry = map.get(id)
      if (entry) {
        entry.count += 1
        if (isPending(card)) entry.pending += 1
        continue
      }
      map.set(id, {
        id,
        title: titles[id] || card.title,
        count: 1,
        pending: isPending(card) ? 1 : 0,
      })
    }
    return [...map.values()]
  }, [cards, titles])
}

export function SessionTab({
  t,
  cards,
  sessionId,
  onSelectSession,
  onOpenDetail,
}: SessionTabProps) {
  const titles = useTitles(cards)
  const sessions = useSessions(cards, titles)
  const timeline = useSessionTimeline(sessionId)
  const sessionCards = useMemo(
    () =>
      cards
        .filter((card) => card.origin?.sessionId === sessionId)
        .sort((left, right) => left.createdAt - right.createdAt),
    [cards, sessionId],
  )
  const current = sessions.find((entry) => entry.id === sessionId) || null
  return (
    <div className="dtc-ses">
      <SessionHead
        t={t}
        sessions={sessions}
        sessionId={sessionId}
        current={current}
        onSelect={onSelectSession}
      />
      {sessionId ? (
        <SessionBody t={t} timeline={timeline} cards={sessionCards} onOpenDetail={onOpenDetail} />
      ) : (
        <p className="dtc-ses-note">{sessions.length ? t('sesPickEmpty') : t('sesNoSessions')}</p>
      )}
    </div>
  )
}

function SessionHead({
  t,
  sessions,
  sessionId,
  current,
  onSelect,
}: {
  t: Translate
  sessions: SessionEntry[]
  sessionId: string
  current: SessionEntry | null
  onSelect: (sessionId: string) => void
}) {
  return (
    <div className="dtc-ses-head">
      <select
        className="dtc-set-input dtc-ses-select"
        aria-label={t('sesPickLabel')}
        value={sessionId}
        disabled={!sessions.length}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">{t('sesPickPlaceholder')}</option>
        {sessions.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {sessionLabel(entry)}
          </option>
        ))}
      </select>
      {current ? (
        <>
          <span className="dtc-ses-stat">{t('sesCardCount', { n: current.count })}</span>
          {current.pending > 0 ? (
            <span className="dtc-ses-stat">{t('sesPendingCount', { n: current.pending })}</span>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

interface Placed {
  turns: Card[][]
  loose: Card[]
}

/** 按轮次分桶：轮次 1 起、超出时间线长度的都当「其它卡」。 */
function groupCards(cards: Card[], turnCount: number): Placed {
  const turns: Card[][] = Array.from({ length: turnCount }, () => [])
  const loose: Card[] = []
  for (const card of cards) {
    const turn = card.origin?.turn
    if (typeof turn === 'number' && turn >= 1 && turn <= turnCount) turns[turn - 1].push(card)
    else loose.push(card)
  }
  return { turns, loose }
}

function SessionBody({
  t,
  timeline,
  cards,
  onOpenDetail,
}: {
  t: Translate
  timeline: { loading: boolean; error: string; turns: Turn[] }
  cards: Card[]
  onOpenDetail: (card: Card) => void
}) {
  const { loading, error, turns } = timeline
  const placed = useMemo(() => groupCards(cards, turns.length), [cards, turns.length])
  return (
    <div className="dtc-ses-timeline">
      {loading ? <p className="dtc-ses-note">{t('sesLoading')}</p> : null}
      {!loading && error ? <p className="dtc-ses-note">{t('sesLoadError', { error })}</p> : null}
      {!loading && !error && !turns.length ? (
        <p className="dtc-ses-note">{t('sesTimelineEmpty')}</p>
      ) : null}
      {turns.map((turn, index) => (
        <TurnNode
          key={`${turn.at ?? 0}:${turn.user.slice(0, 24)}`}
          t={t}
          index={index}
          turn={turn}
          cards={placed.turns[index] || []}
          onOpenDetail={onOpenDetail}
        />
      ))}
      {placed.loose.length ? (
        <div className="dtc-ses-turn">
          <div className="dtc-ses-turn-head">
            <b>{t('sesOtherCards')}</b>
          </div>
          {placed.loose.map((card) => (
            <CardNode key={card.id} t={t} card={card} onOpenDetail={onOpenDetail} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function TurnNode({
  t,
  index,
  turn,
  cards,
  onOpenDetail,
}: {
  t: Translate
  index: number
  turn: Turn
  cards: Card[]
  onOpenDetail: (card: Card) => void
}) {
  return (
    <div className="dtc-ses-turn">
      <div className="dtc-ses-turn-head">
        <b>{t('turnNo', { n: index + 1 })}</b>
        {turn.at ? <span>{timeLabel(turn.at)}</span> : null}
      </div>
      {turn.user ? <Message role={t('roleUser')} text={turn.user} user /> : null}
      {turn.assistant ? <Message role={t('roleModel')} text={turn.assistant} /> : null}
      {cards.map((card) => (
        <CardNode key={card.id} t={t} card={card} onOpenDetail={onOpenDetail} />
      ))}
    </div>
  )
}

function Message({ role, text, user }: { role: string; text: string; user?: boolean }) {
  return (
    <div className="dtc-ses-msg">
      <span className="dtc-ses-role">{role}</span>
      <p className={`dtc-ses-text dtc-ses-clamp${user ? ' is-user' : ''}`}>{text}</p>
    </div>
  )
}

function CardNode({
  t,
  card,
  onOpenDetail,
}: {
  t: Translate
  card: Card
  onOpenDetail: (card: Card) => void
}) {
  const stage = stageOf(card)
  const waitKey = waitLabelKey(card)
  const trace = traceShort(card)
  return (
    <button type="button" className="dtc-ses-card" onClick={() => onOpenDetail(card)}>
      <span className="dtc-ses-card-head">
        <span className={`dtc-ses-chip is-${stage.tone}`}>{t(stage.labelKey)}</span>
        <span className="dtc-ses-node-title">{card.title}</span>
      </span>
      {waitKey ? <span className="dtc-ses-wait">{t(waitKey)}</span> : null}
      {card.detail ? <span className="dtc-ses-detail dtc-ses-clamp">{card.detail}</span> : null}
      <span className="dtc-ses-meta">
        <span>{timeLabel(card.createdAt)}</span>
        {trace ? <code className="dtc-ses-trace">trace {trace}</code> : null}
        <span>{t('sesOpenHint')}</span>
      </span>
    </button>
  )
}
