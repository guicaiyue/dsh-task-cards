// 面板样式：由宿主路由 GET /api/css 提供，这里只挂一个 <link>。
//
// 样式不进客户端 bundle——它占三分之一体积，作为静态资源发还能被浏览器独立缓存。

import { API } from './constants'

export function injectPanelCss(): () => void {
  const old = document.querySelector('link[data-plugin="dsh-task-cards"]')
  if (old) old.remove()
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `${API}/css`
  link.dataset.plugin = 'dsh-task-cards'
  document.head.appendChild(link)
  return () => {
    try {
      link.remove()
    } catch {
      /* 已经摘掉 */
    }
  }
}
