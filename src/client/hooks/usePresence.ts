// 面板在线心跳：宿主据此决定提问由卡片作答（原生返回），还是交回聊天里的提问 UI。

import { useEffect } from 'react'

import { pingPresence } from '../api'

const INTERVAL_MS = 20000

export function usePresence(): void {
  useEffect(() => {
    let alive = true
    const ping = () => {
      if (!alive) return
      pingPresence(true)
    }
    ping()
    const timer = setInterval(ping, INTERVAL_MS)
    return () => {
      alive = false
      clearInterval(timer)
      // 面板关掉：宿主会把还挂着的提问交回聊天里的提问 UI
      pingPresence(false)
    }
  }, [])
}
