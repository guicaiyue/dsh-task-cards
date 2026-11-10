// POST /action：完成 / 忽略 / 重开 / 立即执行 / 作答 / 采纳方案 / 批红 / 返工标记 / 删除。
//
// 人的决定在这里顺手落一条判例（作答 / 完成 / 忽略 / 采纳方案 / 批红），只对决策卡：
// 通知卡与自动卡的关闭不是决定。判例只由人的动作产生，代理人只读不写。

import { canTransition } from '../../shared/case'
import type { Card } from '../../shared/contract'
import {
  ACTION_EVENT,
  ACTION_RESULT,
  isCardAction,
  isCardClosed,
  isClosed,
} from '../../shared/state'

import { StoreError } from '../cards/store'
import { manualBlockers } from '../decision/answer-guard'
import { choiceOfAction, markReworked, recordChoice } from '../decision/precedent'
import { permissionAnswer } from '../decision/templates'
import { sanitizeAll } from '../evidence/guard'
import { asString } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { readJson, sendJson } from '../http'
import { kernelEnabled } from '../kernel/flags'
import { deliverToOrigin } from '../question/deliver'
import { consumeUserSemantic } from '../verification/semantic'
import { approveText, assertApprovable } from './action-text'
import { adoptCard, answerCard } from './answer'
import { assertPanelToken } from './auth'
import type { RouteDeps } from './deps'
import { ensureApprovedPlan } from './plan-create'

async function overrideCard(
  deps: RouteDeps,
  card: Card,
  req: HttpRequestLike,
  res: HttpResponseLike,
): Promise<unknown> {
  assertPanelToken(req)
  const patched = await deps.cards.patch(
    card.id,
    { decision: 'escalated_user' },
    'delegated:overridden',
  )
  await deps.cards
    .patch(card.id, { authority: 'user' }, 'delegated:override-ack')
    .catch((err: unknown) => deps.log(`override 审计写入失败：${messageOf(err)}`))
  deps.log(`卡片动作：override → 人接管 delegated 决定（${card.id}）`)
  return sendJson(res, 200, { ok: true, card: patched })
}

export function messageOf(err: unknown): string {
  return (err as Error)?.message || String(err)
}

/**
 * 批准时冻结验收计划：planId 绑证据/清单，nonce 只留在卡上（执行者拿不到）。
 * 已冻结的卡不重复生成（幂等）；写盘失败只打日志，不挡批准。
 */
async function freezePlan(deps: RouteDeps, card: Card): Promise<void> {
  if (card.planId) return
  // 阶段 D：冻结前再过一次服务端白名单（旧卡/外部写入的 acceptance 不可信）。
  const acceptance = sanitizeAll(card.acceptance, process.cwd())
  const noAcceptance = acceptance.length === 0
  const detail =
    noAcceptance && !card.detail.includes(NO_ACCEPTANCE_MARK)
      ? `${card.detail}${card.detail ? '\n' : ''}${NO_ACCEPTANCE_MARK}`
      : card.detail
  const frozen = {
    planId: `${card.id}:${card.decisionSeq ?? 0}`,
    acceptance,
    detail: detail.slice(0, 2000),
  }
  card.planId = frozen.planId
  await deps.cards
    .patch(card.id, frozen, 'plan:frozen')
    .catch((err: unknown) => deps.log(`计划冻结写入失败：${messageOf(err)}`))
}

export const NO_ACCEPTANCE_MARK = '⚠ 无验收方式，需人工补充'

