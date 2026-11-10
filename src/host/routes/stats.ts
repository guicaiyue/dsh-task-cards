// GET /stats：真实回合数 + 六项 KPI（全量 / 剔除合成 两组）+ 数据源 sha256。
//
// 口径（docs/contracts.md「/stats 口径」）：
// - 分母 = 真实会话回合（session 日志 turn/end，排除 card-dec-*/card-obs-*）；
// - 干预 = answered + approved + denied + dismissed（排除合成卡）；
// - 卡/回合只算 decision 卡（通知单列「通知/回合」）；
// - 合成卡标记：card.gate 存在或标题命中 /探针|probe|P0-|对抗|拦下|测试卡|合成/。

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { Card } from '../../shared/contract'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { sendJson } from '../http'
import { countSessionTurns } from '../stats/turns'
import type { RouteDeps } from './deps'

const SYNTHETIC = /探针|probe|P0-|对抗|拦下|测试卡|合成/i
const HUMAN_EVENTS = new Set(['answered', 'approved', 'denied', 'dismissed'])

function ratio(part: number, total: number): number | null {
  return total > 0 ? Number((part / total).toFixed(3)) : null
}

/**
 * 人工批准（13 条历史记录里不在 card.events 上）：从 journal 数
 * `authority=user → to=waiting`，排除合成卡。
 */
function countApprovals(journalDir: string, synthetic: Set<string>, present: Set<string>): number {
  let total = 0
  try {
    for (const entry of readdirSync(journalDir)) {
      if (!entry.endsWith('.jsonl')) continue
      for (const line of readFileSync(path.join(journalDir, entry), 'utf8').split('\n')) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as {
          caseId: string
          to?: string
          authority?: string
        }
        // 只数「卡还在快照里」的批准：已被删除的卡不再代表现存决定（审计同口径）。
        if (
          event.to === 'waiting' &&
          event.authority === 'user' &&
          present.has(event.caseId) &&
          !synthetic.has(event.caseId)
        )
          total += 1
      }
    }
  } catch {
    return 0
  }
  return total
}

function kpiOf(cards: readonly Card[], turns: number, approvals = 0) {
  const decision = cards.filter((card) => card.kind === 'decision' && card.decision !== 'notice')
  // wait 率分母 = 有票拟的 decision；升级率分母 = 非 destructive 的 decision（docs 口径）。
  const advised = decision.filter((card) => Boolean(card.advice))
  const reversible = decision.filter((card) => card.advice?.effect !== 'destructive')
  const notices = cards.filter((card) => card.kind !== 'decision' || card.decision === 'notice')
  let interventions = 0
  let delegated = 0
  let escalated = 0
  let waits = 0
  let overridden = 0
  for (const card of cards) {
    interventions += card.events.filter((event) => HUMAN_EVENTS.has(event.type)).length
    if (card.events.some((event) => event.type === 'delegated:overridden')) overridden += 1
    if (card.kind !== 'decision' || card.decision === 'notice') continue
    if (card.route?.decider === 'secretary') delegated += 1
    if (card.route?.decider === 'user') escalated += 1
    if (card.advice?.verdict === 'wait') waits += 1
  }
  const unknownCards = cards.filter(
    (card) => card.deliveryState === 'unknown' || card.decision === 'stale',
  )
  const unknownToHuman = unknownCards.filter(
    (card) =>
      card.waitReason === 'awaiting-user-escalation' ||
      card.waitReason === 'retry-exhausted' ||
      card.kind === 'decision',
  )
  const withAcceptance = decision.filter((card) => (card.acceptance?.length ?? 0) > 0)
  return {
    cards: cards.length,
    decision: decision.length,
    acceptanceCards: withAcceptance.length,
    acceptanceCoverage: ratio(withAcceptance.length, decision.length),
    advised: advised.length,
    reversible: reversible.length,
    notices: notices.length,
    interventions: interventions + approvals,
    delegated,
    escalated,
    waits,
    overridden,
    delegatedRate: ratio(delegated, decision.length),
    overrideRate: ratio(overridden, delegated),
    escalationRate: ratio(escalated, reversible.length),
    waitRate: ratio(waits, advised.length),
    cardsPerTurn: ratio(decision.length, turns),
    interventionsPerTurn: ratio(interventions + approvals, turns),
    noticePerTurn: ratio(notices.length, turns),
    unknown: unknownCards.length,
    unknownToHuman: unknownToHuman.length,
    unknownToHumanRate: ratio(unknownToHuman.length, unknownCards.length),
  }
}

export function createStatsHandler(deps: RouteDeps) {
  return async (_req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const cards = deps.cards.list()
    const dshHome = process.env.DSH_HOME ?? ''
    const { sessions, turns } = countSessionTurns(dshHome, deps.log)
    let cardsSha256 = ''
    try {
      cardsSha256 = createHash('sha256').update(readFileSync(deps.cards.file)).digest('hex')
    } catch {
      cardsSha256 = ''
    }
    const synthetic = new Set(
      cards
        .filter((card) => Boolean(card.gate) || SYNTHETIC.test(card.title))
        .map((card) => card.id),
    )
    const real = cards.filter((card) => !synthetic.has(card.id))
    const present = new Set(cards.map((card) => card.id))
    const approvalsAll = countApprovals(deps.kernel.journal.dir, new Set(), present)
    const approvalsReal = countApprovals(deps.kernel.journal.dir, synthetic, present)
    return sendJson(res, 200, {
      ok: true,
      generatedAt: Date.now(),
      dataSource: {
        cardsFile: deps.cards.file,
        cardsSha256,
        cards: cards.length,
        syntheticCards: synthetic.size,
        turnsSource: `${dshHome}/sessions/*/session-*/session.v4.jsonl.zstd`,
        sessions,
      },
      turns,
      metric: '同幂等键不重复派发（at-least-once，不承诺 exactly-once）',
      groups: {
        all: kpiOf(cards, turns, approvalsAll),
        real: kpiOf(real, turns, approvalsReal),
      },
    })
  }
}
