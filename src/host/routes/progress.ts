// GET /progress：所有清单的完成度摘要（工作台行内进度用）。

import type { HttpRequestLike, HttpResponseLike } from '../http'
import { sendJson } from '../http'
import type { RouteDeps } from './deps'

export function createProgressHandler(deps: RouteDeps) {
  return async (_req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const progress = await deps.kernel.todo.listSummaries()
    return sendJson(res, 200, { ok: true, progress })
  }
}
