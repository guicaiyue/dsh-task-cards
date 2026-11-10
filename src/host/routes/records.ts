// GET /records：跨卡的最近事件，给面板「记录」屏用。

import type { HttpRequestLike, HttpResponseLike } from '../http'
import { sendJson } from '../http'
import { param, type RouteDeps } from './deps'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 300

export function createRecordsHandler(deps: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const raw = Number(param(req.url, 'limit'))
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT) : DEFAULT_LIMIT
    const { events, truncated } = await deps.kernel.journal.recent(limit)
    // 观察者「跳过」不写 journal（它没有 case），但必须可见：并进记录屏。
    const skipped = deps.records
      .list(limit)
      .filter((record) => record.status === 'skipped')
      .map((record) => ({
        id: record.id,
        caseId: record.originSessionId ?? '',
        traceId: '',
        at: record.at,
        phase: 'observe',
        from: 'observer',
        to: 'skipped',
        actor: 'observer',
        reason: `跳过未观察：${record.skipReason ?? record.error ?? '未知原因'}`,
      }))
    const merged = [...events, ...skipped].sort((left, right) => right.at - left.at).slice(0, limit)
    return sendJson(res, 200, { ok: true, records: merged, truncated })
  }
}
