// POST /todo：执行者更新清单（增项/改状态/冻结基线）。
//
// 冻结后删基线项必须给 reason，否则 400 TODO_BASELINE_LOCKED。

import type { TodoOp } from '../../shared/todo'
import { StoreError } from '../cards/store'
import { asString } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { readJson, sendJson } from '../http'
import { assertPanelToken } from './auth'
import type { RouteDeps } from './deps'

function selfCompletes(op: TodoOp): boolean {
  return op.type === 'update' && (op as { status?: string }).status === 'done'
}

function parseOps(raw: unknown): TodoOp[] {
  if (!Array.isArray(raw)) throw new StoreError('BAD_OPS', 'ops 必须是数组')
  return raw as TodoOp[]
}

export function createTodoHandler(deps: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const body = await readJson(req)
    const caseId = asString(body.caseId)
    if (!caseId) throw new StoreError('MISSING_CASE', '缺少 caseId')
    const card = deps.cards.find(caseId)
    if (!card) throw new StoreError('NOT_FOUND', '这张卡不存在')
    const actor = asString(body.actor) || 'executor'
    const ops = parseOps(body.ops)
    // 收口（审计 P0-4）：已批准的计划绑定 planId；done/freeze 是结论性动作，要面板令牌
    // （actor 只是审计标签，不再作为授权依据——它永远可伪造）。
    if (card.planId && asString(body.planId) !== card.planId)
      throw new StoreError('PLAN_MISMATCH', '清单必须绑定已批准的计划 id')
    if (ops.some((op) => op.type === 'freeze' || selfCompletes(op))) assertPanelToken(req)
    const todo = await deps.kernel.todo.apply(caseId, ops, actor)
    return sendJson(res, 200, { ok: true, todo })
  }
}