export function createActionHandler(deps: RouteDeps) {
  const { cards, scanner, precedents, log } = deps
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const body = await readJson(req)
    const id = asString(body.id)
    const name = asString(body.action)
    if (!id) throw new StoreError('MISSING_ID', '缺少卡片 id')
    const card = cards.find(id)
    if (!card) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')

    if (name === 'delete') return sendJson(res, 200, { ok: true, ...(await cards.remove(id)) })
    if (name === 'run-now') {
      const result = await scanner.execute(card)
      return sendJson(res, 200, { ok: true, result, card: cards.find(id) })
    }
    if (name === 'answer') {
      // 答题等于替人做决定并把答复派回会话：结论性动作，要面板令牌。
      assertPanelToken(req)
      return answerCard(deps, card, asString(body.option || body.text), body.answers, res)
    }
    if (name === 'adopt') return adoptCard(deps, card, asString(body.option), res)
    // 批红是唯一会把话推回原会话的卡片动作：批准了就应该让那轮对话继续跑。
    // 特权写：批准/拒绝/重开要面板令牌（actor 字段不可信）。
    if (name === 'approve') {
      assertPanelToken(req)
      return approveCard(deps, card, asString(body.option), res)
    }
    // 许可卡拒绝：把固定模板推回原会话，不是静默关闭。
    if (name === 'deny') {
      assertPanelToken(req)
      return denyCard(deps, card, res)
    }
    if (name === 'mark-reworked') return reworkCard(deps, card, asString(body.option), res)
    // 重开一张已进执行链路的卡要把投递状态退回去，否则派生映射会把它又判成已结束。
    // 阶段 B：delegated 票一键 override（补偿语义：不恢复旧状态，只把决定权收回人）。
    if (name === 'override') return overrideCard(deps, card, req, res)
    if (name === 'reopen') {
      // 无条件特权：重开（含已关闭的卡）是结论性动作。
      assertPanelToken(req)
      if ((card.deliveryState ?? 'idle') !== 'idle') return reopenCard(deps, card, res)
    }
    if (!isCardAction(name)) throw new StoreError('BAD_ACTION', '未知操作')
    const wasClosed = isClosed(card.status)
    const status = ACTION_RESULT[name]
    const patched = await cards.patch(id, { status }, ACTION_EVENT[name])
    const choice = choiceOfAction(name)
    // 判例只收决策卡上的选择：关掉一条通知、取消一个自动动作都不是决定，
    // 进了判例库就会变成决策代理人的「同类判例」，污染它的判断。
    if (!wasClosed && choice && patched.kind === 'decision') {
      await recordChoice(precedents, patched, choice).catch((err: unknown) =>
        log(`判例写入失败：${messageOf(err)}`),
      )
    }
    log(`卡片动作：${name} → ${status}`)
    return sendJson(res, 200, { ok: true, card: patched })
  }
}

/** 内核接管：批准后写答案 + 计划 + 转调度队列（WIP=1 由 scheduler 管）。 */
async function queueApproved(
  deps: RouteDeps,
  card: Card,
  text: string,
  res: HttpResponseLike,
): Promise<unknown> {
  await ensureApprovedPlan(deps, card, text)
  await deps.cards.patch(card.id, { answer: text, answeredVia: 'card' }, 'approved:queued')
  const queued = await deps.kernel.apply({
    cardId: card.id,
    to: 'waiting',
    actor: 'scheduler',
    authority: 'user',
    reason: '用户批红，进入调度队列',
    waitReason: 'queued',
    expectedSeq: card.decisionSeq ?? 0,
  })
  deps.log(`卡片动作：approve → 入队（${card.id}）`)
  await consumeUserSemantic(deps.cards, (o) => deps.kernel.plans.recordOutcome(o), card, 'approve')
  return sendJson(res, 200, { ok: true, pushed: false, reason: 'queued', card: queued.card })
}

/** 许可卡拒绝：把固定模板推回原会话，再结束卡片。 */
async function denyCard(deps: RouteDeps, card: Card, res: HttpResponseLike): Promise<unknown> {
  if (card.ask !== 'permission') throw new StoreError('BAD_ACTION', '只有许可卡可以拒绝')
  // 拒绝：清掉可能存在的放行券与去重登记，避免过期券被误用。
  deps.gate?.clearAllow(card)
  const text = permissionAnswer(card, false)
  const wasClosed = isClosed(card.status)
  const result = await deliverToOrigin({
    cards: deps.cards,
    getCtx: deps.runtime,
    log: deps.log,
    card,
    text,
    event: 'denied',
  })
  if (result.pushed && !wasClosed && result.card) {
    await recordChoice(deps.precedents, result.card, text).catch((err: unknown) =>
      deps.log(`判例写入失败：${messageOf(err)}`),
    )
  }
  return sendJson(res, 200, {
    ok: true,
    pushed: result.pushed,
    ...(result.reason ? { reason: result.reason } : {}),
    card: deps.cards.find(card.id),
  })
}

