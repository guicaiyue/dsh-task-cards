// POST /reconcile：跑一次对账（M1 只做「被更新的同类卡取代」）。

import type { HttpRequestLike, HttpResponseLike } from '../http'
import { sendJson } from '../http'
import type { RouteDeps } from './deps'

export function createReconcileHandler(deps: RouteDeps) {
  return async (_req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const summary = await deps.kernel.reconcile()
    return sendJson(res, 200, { ok: true, ...summary })
  }
}
