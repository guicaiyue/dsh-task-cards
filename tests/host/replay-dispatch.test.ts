// 阶段 C：13 次历史 dispatch 语义等价回放（只读真实数据，输出可复现信息）。

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { Card } from '../../src/shared/contract'

const cardsFile = process.env.DTC_REPLAY_CARDS
const journalDir = process.env.DTC_REPLAY_JOURNAL

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

describe.skipIf(!cardsFile || !journalDir)('历史 dispatch 语义等价回放', () => {
  it('13 次 dispatch：键分布、语义字段、同键不重复', () => {
    const raw = JSON.parse(fs.readFileSync(cardsFile as string, 'utf8')) as unknown
    const cards = (Array.isArray(raw) ? raw : (raw as { cards: Card[] }).cards) as Card[]
    const syntheticRe = /探针|probe|P0-|对抗|拦下|测试卡|合成/i
    const synthetic = new Set(
      cards
        .filter((card) => Boolean(card.gate) || syntheticRe.test(card.title))
        .map((card) => card.id),
    )

    const dispatched: Array<{
      cardId: string
      eventId: string
      key: string | null
      synthetic: boolean
    }> = []
    for (const entry of fs.readdirSync(journalDir as string)) {
      if (!entry.endsWith('.jsonl')) continue
      const lines = fs.readFileSync(path.join(journalDir as string, entry), 'utf8').split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as {
          id: string
          caseId: string
          to: string
          phase: string
          meta?: { idempotencyKey?: string }
        }
        if (event.to !== 'dispatched') continue
        expect(event.phase).toBe('execute')
        dispatched.push({
          cardId: event.caseId,
          eventId: event.id,
          key: event.meta?.idempotencyKey ?? null,
          synthetic: synthetic.has(event.caseId),
        })
      }
    }

    const keyed = dispatched.filter((item) => item.key !== null)
    const legacy = dispatched.filter((item) => item.key === null)
    const keys = keyed.map((item) => item.key)
    const summary = {
      cardsFile,
      cardsSha256: sha256(cardsFile as string),
      journalDir,
      dispatches: dispatched.length,
      keyed: keyed.length,
      legacyNoKey: legacy.length,
      syntheticDispatches: dispatched.filter((item) => item.synthetic).length,
      realDispatches: dispatched.filter((item) => !item.synthetic).length,
      uniqueKeys: new Set(keys).size,
      keyedCardIds: [...new Set(keyed.map((item) => item.cardId))].sort(),
      samples: dispatched
        .slice(0, 13)
        .map(
          (item) =>
            `${item.cardId} ${item.synthetic ? '[合成]' : '[真实]'} key=${item.key ?? '(无键·不参与幂等)'}`,
        ),
    }
    console.log(JSON.stringify(summary, null, 2))
    // 语义等价：带键的 dispatch 键唯一（同幂等键不重复派发）
    expect(new Set(keys).size).toBe(keys.length)
  })
})
