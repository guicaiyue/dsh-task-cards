// 失败排查的案卷：选中哪张卡就拉哪张卡的 case，拉过的留在内存里复用。
//
// 失败排查只看一张卡的证据与判定，所以不做批量预取：切卡才发请求，切回来直接用缓存。

import { useEffect, useRef, useState } from 'react'

import { fetchCase } from '../api'
import type { Card, CaseDetail } from '../types'

export interface FailureCaseState {
  /** 当前卡的案卷；还没拉到时为 null。 */
  caseInfo: CaseDetail | null
  loading: boolean
  /** 读取失败的一句人话；清空表示没失败。 */
  error: string
}

const EMPTY: FailureCaseState = { caseInfo: null, loading: false, error: '' }

function messageOf(err: unknown): string {
  return (err as Error)?.message || String(err)
}

export function useFailureCases(card: Card | null): FailureCaseState {
  const cache = useRef(new Map<string, CaseDetail>())
  const [state, setState] = useState<FailureCaseState>(EMPTY)
  const id = card?.id ?? ''

  useEffect(() => {
    if (!id) {
      setState(EMPTY)
      return
    }
    const hit = cache.current.get(id)
    if (hit) {
      setState({ caseInfo: hit, loading: false, error: '' })
      return
    }
    let alive = true
    setState({ caseInfo: null, loading: true, error: '' })
    fetchCase(id)
      .then((caseInfo) => {
        cache.current.set(id, caseInfo)
        if (alive) setState({ caseInfo, loading: false, error: '' })
      })
      .catch((err: unknown) => {
        if (alive) setState({ caseInfo: null, loading: false, error: messageOf(err) })
      })
    return () => {
      alive = false
    }
  }, [id])

  return state
}
