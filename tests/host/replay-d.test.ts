// 阶段 D 回放：干预/回合、卡/回合、假拒绝，以及「无 acceptance 不被 confirm」真实卡示例。

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyCard } from '../../src/host/verification/verify'
import type { Card } from '../../src/shared/contract'

const dir = process.env.DTC_REPLAY_DIR

const HUMAN = new Set(['approved', 'answered', 'denied', 'reopened', 'delegated:overridden'])

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

describe.skipIf(!dir)('阶段 D 回放（冻结数据集）', () => {
  it('干预/卡 指标 + 无 acceptance 不 confirmed', () => {
    const cardsFile = path.join(dir as string, 'cards.json')
    const journalDir = path.join(dir as string, 'cards.json.journal')
    const raw = JSON.parse(fs.readFileSync(cardsFile, 'utf8')) as unknown
    const cards = (Array.isArray(raw) ? raw : (raw as { cards: Card[] }).cards) as Card[]
    const syntheticRe = /探针|probe|P0-|对抗|拦下|测试卡|合成/i
    const synthetic = new Set(
      cards.filter((card) => Boolean(card.gate) || syntheticRe.test(card.title)).map((c) => c.id),
    )

    const turns = new Set<string>()
    for (const card of cards) {
      const o = card.origin
      if (o?.sessionId && typeof o.turn === 'number' && o.turn > 0)
        turns.add(`${o.sessionId}:${o.turn}`)
    }
    for (const entry of fs.existsSync(journalDir) ? fs.readdirSync(journalDir) : []) {
      if (!entry.endsWith('.jsonl')) continue
      for (const line of fs.readFileSync(path.join(journalDir, entry), 'utf8').split('\n')) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as { caseId: string; meta?: { turn?: number } }
        const card = cards.find((item) => item.id === event.caseId)
        const turn = event.meta?.turn
        if (card?.origin?.sessionId && typeof turn === 'number' && turn > 0)
          turns.add(`${card.origin.sessionId}:${turn}`)
      }
    }

    let interventions = 0
    let fakeRejects = 0
    for (const card of cards) {
      const types = card.events.map((event) => event.type)
      interventions += types.filter((type) => HUMAN.has(type)).length
      const deniedAt = types.indexOf('denied')
      if (deniedAt >= 0 && types.slice(deniedAt + 1).includes('approved')) fakeRejects += 1
    }

    // 「无 acceptance 不被 confirm」：取一张真实卡，去掉 acceptance、置已执行、无证据无回执，
    // 走同一判定函数，验证不会被 confirmed（造一张验证，真实卡为样本）。
    const base = cards.find((card) => !synthetic.has(card.id) && card.kind === 'decision')
    const example = base
      ? ({
          ...base,
          acceptance: [],
          deliveryState: 'executed',
          advice: { ...(base.advice ?? {}), effect: 'write-code' },
        } as Card)
      : null
    const outcome = example
      ? verifyCard({ card: example, todo: null, evidence: [], retries: 0, receipt: null })
      : null

    const summary0 = {
      interventionsPerTurn: turns.size ? Number((interventions / turns.size).toFixed(3)) : null,
      cardsPerTurn: turns.size ? Number((cards.length / turns.size).toFixed(3)) : null,
    }
    const summary = {
      cardsFile,
      cardsSha256: sha256(cardsFile),
      cards: cards.length,
      realCards: cards.length - synthetic.size,
      syntheticCards: synthetic.size,
      turns: turns.size,
      interventions,
      interventionsPerTurn: summary0.interventionsPerTurn,
      cardsPerTurn: summary0.cardsPerTurn,
      fakeRejects,
      thresholds: {
        interventionsPerTurnMet: (summary0.interventionsPerTurn ?? 0) <= 0.3,
        cardsPerTurnMet: (summary0.cardsPerTurn ?? 0) <= 0.3,
      },
      noAcceptanceExample: example
        ? {
            cardId: example.id,
            state: example.deliveryState,
            verified: outcome?.verified,
            action: outcome?.action,
          }
        : null,
    }
    console.log(JSON.stringify(summary, null, 2))
    // 指标达标与否如实记录（不为了过测试改口径）；假拒绝必须为 0。
    expect(summary.fakeRejects).toBe(0)
    if (example) expect(outcome?.verified).not.toBe('confirmed')
  })
})
