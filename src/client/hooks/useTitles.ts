// 会话标题：树的外层要显示标题，缺哪个补哪个，只批量问一次。

import { useEffect, useMemo, useState } from 'react'

import { fetchTitles } from '../api'
import type { Card } from '../types'

export function useTitles(cards: Card[]): Record<string, string> {
  const [titles, setTitles] = useState<Record<string, string>>({})

  const sessionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const card of cards) {
      const id = card.origin?.sessionId
      if (id) ids.add(id)
    }
    return [...ids]
  }, [cards])

  useEffect(() => {
    const missing = sessionIds.filter((id) => titles[id] === undefined)
    if (!missing.length) return
    fetchTitles(missing)
      .then((body) => setTitles((prev) => ({ ...prev, ...body })))
      .catch(() => {})
  }, [sessionIds, titles])

  return titles
}
