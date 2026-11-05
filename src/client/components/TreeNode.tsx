// 会话树的一层：一个会话（或「手写卡片」组）折叠后露出里面的卡。

import { isClosed } from '../../shared/state'
import { timeLabel } from '../time'
import type { Card, CardActionName, Translate } from '../types'
import { CardRow } from './CardRow'

interface Props {
  t: Translate
  sessionId: string
  cards: Card[]
  title: string
  open: boolean
  busy: boolean
  onToggle: (sessionId: string) => void
  onDetail: (target: { sessionId: string; title: string }) => void
  onOpenSession: (sessionId: string) => void
  onAction: (card: Card, action: CardActionName, option?: string) => void
  onAnswer: (card: Card, option: string) => void
}

interface HeadProps {
  t: Translate
  sessionId: string
  heading: string
  count: number
  pending: number
  createdAt: number | null | undefined
  manual: boolean
  open: boolean
  onToggle: (sessionId: string) => void
  onDetail: (target: { sessionId: string; title: string }) => void
  onOpenSession: (sessionId: string) => void
}

function TreeHead({
  t,
  sessionId,
  heading,
  count,
  pending,
  createdAt,
  manual,
  open,
  onToggle,
  onDetail,
  onOpenSession,
}: HeadProps) {
  return (
    <div className="dtc-tree-head">
      <button
        type="button"
        className="dtc-tree-caret"
        onClick={() => onToggle(sessionId)}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'}
      </button>
      <button type="button" className="dtc-tree-title" onClick={() => onToggle(sessionId)}>
        {heading}
      </button>
      <span className="dtc-tree-meta">{t('treeCount', { n: count })}</span>
      {pending > 0 ? (
        <span className="dtc-tree-pending">{t('treePending', { n: pending })}</span>
      ) : null}
      <span className="dtc-tree-meta">{timeLabel(createdAt)}</span>
      {manual ? null : (
        <button
          type="button"
          className="dtc-btn"
          onClick={() => onDetail({ sessionId, title: heading })}
        >
          {t('detail')}
        </button>
      )}
      {manual ? null : (
        <button
          type="button"
          className="dtc-btn is-primary"
          onClick={() => onOpenSession(sessionId)}
        >
          {t('openSession')}
        </button>
      )}
    </div>
  )
}

export function TreeNode({
  t,
  sessionId,
  cards,
  title,
  open,
  busy,
  onToggle,
  onDetail,
  onOpenSession,
  onAction,
  onAnswer,
}: Props) {
  const manual = !sessionId
  // 组头的时间取「最近一张」，待处理数取组内还没结束的卡。
  const latestAt = cards.reduce((max, card) => Math.max(max, card.createdAt || 0), 0)
  const pending = cards.filter((card) => !isClosed(card.status)).length
  const heading = manual ? t('manualTree') : title || sessionId.slice(0, 18)
  return (
    <div className="dtc-tree-node">
      <TreeHead
        t={t}
        sessionId={sessionId}
        heading={heading}
        count={cards.length}
        pending={pending}
        createdAt={latestAt}
        manual={manual}
        open={open}
        onToggle={onToggle}
        onDetail={onDetail}
        onOpenSession={onOpenSession}
      />
      {open ? (
        <div className="dtc-tree-body">
          {cards.map((card) => (
            <div key={card.id} className="dtc-branch">
              <CardRow
                t={t}
                card={card}
                busy={busy}
                onAction={onAction}
                onAnswer={onAnswer}
                onDetail={(target) =>
                  onDetail({ sessionId: target.sessionId, title: target.title })
                }
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
