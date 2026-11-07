// 「看到即已读」的判定：卡片在视口里连续停留 2 秒才算看过。
//
// 为什么不是渲染即已读：面板开着、页签停在卡片页时，每 5 秒轮询不断把新卡渲染
// 进来，渲染即已读等于「只要面板开着就永远没有未读」；列表一屏放不下，一屏之外
// 那些卡用户根本没看见，不该替他关掉未读圆点。
//
// 三个条件缺一不可：页签在卡片页（组件只在卡片页挂载）、文档可见、卡在视口里。

import { type RefObject, useEffect, useRef } from 'react'

/** 在视口里连续停留多久才算看过。 */
export const READ_DWELL_MS = 2000

interface Options {
  /** 只有「观察者写的未读通知」才需要判定。 */
  enabled: boolean
  /** 有请求在跑时先不判定：别在用户动作的同时替他改状态。 */
  busy: boolean
}

export function useReadOnScreen<T extends HTMLElement>(
  onRead: () => void,
  { enabled, busy }: Options,
): RefObject<T> {
  const ref = useRef<T>(null)
  // 回调用 ref 走：父组件每次渲染换新函数/新卡对象时，2 秒计时不能因此重置。
  const latest = useRef(onRead)
  latest.current = onRead
  const done = useRef(false)

  useEffect(() => {
    if (!enabled || busy || done.current) return
    const el = ref.current
    // 没有 IntersectionObserver 的环境（老浏览器、测试）就不自动已读，宁可不关。
    if (!el || typeof IntersectionObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null
    let inView = false
    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
    const start = () => {
      if (timer !== null || document.visibilityState === 'hidden') return
      timer = setTimeout(() => {
        timer = null
        if (!inView || document.visibilityState === 'hidden') return
        done.current = true
        latest.current()
      }, READ_DWELL_MS)
    }
    const stop = () => {
      inView = false
      clear()
    }
    const observer = new IntersectionObserver(
      (entries) => {
        inView = entries.some((entry) => entry.isIntersecting)
        if (inView) start()
        else stop()
      },
      { threshold: 0.5 },
    )
    observer.observe(el)
    const onHide = () => {
      if (document.visibilityState === 'hidden') stop()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      stop()
      observer.disconnect()
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [enabled, busy])

  return ref
}
