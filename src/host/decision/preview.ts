// 决策票拟的只读预演：跑同一套提示词和输入，但不写卡、不投递、不记执行记录。
//
// 面板/排查用它评估「决策者会怎么判」，与真实执行完全隔离。

import type { Card, Settings } from '../../shared/contract'
import { isClosed } from '../../shared/state'
import type { PrecedentStore, Store } from '../cards/store'
import type { HostRuntime, Log } from '../host-api'
import type { Waiter } from '../observer/waiter'
import { buildDecisionInput } from './input'
import { type AdviceDraft, parseAdvice } from './parse'
import { type DecisionAttempt, runDecisionAttempt } from './session'

export interface DecisionPreview {
  ok: boolean
  cards: Array<{ id: string; title: string }>
  drafts: AdviceDraft[]
  sessionId?: string
  reason?: string
}

export interface PreviewOptions {
  ctx: HostRuntime
  config: Settings
  cards: Store
  precedents: PrecedentStore
  waiter: Waiter
  log: Log
}

export async function previewDecision(
  options: PreviewOptions,
  cardIds: string[],
): Promise<DecisionPreview> {
  const { ctx, config, cards, precedents, waiter, log } = options
  const targets = cardIds
    .map((id) => cards.find(id))
    .filter((card): card is Card => !!card && !isClosed(card.status))
  const base = { cards: targets.map((card) => ({ id: card.id, title: card.title })) }
  if (!targets.length) return { ok: false, ...base, drafts: [], reason: '没有可预演的卡' }
  if (!ctx.agents || !ctx.sessionController)
    return { ok: false, ...base, drafts: [], reason: '宿主缺少 agents / sessionController' }

  const userText = buildDecisionInput(
    targets,
    precedents.list(config.decisionPrecedentLimit),
    config.decisionPrecedentLimit,
    config.maxInputBytes,
    (id) => cards.find(id),
  )
  const knownIds = new Set(targets.map((card) => card.id))
  let last: DecisionAttempt | null = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    last = await runDecisionAttempt({ ctx, config, userText, attempt, waiter, log })
    const drafts = last.kind === 'ok' ? parseAdvice(last.text, knownIds) : null
    if (drafts) return { ok: true, ...base, drafts, sessionId: last.sessionId }
    if (last.kind === 'ok') last = { ...last, kind: 'session', reason: '输出不是可解析的票拟 JSON' }
    log(`预演第 ${attempt} 次失败：${last.reason}`)
  }
  return {
    ok: false,
    ...base,
    drafts: [],
    sessionId: last?.sessionId,
    reason: (last && last.reason) || '未知原因',
  }
}
