// 侧栏未读圆点：面板没打开时也要能发现新通知，所以图标自己轻量轮询。
// 页面隐藏时停手，重新可见时立刻补一次。

import { useEffect, useState } from 'react'

import { unreadInfoCount } from '../../shared/state'
import { fetchCards } from '../api'

const INTERVAL_MS = 10000

export function useUnreadInfo(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let alive = true
    const load = () => {
      if (!alive || document.visibilityState === 'hidden') return
      fetchCards()
        .then((body) => {
          if (alive) setCount(unreadInfoCount(body.cards))
        })
        .catch(() => {})
    }
    load()
    const timer = setInterval(load, INTERVAL_MS)
    document.addEventListener('visibilitychange', load)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
    }
  }, [])

  return count
}
