// 面板在线心跳：宿主据此决定提问由卡片作答（原生返回），还是交回聊天里的提问 UI。

import { useEffect, useRef } from 'react'

import { pingPresence } from '../api'

const INTERVAL_MS = 20000

export interface PresenceContext {
  sessionId?: string
  tab?: string
  openCardId?: string
}

export function usePresence(context?: PresenceContext): void {
  const ref = useRef(context)
  ref.current = context
  useEffect(() => {
    let alive = true
    const ping = () => {
      if (!alive) return
      pingPresence(true, ref.current)
    }
    ping()
    const timer = setInterval(ping, INTERVAL_MS)
    return () => {
      alive = false
      clearInterval(timer)
      // 面板关掉：宿主会把还挂着的提问交回聊天里的提问 UI
      pingPresence(false, ref.current)
    }
  }, [])
}
