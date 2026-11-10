// 面板一键补验收方式（阶段 E/G1）：令牌 + 白名单，去掉「无验收方式」标记。

import type { Card } from '../../shared/contract'
import { StoreError } from '../cards/store'
import { sanitizeAll } from '../evidence/guard'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { sendJson } from '../http'
import { assertPanelToken } from './auth'
import type { RouteDeps } from './deps'

export const NO_ACCEPTANCE_MARK = '⚠ 无验收方式，需人工补充'

/** 面板补验收：只接受白名单清洗后的 acceptance，并去掉「无验收方式」标记。 */
export async function panelAcceptance(
  deps: RouteDeps,
  card: Card,
  body: Record<string, unknown>,
  req: HttpRequestLike,
  res: HttpResponseLike,
): Promise<unknown> {
  assertPanelToken(req)
  const acceptance = sanitizeAll(
    Array.isArray(body.acceptance) ? (body.acceptance as never[]) : undefined,
    process.cwd(),
  )
  if (!acceptance.length)
    throw new StoreError('BAD_ACCEPTANCE', '没有可用的验收方式（被白名单拒绝）')
  const detail = card.detail
    .split('\n')
    .filter((line) => line.trim() !== NO_ACCEPTANCE_MARK)
    .join('\n')
    .trim()
  const patched = await deps.cards.patch(card.id, { acceptance, detail }, 'acceptance:patched')
  deps.log(`卡片动作：acceptance → 已补 ${acceptance.length} 条（${card.id}）`)
  return sendJson(res, 200, { ok: true, card: patched })
}
