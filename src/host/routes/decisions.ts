// GET/POST /decisions：判例列表、返工标记、立即重跑决策。
//
// 返工标记是用户显式的一次动作（面板上的「这个决定后来返工了」），不猜、不自动推断；
// 标过之后这条判例不再进决策输入（过滤在 decision/input.ts）。

import { StoreError } from '../cards/store'
import { markReworked } from '../decision/precedent'
import { asString } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { readJson, sendJson } from '../http'
import type { RouteDeps } from './deps'

/** 面板的决策记录最多回看 30 次。 */
const DECISION_RECORD_LIMIT = 30

export function createDecisionsHandler({ cards, precedents, records, decision, log }: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    if (req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        precedents: precedents.list(),
        // 最近几次决策运行（成功 / 空 / 失败都记）：面板据此展示执行记录。
        records: records.listByPhase('decision', DECISION_RECORD_LIMIT),
        warning: precedents.warning,
      })
    }
    const body = await readJson(req)
    const action = asString(body.action)
    const rawIds = Array.isArray(body.ids) ? body.ids.map((item) => asString(item)) : []
    const ids = rawIds.filter(Boolean)
    const id = asString(body.id)
    if (id) ids.unshift(id)
    if (!ids.length) throw new StoreError('MISSING_ID', '缺少卡片 id')
    if (action === 'preview') {
      const result = await decision.preview(ids)
      return sendJson(res, 200, result)
    }
    const card = cards.find(ids[0] ?? '')
    if (!card) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')
    if (action === 'mark-reworked') {
      const note = asString(body.option) || asString(body.note)
      const result = await markReworked(cards, precedents, card, note)
      log(`判例标记返工：${card.title}（判例 ${result.precedent.id}）`)
      return sendJson(res, 200, { ok: true, ...result, card: cards.find(id) })
    }
    if (action === 'redecide') {
      // 立即排队重跑，不占着 HTTP 请求等模型（一次决策可能几十秒）。
      decision.redecide(ids[0] ?? '')
      log(`重新出票拟：${card.title}`)
      return sendJson(res, 200, { ok: true, scheduled: true, card })
    }
    throw new StoreError('BAD_ACTION', '未知操作')
  }
}
