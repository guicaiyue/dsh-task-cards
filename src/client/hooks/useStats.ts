// /stats 面板数据：六项 KPI 的服务端口径（真实回合分母），与 curl 输出同一份。

import { useEffect, useState } from 'react'

import { fetchStats } from '../api'
import type { StatsView } from '../types'

export function useStats(active: boolean): StatsView | null {
  const [stats, setStats] = useState<StatsView | null>(null)
  useEffect(() => {
    if (!active) return
    let live = true
    const load = () => {
      fetchStats()
        .then((next) => {
          if (live) setStats(next)
        })
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [active])
  return stats
}
