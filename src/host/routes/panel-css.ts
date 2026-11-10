// GET /css：面板样式表。样式是静态文本资产，放在宿主发，不进客户端 bundle。

import type { HttpRequestLike, HttpResponseLike } from '../http'
import { PANEL_CSS } from '../panel/css'

export function createPanelCssHandler() {
  return async (_req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    if (res.headersSent || res.writableEnded) return undefined
    try {
      res.writeHead(200, {
        'Content-Type': 'text/css; charset=utf-8',
        // 开发期靠 no-store 让 <link> 每次重新取；生产量很小，不值得加缓存指纹。
        'Cache-Control': 'no-store',
      })
      res.end(PANEL_CSS)
    } catch {
      try {
        res.destroy()
      } catch {
        /* 已经断开 */
      }
    }
    return undefined
  }
}
