// 一个开关：动作在飞的时候禁用整页按钮，避免重复提交。

import { useCallback, useState } from 'react'

export interface Busy {
  busy: boolean
  run: <T>(job: () => Promise<T>) => Promise<T | undefined>
}

export function useBusy(): Busy {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T>(job: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    try {
      return await job()
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, run }
}
