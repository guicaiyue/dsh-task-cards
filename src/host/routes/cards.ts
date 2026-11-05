// GET/POST /cards：列表与建卡。

import { asRecord } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { readJson, sendJson } from '../http'
import type { RouteDeps } from './deps'

export function createCardsHandler({ cards }: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    if (req.method === 'GET') {
      return sendJson(res, 200, { ok: true, cards: cards.list(), warning: cards.warning })
    }
    const body = await readJson(req)
    const action = asRecord(body.action)
    const card = await cards.create(body.title, {
      detail: body.detail,
      kind: body.kind,
      severity: body.severity,
      // 手工也能造自动卡（调试和外部调用方都用得上）
      action:
        body.action && typeof action.input === 'string'
          ? {
              type: 'prompt' as const,
              delayMs: Number.isFinite(Number(action.delayMs))
                ? Math.max(0, Number(action.delayMs))
                : 0,
              input: String(action.input).slice(0, 2000),
              ...(typeof action.sessionId === 'string' ? { sessionId: action.sessionId } : {}),
            }
          : null,
    })
    return sendJson(res, 200, { ok: true, card })
  }
}