/** 标记「这个决定后来返工了」：判例改 reworked，卡上留事件，不改状态不执行动作。 */
async function reworkCard(
  deps: RouteDeps,
  card: Card,
  note: string,
  res: HttpResponseLike,
): Promise<unknown> {
  const result = await markReworked(deps.cards, deps.precedents, card, note)
  deps.log(`卡片动作：mark-reworked（判例 ${result.precedent.id}）`)
  return sendJson(res, 200, { ok: true, ...result, card: deps.cards.find(card.id) })
}

/**
 * 批红时发回去的是哪句话：面板给的 → 推荐方案的 answer → 卡上已有的回答 → 兜底模板。
 * 兜底模板让最坏情况（票拟没写 answer、卡也没答过）仍然能推进那轮对话。
 */
async function approveCard(
  deps: RouteDeps,
  card: Card,
  raw: string,
  res: HttpResponseLike,
): Promise<unknown> {
  const text = card.ask === 'permission' ? permissionAnswer(card, true) : approveText(card, raw)
  const blockers = manualBlockers(card, text)
  if (blockers.length) {
    throw new StoreError('NOT_EXECUTABLE', `这句话执行不了：${blockers.join(', ')}`)
  }
  assertApprovable(card)
  // 回合内被拦下的动作：批准时发一张一次性放行券（同签名下一次调用通过）。
  deps.gate?.allowOnce(card)
  await freezePlan(deps, card)
  // 内核接管：批准不再直接投递，转入调度队列（WIP=1 / 非抢占由 scheduler 管）。
  if (kernelEnabled() && card.origin?.sessionId) return queueApproved(deps, card, text, res)
  const wasClosed = isClosed(card.status)
  const result = await deliverToOrigin({
    cards: deps.cards,
    getCtx: deps.runtime,
    log: deps.log,
    card,
    text,
    event: ACTION_EVENT.approve,
  })
  // 判例只由人的动作产生，且只在真正推出去之后落：没推进会话的批准不算他定过。
  if (result.pushed && !wasClosed && result.card) {
    await recordChoice(deps.precedents, result.card, text).catch((err: unknown) =>
      deps.log(`判例写入失败：${messageOf(err)}`),
    )
  }
  const how = result.pushed ? '已投递回原会话' : `未投递：${result.reason}`
  deps.log(`卡片动作：approve → done（${how}）`)
  return sendJson(res, 200, {
    ok: true,
    pushed: result.pushed,
    ...(result.reason ? { reason: result.reason } : {}),
    card: deps.cards.find(card.id),
  })
}

/**
 * 重新打开一张已进执行链路的卡：先把投递状态退回 idle（人重新接管），再把 status 打开。
 * 状态机不允许退回的（例如已派发、在飞）直接拒绝——只改 status 会留下一张
 * 「status 待处理 / 投递已结束」的自相矛盾卡，下一次生命周期对齐又会把它关掉。
 */
/** reopen 语义：新计划从零开始，旧 epoch 证据只作历史。 */
async function resetEvidenceEpoch(deps: RouteDeps, card: Card): Promise<void> {
  await deps.cards
    .patch(card.id, { planId: null, evidenceEpoch: (card.evidenceEpoch ?? 0) + 1 }, 'plan:reopened')
    .catch((err: unknown) => deps.log(`证据版本重置失败：${messageOf(err)}`))
}

async function reopenCard(deps: RouteDeps, card: Card, res: HttpResponseLike): Promise<unknown> {
  const from = card.deliveryState ?? 'idle'
  if (!canTransition(from, 'idle', 'user'))
    throw new StoreError('BAD_STATE', `这张卡正在执行（${from}），不能重新打开`)
  // transition 到 idle 会同时把 status 打开、清掉 invalidatedReason，不需要再补一次 patch。
  const out = await deps.kernel.apply({
    cardId: card.id,
    to: 'idle',
    actor: 'user',
    authority: 'user',
    reason: '用户重新打开这张卡',
    expectedSeq: card.decisionSeq ?? 0,
  })
  // D：新计划从零开始，旧 epoch 证据只作历史（不删旧账）。
  await resetEvidenceEpoch(deps, card)
  deps.log(`卡片动作：reopen ← ${from}（${card.id}）`)
  return sendJson(res, 200, { ok: true, card: out.card })
}
