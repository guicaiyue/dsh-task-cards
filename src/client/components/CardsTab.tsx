// 卡片页：手写入口 + 按会话分组的树。

import { useMemo, useState } from 'react'
import { groupCards } from '../../shared/state'
import type { Card, CardActionName, Translate } from '../types'
import { CardComposer } from './CardComposer'
import { TreeNode } from './TreeNode'

interface Tree {
  sessionId: string
  cards: Card[]
}

/** 按会话分组，组内新的在前，组间按最新一张排。 */
export function buildTrees(cards: Card[]): Tree[] {
  const groups = new Map<string, Card[]>()
  for (const card of cards) {
    const id = card.origin?.sessionId || ''
    const list = groups.get(id)
    if (list) list.push(card)
    else groups.set(id, [card])
  }
  return [...groups.entries()]
    .map(([sessionId, list]) => ({
      sessionId,
      cards: list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    }))
    .sort((a, b) => (b.cards[0]?.createdAt || 0) - (a.cards[0]?.createdAt || 0))
}

interface Props {
  t: Translate
  cards: Card[]
  busy: boolean
  draft: string
  loading: boolean
  titles: Record<string, string>
  onDraftChange: (value: string) => void
  onAdd: () => void
  onAction: (card: Card, action: CardActionName, option?: string) => void
  onAnswer: (card: Card, option: string) => void
  onDetail: (target: { sessionId: string; title: string }) => void
  onOpenSession: (sessionId: string) => void
}

export function CardsTab({
  t,
  cards,
  busy,
  draft,
  loading,
  titles,
  onDraftChange,
  onAdd,
  onAction,
  onAnswer,
  onDetail,
  onOpenSession,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const trees = useMemo(() => buildTrees(cards), [cards])
  const toggle = (sessionId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })

  return (
    <>
      <CardComposer t={t} draft={draft} busy={busy} onChange={onDraftChange} onAdd={onAdd} />
      {loading ? (
        <div className="dtc-empty">{t('loading')}</div>
      ) : cards.length === 0 ? (
        <div className="dtc-empty">{t('emptyAll')}</div>
      ) : (
        <div className="dtc-tree">
          {trees.map((tree) => (
            <TreeNode
              key={tree.sessionId || 'manual'}
              t={t}
              sessionId={tree.sessionId}
              cards={tree.cards}
              title={titles[tree.sessionId] || ''}
              open={!collapsed.has(tree.sessionId)}
              busy={busy}
              onToggle={toggle}
              onDetail={onDetail}
              onOpenSession={onOpenSession}
              onAction={onAction}
              onAnswer={onAnswer}
            />
          ))}
        </div>
      )}
    </>
  )
}

export { groupCards }
