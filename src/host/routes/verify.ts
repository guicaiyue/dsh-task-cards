// POST /verify：手动对一张卡做验收（也供测试与后续面板按钮用）。

import { StoreError } from '../cards/store'
import { asString } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { readJson, sendJson } from '../http'
import type { RouteDeps } from './deps'

export function createVerifyHandler(deps: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const body = await readJson(req)
    const caseId = asString(body.caseId)
    if (!caseId) throw new StoreError('MISSING_CASE', '缺少 caseId')
    if (!deps.cards.find(caseId)) throw new StoreError('NOT_FOUND', '这张卡不存在')
    const outcome = await deps.kernel.verify(caseId)
    if (!outcome) throw new StoreError('NOT_EXECUTED', '这张卡还不在「已执行」，无法验收')
    return sendJson(res, 200, { ok: true, ...outcome, card: deps.cards.find(caseId) })
  }
}
