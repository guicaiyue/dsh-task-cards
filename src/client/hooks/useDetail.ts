// 详情弹窗：打开时拉一次时间线（用户输入 + 模型最终输出），失败也留在弹窗里说明原因。

import { useCallback, useState } from 'react'

import { fetchTimeline } from '../api'
import type { Card, DetailApi, DetailState } from '../types'

export type { DetailApi }

export function useDetail(): DetailApi {
  const [detail, setDetail] = useState<DetailState | null>(null)

  const openDetail = useCallback(
    async (target: { sessionId: string; card?: Card | null; title?: string }) => {
      const card = target.card || null
      const sessionId = target.sessionId || card?.origin?.sessionId || ''
      const title = target.title || card?.title || ''
      if (!sessionId) {
        setDetail({ sessionId: '', card, title, loading: false, turns: [] })
        return
      }
      setDetail({ sessionId, card, title, loading: true, turns: [] })
      try {
        const body = await fetchTimeline(sessionId)
        setDetail({
          sessionId,
          card,
          title: body.title || title,
          loading: false,
          turns: body.turns,
        })
      } catch (err) {
        setDetail({
          sessionId,
          card,
          title,
          loading: false,
          turns: [],
          error: (err as Error).message || String(err),
        })
      }
    },
    [],
  )

  const closeDetail = useCallback(() => setDetail(null), [])

  /** 弹窗里操作卡片后，把最新状态同步回弹窗，避免它显示旧状态。 */
  const replaceCard = useCallback((card: Card) => {
    setDetail((prev) => (prev && prev.card && prev.card.id === card.id ? { ...prev, card } : prev))
  }, [])

  return { detail, openDetail, closeDetail, replaceCard }
}
