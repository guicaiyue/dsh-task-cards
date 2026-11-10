// 阶段 B 离线回放：用真实 cards.json 跑 route()（不调模型），统计升级率/wait 结构。
// 用法：DTC_REPLAY_CARDS=/path/cards.json npx vitest run tests/host/replay-route.test.ts

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { route, waitStructureOk } from '../../src/host/decision/route'
import type { Card } from '../../src/shared/contract'
import { laneOf } from '../../src/shared/state'
import { budgetPolicy } from './helpers/policy-fixture'

const file = process.env.DTC_REPLAY_CARDS

describe.skipIf(!file)('真实卡离线回放（route 三档）', () => {
  it('统计 decider 分布 / 升级率 / wait 结构合规', () => {
    const raw = JSON.parse(fs.readFileSync(file as string, 'utf8')) as unknown
    const cards = (Array.isArray(raw) ? raw : (raw as { cards: Card[] }).cards) as Card[]
    const decisions = cards.filter((card) => card.kind === 'decision')
    const routable = decisions.filter((card) => card.advice)
    const pending = decisions.filter((card) => !card.advice)
    const notices = cards.filter((card) => card.decision === 'notice' || card.kind === 'info')
    const policy = budgetPolicy()
    const bytes = fs.readFileSync(file as string)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    // 合成卡口径（审计员构造规则）：有闸门凭据，或标题像探针/实验/合成。
    const syntheticRe = /探针|probe|P0-|对抗|拦下|测试卡|合成/i
    const isSynthetic = (card: Card): boolean => Boolean(card.gate) || syntheticRe.test(card.title)
    const rows = routable.map((card) => ({
      id: card.id,
      synthetic: isSynthetic(card),
      effect: card.advice?.effect ?? 'read',
      decider: route({ card, advice: card.advice, policy }).decider,
      reason: route({ card, advice: card.advice, policy }).reason,
    }))
    const group = (list: typeof rows) => {
      const user = list.filter((row) => row.decider === 'user')
      const nonDestructive = list.filter((row) => row.effect !== 'destructive')
      const userNonDestructive = user.filter((row) => row.effect !== 'destructive')
      return {
        routable: list.length,
        deciders: {
          auto: list.filter((row) => row.decider === 'auto').length,
          secretary: list.filter((row) => row.decider === 'secretary').length,
          user: user.length,
        },
        escalationRate: list.length ? Number((user.length / list.length).toFixed(3)) : 0,
        reversibleEscalationRate: nonDestructive.length
          ? Number((userNonDestructive.length / nonDestructive.length).toFixed(3))
          : 0,
      }
    }
    const real = rows.filter((row) => !row.synthetic)
    const user = rows.filter((row) => row.decider === 'user')
    const nonDestructive = rows.filter((row) => row.effect !== 'destructive')
    const userNonDestructive = user.filter((row) => row.effect !== 'destructive')
    const waits = routable.filter((card) => card.advice?.verdict === 'wait')
    const waitOk = waits.filter((card) => waitStructureOk(card.advice as never))
    const summary = {
      file,
      sha256,
      syntheticRule: 'card.gate 存在 或 title 命中 /探针|probe|P0-|对抗|拦下|测试卡|合成/',
      syntheticCards: cards.filter(isSynthetic).length,
      cards: cards.length,
      decision: decisions.length,
      routable: routable.length,
      pending_secretary: pending.length,
      notices: notices.length,
      groups: { all: group(rows), real: group(real) },
      waitTotal: waits.length,
      waitStructureOk: waitOk.length,
      rows: rows.map(
        (row) =>
          `${row.id.slice(0, 12)} ${row.synthetic ? '[合成]' : '[真实]'} ${row.effect}→${row.decider} ${row.reason}`,
      ),
    }
    console.log(JSON.stringify(summary, null, 2))
    expect(summary.routable + summary.pending_secretary).toBe(decisions.length)
  })
})
