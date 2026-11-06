// 决策页数据：判例库 + 决策代理人的最近执行记录。
//
// 打开决策页或展开带票拟的详情时按需拉一次；失败不阻塞面板，只在错误条里说明。

import { useCallback, useState } from 'react'

import { fetchDecisions } from '../api'
import type { ObserverRecord, Precedent } from '../types'

export interface DecisionsState {
  precedents: Precedent[]
  records: ObserverRecord[]
  loading: boolean
  load: () => Promise<void>
}

/** 只要决策阶段的记录，最新的在前：观察者写卡的记录不属于这一页。 */
function decisionRecords(records: ObserverRecord[]): ObserverRecord[] {
  return records
    .filter((record) => record.phase === 'decision')
    .slice()
    .sort((a, b) => (b.at || 0) - (a.at || 0))
}

export function useDecisions(setError: (message: string) => void): DecisionsState {
  const [precedents, setPrecedents] = useState<Precedent[]>([])
  const [records, setRecords] = useState<ObserverRecord[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const body = await fetchDecisions()
      setPrecedents(body.precedents)
      setRecords(decisionRecords(body.records))
    } catch (err) {
      setError((err as Error).message || String(err))
    } finally {
      setLoading(false)
    }
  }, [setError])

  return { precedents, records, loading, load }
}
