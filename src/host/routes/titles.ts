// GET /titles：树的外层要显示会话标题，只读 header，不读全文。

import { StoreError } from '../cards/store'
import { asRecord } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { sendJson } from '../http'
import { param, type RouteDeps } from './deps'

export function createTitlesHandler({ runtime }: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const ids = param(req.url, 'ids')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const query = runtime()?.sessionQuery
    if (!query) throw new StoreError('NO_QUERY', '宿主没有 sessionQuery')
    const titles: Record<string, string> = {}
    for (const id of ids.slice(0, 50)) {
      try {
        const snapshot = await query.readSession(id)
        let title = ''
        for (const event of snapshot.events || []) {
          const data = asRecord(event.data)
          if (event.type === 'session/title' && typeof data.title === 'string') title = data.title
        }
        titles[id] = title
      } catch {
        titles[id] = ''
      }
    }
    return sendJson(res, 200, { ok: true, titles })
  }
}
