// 卡片数据：加载、创建、动作，以及「卡片页 5 秒轻刷」。
//
// 观察者在别的会话结束后写卡，扫描器还会改状态；面板在卡片页上应该自己跟上。

import { useCallback, useEffect, useState } from 'react'

import { actOnCard, createCard, fetchCards } from '../api'
import type { ActionResult, Card, CardActionName } from '../types'

export interface CardsState {
  cards: Card[]
  warning: string
  loading: boolean
  error: string
  setError: (message: string) => void
  loadCards: (soft?: boolean) => Promise<void>
  add: (title: string) => Promise<boolean>
  act: (card: Card, action: CardActionName, option?: string) => Promise<ActionResult>
}

interface ActionContext {
  card: Card
  action: CardActionName
  option?: string
  setCards: (update: (prev: Card[]) => Card[]) => void
  setError: (message: string) => void
  reload: (soft?: boolean) => Promise<void>
}

/** 动作请求 + 本地状态更新：删除直接摘掉，其它用宿主回的卡替换。 */
async function performCardAction(context: ActionContext): Promise<ActionResult> {
  const { card, action, option, setCards, setError, reload } = context
  setError('')
  try {
    const body = await actOnCard(card.id, action, option)
    if (action === 'delete') setCards((prev) => prev.filter((item) => item.id !== card.id))
    else if (body.card)
      setCards((prev) => prev.map((item) => (item.id === card.id ? (body.card as Card) : item)))
    else await reload(true)
    return { action, card: body.card }
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
  const [warning, setWarning] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadCards = useCallback(async (soft = false) => {
    if (!soft) setLoading(true)
    try {
      const body = await fetchCards()
      setCards(body.cards)
      setWarning(body.warning)
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
    (card: Card, action: CardActionName, option?: string): Promise<ActionResult> =>
      performCardAction({ card, action, option, setCards, setError, reload: loadCards }),
    [loadCards],
  )

  return { cards, warning, loading, error, setError, loadCards, add, act }
}
