// 记录屏数据：进入 tab 时拉一次最近事件，失败留在屏里说明原因。

import { useCallback, useEffect, useState } from 'react'

import { fetchRecords } from '../api'
import type { RecordRow } from '../types'

export interface RecordsState {
  records: RecordRow[]
  truncated: boolean
  loading: boolean
  error: string
  refresh: () => void
}

export function useRecords(active: boolean): RecordsState {
  const [records, setRecords] = useState<RecordRow[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    fetchRecords()
      .then((body) => {
        setRecords(body.records)
        setTruncated(body.truncated)
      })
      .catch((err: unknown) => setError((err as Error)?.message || String(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (active) load()
  }, [active, load])

  return { records, truncated, loading, error, refresh: load }
}
