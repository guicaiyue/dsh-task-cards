// POST /action：完成 / 忽略 / 重开 / 立即执行 / 作答 / 采纳方案 / 批红 / 返工标记 / 删除。
//
// 人的决定在这里顺手落一条判例（作答 / 完成 / 忽略 / 采纳方案 / 批红），只对决策卡：
// 通知卡与自动卡的关闭不是决定。判例只由人的动作产生，代理人只读不写。

import type { Card } from '../../shared/contract'
import { ACTION_EVENT, ACTION_RESULT, isCardAction, isClosed } from '../../shared/state'
import { StoreError } from '../cards/store'
import { manualBlockers } from '../decision/answer-guard'
import { choiceOfAction, markReworked, recordChoice } from '../decision/precedent'
import { clarificationAnswer, permissionAnswer } from '../decision/templates'
import { asString } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { readJson, sendJson } from '../http'
import { answerQuestion } from '../question/answer'
import { deliverToOrigin } from '../question/deliver'
import { answerPendingQuestion } from '../question/pending'
import type { CardQuestion } from '../question/types'
import type { RouteDeps } from './deps'

function messageOf(err: unknown): string {
  return (err as Error)?.message || String(err)
}

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
    if (name === 'answer') return answerCard(deps, card, asString(body.option || body.text), res)
    if (name === 'adopt') return adoptCard(deps, card, asString(body.option), res)
    // 批红是唯一会把话推回原会话的卡片动作：批准了就应该让那轮对话继续跑。
    if (name === 'approve') return approveCard(deps, card, asString(body.option), res)
    // 许可卡拒绝：把固定模板推回原会话，不是静默关闭。
    if (name === 'deny') return denyCard(deps, card, res)
    if (name === 'mark-reworked') return reworkCard(deps, card, asString(body.option), res)
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

/** 卡片作答：先试宿主的原生提问通道，会话没了就模拟用户输入。 */
async function answerCard(
  deps: RouteDeps,
  card: Card,
  raw: string,
  res: HttpResponseLike,
): Promise<unknown> {
  const rawText = raw.trim()
  if (!rawText) throw new StoreError('MISSING_ANSWER', '缺少要回答的内容')
  // 澄清卡的答复要带上原问题，原会话才能独立接住。
  const text =
    card.ask === 'clarification'
      ? clarificationAnswer(
          card.advice?.question || card.question?.items?.[0]?.question || card.title,
          rawText,
        )
      : rawText
  const question = (card.question || {}) as CardQuestion
  const sessionId = question.sessionId || (card.origin && card.origin.sessionId)
  const items = Array.isArray(question.items) ? question.items : []
  const answers = items.length
    ? items.map((item) => ({ id: item.id, selected: [text] }))
    : [{ id: question.id || 'q', selected: [text] }]
  const native = sessionId ? answerPendingQuestion(sessionId, answers) : false
  const result = native
    ? { via: 'question' as const, answered: true }
    : await answerQuestion(card, text, deps.runtime())
  const wasClosed = isClosed(card.status)
  const patched = await deps.cards.patch(
    card.id,
    { status: 'done', answer: text, answeredAt: Date.now(), answeredVia: 'card' },
    'answered',
  )
  if (!wasClosed) {
    await recordChoice(deps.precedents, patched, text).catch((err: unknown) =>
      deps.log(`判例写入失败：${messageOf(err)}`),
    )
  }
  return sendJson(res, 200, { ok: true, result, card: deps.cards.find(card.id) })
}

/** 许可卡拒绝：把固定模板推回原会话，再结束卡片。 */
async function denyCard(deps: RouteDeps, card: Card, res: HttpResponseLike): Promise<unknown> {
  if (card.ask !== 'permission') throw new StoreError('BAD_ACTION', '只有许可卡可以拒绝')
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

/** 采纳票拟里的第 N 个方案：option 是 0-based 序号，等价于用它的 answer 作答。 */
async function adoptCard(
  deps: RouteDeps,
  card: Card,
  raw: string,
  res: HttpResponseLike,
): Promise<unknown> {
  const index = Number.parseInt(raw.trim(), 10)
  const options = card.advice?.options || []
  const option =
    Number.isInteger(index) && index >= 0 && index < options.length ? options[index] : undefined
  if (!option) throw new StoreError('BAD_OPTION', '方案序号不对')
  const text = option.answer.trim()
  if (!text) throw new StoreError('MISSING_ANSWER', '这个方案没有能直接回给原会话的话')
  return answerCard(deps, card, text, res)
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
function approveText(card: Card, raw: string): string {
  const given = raw.trim()
  if (given) return given
  const advice = card.advice
  if (advice) {
    const chosen = (advice.options[advice.chosen]?.answer || '').trim()
    if (chosen) return chosen
  }
  const answered = asString(card.answer).trim()
  if (answered) return answered
  return `已批准：${card.title}。按这个方向继续。`
}

/**
 * 决策卡批红：把批准的那句话推回原会话，然后结束这张卡。
 * 推不回去（没有 origin.sessionId / 会话已死）也照样结束：卡不能卡死，
 * 只在卡上留 approved:no-session / approved:failed 事件，交给面板说明。
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
