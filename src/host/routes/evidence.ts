// POST /evidence：按**批准时冻结**的 acceptance 收集证据并落账。
//
// 收口（审计 P0-4）：不再接受外部 `cmd`/`checks`——checker 只能来自卡上冻结的
// `acceptance[]`，且必须绑定批准时生成的 planId；伪造/未批准一律 403/400。

import { StoreError } from '../cards/store'
import { asString } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { readJson, sendJson } from '../http'
import { assertPanelToken } from './auth'
import type { RouteDeps } from './deps'

const MAX_CHECKS = 5

export function createEvidenceHandler(deps: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const body = await readJson(req)
    const caseId = asString(body.caseId)
    if (!caseId) throw new StoreError('MISSING_CASE', '缺少 caseId')
    const card = deps.cards.find(caseId)
    if (!card) throw new StoreError('NOT_FOUND', '这张卡不存在')
    // 外部不能传命令/检查器：只认冻结的计划。
    if (body.checks !== undefined || body.cmd !== undefined)
      throw new StoreError('PLAN_BOUND', '证据只能按已批准的 acceptance 收集，不接受外部命令')
    const planId = asString(body.planId)
    if (!card.planId || card.planId !== planId)
      throw new StoreError('PLAN_MISMATCH', '计划 id 对不上（或这张卡还没批准）')
    const acceptance = card.acceptance ?? []
    if (!acceptance.length)
      throw new StoreError('NO_ACCEPTANCE', '这张卡没有冻结的验收检查，不能收集证据')
    // 回执/自动收证据不经过 HTTP；这个接口只保留「人手动重收一次」，要面板令牌。
    assertPanelToken(req)
    // P2：同一卡同一 epoch 的证据上限（含自动收集的），超了直接 429/400，不无限叠加。
    const epoch = card.evidenceEpoch ?? 0
    const existing = await deps.kernel.evidence.read(caseId)
    const used = existing.records.filter((record) => (record.epoch ?? 0) === epoch).length
    if (used + acceptance.length > MAX_CHECKS)
      throw new StoreError(
        'TOO_MANY_EVIDENCE',
        `同一个计划版本最多 ${MAX_CHECKS} 条证据（已有 ${used} 条，本次 ${acceptance.length} 条）`,
      )
    if (acceptance.length > MAX_CHECKS)
      throw new StoreError('TOO_MANY_CHECKS', `一次最多 ${MAX_CHECKS} 条检查`)
    const records = []
    for (const item of acceptance) {
      const checked = await deps.kernel.evidence.check(
        caseId,
        [item.spec],
        {},
        {
          level: item.level,
          sourceRef: `${card.planId}#${item.id}`,
          epoch,
        },
      )
      records.push(...checked)
    }
    return sendJson(res, 200, { ok: records.every((record) => record.ok), records })
  }
}
