// POST /presence：面板在线心跳，带当前页签和打开的卡。
//
// 面板令牌只在这里下发（人机边界）：HTML 里没有明文令牌，agent 读页面/curl HTML
// 都拿不到；面板前端把它放在内存里，随特权写请求以 X-Panel-Token 发出。
// 面板关闭（active=false）时吊销对应令牌。

import { asString } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { readJson, sendJson } from '../http'
import { issuePanelToken, revokePanelToken } from './auth'
import type { RouteDeps } from './deps'

export function createPresenceHandler(deps: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const body = await readJson(req)
    const sessionId = asString(body.sessionId)
    if (body.active !== true) {
      deps.presence.clear(sessionId)
      revokePanelToken(asString(body.token) || undefined)
      return sendJson(res, 200, { ok: true })
    }
    deps.presence.set(sessionId, {
      tab: asString(body.tab) || undefined,
      openCardId: asString(body.openCardId) || undefined,
    })
    const issued = issuePanelToken(req)
    return sendJson(res, 200, { ok: true, token: issued.token })
  }
}
