// 自噪声度量：ask 有效率 + 卡片的 zeroAction 比例。
//
// 基线（2026-11-12 真实账本）：6 条 ask 全部由默认答案收尾（人一次没答），
// 86 张卡里 83 张是「一轮结束的记录」而不是把会话卡住的提问 —— 这就是「找事情」的来源。

import { describe, expect, it } from 'vitest'
import { noiseOf } from '../../src/host/stats/noise'
import type { Ask } from '../../src/shared/ask-contract'
import type { Card } from '../../src/shared/contract'

const ask = (over: Partial<Ask>): Ask =>
  ({
    kind: 'ask',
    id: 'a',
    goalId: '',
    sessionId: 's',
    key: '',
    question: 'q',
    defaultAnswer: '不执行',
    blocking: false,
    reason: '',
    effect: 'destructive',
    beforeRef: '',
    policyVersion: 1,
    createdAt: 1,
    ...over,
  }) as Ask

const card = (over: Partial<Card>): Card =>
  ({
    id: 'c',
    title: 't',
    detail: '',
    kind: 'info',
    severity: 'normal',
    status: 'done',
    action: null,
    dueAt: null,
    source: 'agent',
    interaction: 'reply',
    question: null,
    ask: 'judgment',
    origin: null,
    advice: null,
    silent: false,
    createdAt: 1,
    updatedAt: 1,
    events: [],
    ...over,
  }) as unknown as Card

describe('noiseOf', () => {
  it('ask：人答过的与默认收尾的分开数，空账本不除零', () => {
    const stats = noiseOf(
      [],
      [
        ask({ id: 'a1', answeredAt: 2 }),
        ask({ id: 'a2', answeredAt: 2, autoContinued: true }),
        ask({ id: 'a3', answeredAt: 2, autoContinued: true }),
        ask({ id: 'a4' }),
      ],
    )
    expect(stats.asks).toEqual({ total: 4, human: 1, auto: 2, open: 1, autoRate: 0.5 })
    expect(noiseOf([], []).asks.autoRate).toBeNull()
  })

  it('卡：收尾了却没有任何人工动作的算 zeroAction；开着的卡不算', () => {
    const stats = noiseOf(
      [
        card({ id: 'c1', events: [{ at: 1, type: 'created', via: 'agent' }] }),
        card({ id: 'c2', events: [{ at: 1, type: 'answered', via: 'human' }] }),
        card({ id: 'c3', status: 'open' }),
        card({ id: 'c4', interaction: 'question' }),
      ],
      [],
    )
    expect(stats.cards.total).toBe(4)
    // c1（只有 created）与 c4（提问卡但没人动过）算；c2 有人答；c3 还开着。
    expect(stats.cards.zeroAction).toBe(2)
    expect(stats.cards.zeroActionRate).toBe(0.5)
    expect(stats.cards.blocking).toBe(1)
  })
})
