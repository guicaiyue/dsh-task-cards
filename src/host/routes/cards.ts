// GET/POST /cards：列表与建卡。

import { sanitizeAll } from '../evidence/guard'
import { asRecord } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { readJson, sendJson } from '../http'
import { assertPanelToken } from './auth'
import type { RouteDeps } from './deps'

export function createCardsHandler({ cards }: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    if (req.method === 'GET') {
      return sendJson(res, 200, { ok: true, cards: cards.list(), warning: cards.warning })
    }
    // 建卡是结论性写：只允许面板「记下」（插件内部走 Store，不走这条 HTTP）。
    assertPanelToken(req)
    const body = await readJson(req)
    const action = asRecord(body.action)
    const acceptance = sanitizeAll(
      Array.isArray(body.acceptance) ? (body.acceptance as never[]) : undefined,
      process.cwd(),
    )
    const card = await cards.create(body.title, {
      ...(acceptance.length ? { acceptance } : {}),
      // P2：手工/外部调试卡也可带默认答案（超时自动继续与真实提问同一套字段）。
      ...(typeof body.defaultAnswer === 'string' && body.defaultAnswer.trim()
        ? { defaultAnswer: String(body.defaultAnswer).slice(0, 2000) }
        : {}),
      ...(body.blocking === true ? { blocking: true } : {}),
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
