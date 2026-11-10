// 卡片数据：加载、创建、动作，以及「卡片页 5 秒轻刷」。
//
// 观察者在别的会话结束后写卡，扫描器还会改状态；面板在卡片页上应该自己跟上。

import { useCallback, useEffect, useState } from 'react'

import {
  type ActionReply,
  actOnCard,
  adopt,
  createCard,
  fetchCards,
  fetchProgress,
  markReworked,
} from '../api'
import type { ActionOutcome, Card, CardActionName, CardProgress } from '../types'

export interface CardsState {
  cards: Card[]
  /** 行内进度：caseId → 完成度；拉不到就空对象（不挡主流程）。 */
  progress: Record<string, CardProgress>
  warning: string
  loading: boolean
  error: string
  setError: (message: string) => void
  loadCards: (soft?: boolean) => Promise<void>
  add: (title: string) => Promise<boolean>
  act: (
    card: Card,
    action: CardActionName,
    option?: string,
    answers?: Array<{ id: string; selected: string[] }>,
  ) => Promise<ActionOutcome>
}

interface ActionContext {
  card: Card
  action: CardActionName
  option?: string
  answers?: Array<{ id: string; selected: string[] }>
  setCards: (update: (prev: Card[]) => Card[]) => void
  setError: (message: string) => void
  reload: (soft?: boolean) => Promise<void>
}

/** 票拟的两个动作各有专用封装（采纳带 0 起序号，返工原因走 option）。 */
function requestAction(
  card: Card,
  action: CardActionName,
  option?: string,
  answers?: Array<{ id: string; selected: string[] }>,
): Promise<ActionReply> {
  if (action === 'adopt') return adopt(card.id, Number(option ?? '0'))
  if (action === 'mark-reworked') return markReworked(card.id, option)
  return actOnCard(card.id, action, option, answers)
}

/** 动作请求 + 本地状态更新：删除直接摘掉，其它用宿主回的卡替换。 */
async function performCardAction(context: ActionContext): Promise<ActionOutcome> {
  const { card, action, option, answers, setCards, setError, reload } = context
  setError('')
  try {
    const body = await requestAction(card, action, option, answers)
    if (action === 'delete') setCards((prev) => prev.filter((item) => item.id !== card.id))
    else if (body.card)
      setCards((prev) => prev.map((item) => (item.id === card.id ? (body.card as Card) : item)))
    else await reload(true)
    return { action, card: body.card, pushed: body.pushed, reason: body.reason }
  } catch (err) {
    setError((err as Error).message || String(err))
    return undefined
  }
}

/** 手写一条卡：成功才返回 true，面板据此清空草稿。 */
async function createOne(
  title: string,
  setCards: (update: (prev: Card[]) => Card[]) => void,
  setError: (message: string) => void,
): Promise<boolean> {
  const text = title.trim()
  if (!text) return false
  try {
    const card = await createCard(text)
    if (card) setCards((prev) => [card, ...prev])
    return true
  } catch (err) {
    setError((err as Error).message || String(err))
    return false
  }
}

export function useCards(active: boolean): CardsState {
  const [cards, setCards] = useState<Card[]>([])
  const [progress, setProgress] = useState<Record<string, CardProgress>>({})
  const [warning, setWarning] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadCards = useCallback(async (soft = false) => {
    if (!soft) setLoading(true)
    try {
      const [body, progressMap] = await Promise.all([
        fetchCards(),
        fetchProgress().catch(() => ({}) as Record<string, CardProgress>),
      ])
      setCards(body.cards)
      setWarning(body.warning)
      setProgress(progressMap)
    } catch (err) {
      setError((err as Error).message || String(err))
    } finally {
      if (!soft) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCards().catch(() => {})
  }, [loadCards])

  // 只在卡片页开着时轮询，切到设置页就停。
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => {
      loadCards(true).catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [active, loadCards])

  const add = useCallback((title: string) => createOne(title, setCards, setError), [])

  const act = useCallback(
    (
      card: Card,
      action: CardActionName,
      option?: string,
      answers?: Array<{ id: string; selected: string[] }>,
    ): Promise<ActionOutcome> =>
      performCardAction({ card, action, option, answers, setCards, setError, reload: loadCards }),
    [loadCards],
  )

  return { cards, progress, warning, loading, error, setError, loadCards, add, act }
}
