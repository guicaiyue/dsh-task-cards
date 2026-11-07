// POST /presence：面板在线心跳，带当前页签和打开的卡。

import { asString } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { readJson, sendJson } from '../http'
import type { RouteDeps } from './deps'

export function createPresenceHandler(deps: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const body = await readJson(req)
    const sessionId = asString(body.sessionId)
    if (body.active !== true) {
      deps.presence.clear(sessionId)
      return sendJson(res, 200, { ok: true })
    }
    deps.presence.set(sessionId, {
      tab: asString(body.tab) || undefined,
      openCardId: asString(body.openCardId) || undefined,
    })
    return sendJson(res, 200, { ok: true })
  }
}
