// 判例库：设置页的判例列表、详情弹窗里点开的判例都要它。
//
// 打开设置页或展开带票拟的详情时按需拉一次；失败不阻塞面板，只在错误条里说明。

import { useCallback, useState } from 'react'

import { fetchDecisions } from '../api'
import type { Precedent } from '../types'

export interface PrecedentsState {
  precedents: Precedent[]
  loading: boolean
  load: () => Promise<void>
}

export function usePrecedents(setError: (message: string) => void): PrecedentsState {
  const [precedents, setPrecedents] = useState<Precedent[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const body = await fetchDecisions()
      setPrecedents(body.precedents)
    } catch (err) {
      setError((err as Error).message || String(err))
    } finally {
      setLoading(false)
    }
  }, [setError])

  return { precedents, loading, load }
}
