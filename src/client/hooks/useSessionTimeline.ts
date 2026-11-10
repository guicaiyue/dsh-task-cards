// 会话屏的数据：按 sessionId 拉一次时间线（用户输入 + 模型最终输出）。
//
// 换会话立刻作废旧请求的回包，避免慢的那个把新会话盖掉。

import { useEffect, useState } from 'react'

import { fetchTimeline } from '../api'
import type { Turn } from '../types'

export interface SessionTimelineState {
  /** 宿主给的会话标题；没有就是空串。 */
  title: string
  turns: Turn[]
  loading: boolean
  error: string
}

const IDLE: SessionTimelineState = { title: '', turns: [], loading: false, error: '' }

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useSessionTimeline(sessionId: string): SessionTimelineState {
  const [state, setState] = useState<SessionTimelineState>(IDLE)

  useEffect(() => {
    if (!sessionId) {
      setState(IDLE)
      return
    }
    let live = true
    setState({ title: '', turns: [], loading: true, error: '' })
    fetchTimeline(sessionId)
      .then((body) => {
        if (live) setState({ title: body.title, turns: body.turns, loading: false, error: '' })
      })
      .catch((err: unknown) => {
        if (live) setState({ title: '', turns: [], loading: false, error: messageOf(err) })
      })
    return () => {
      live = false
    }
  }, [sessionId])

  return state
}
