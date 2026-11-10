// GET /case?id=：一张卡的全景（卡 + 事件 + 清单 + 证据）。

import { StoreError } from '../cards/store'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { sendJson } from '../http'
import { param, type RouteDeps } from './deps'

export function createCaseHandler(deps: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const id = param(req.url, 'id')
    if (!id) throw new StoreError('MISSING_ID', '缺少卡片 id')
    const card = deps.cards.find(id)
    if (!card) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')
    const [journal, todo, evidence] = await Promise.all([
      deps.kernel.journal.read(id),
      deps.kernel.todo.read(id),
      deps.kernel.evidence.read(id),
    ])
    // 阶段 B：delegated 票的独立账本随案卷返回（审计可看 authority/policyVersion/confidence）。
    // 不走缓存读：测试/外部写入 plans.json 后立刻可见。
    const verdicts = deps.kernel.plans.verdictsFresh(id)
    return sendJson(res, 200, {
      verdicts,
      ok: true,
      card,
      events: journal.events,
      badLines: journal.badLines,
      todo,
      evidence: evidence.records,
    })
  }
}
