// 列表排序：面板第一条必须是「等我处理」的卡，已结束的沉底。
// 这里只验纯函数，渲染顺序由 tests/client/panel.test.tsx 验。

import { describe, expect, it } from 'vitest'
import type { CardKind, CardSeverity, CardStatus } from '../../src/shared/contract'
import {
  cardLane,
  compareCards,
  recentInfoCount,
  sortCards,
  unreadInfoCount,
} from '../../src/shared/state'

interface Row {
  id: string
  kind: CardKind
  status: CardStatus
  severity: CardSeverity
  createdAt: number
}

function row(id: string, overrides: Partial<Row> = {}): Row {
  return { id, kind: 'info', status: 'open', severity: 'normal', createdAt: 1, ...overrides }
}

function ids(cards: Row[]): string[] {
  return cards.map((card) => card.id)
}

describe('卡片列表排序', () => {
  it('车道：决策 → 知晓 → 自动 → 已结束', () => {
    expect(cardLane({ kind: 'decision', status: 'open' })).toBe(0)
    expect(cardLane({ kind: 'info', status: 'open' })).toBe(1)
    expect(cardLane({ kind: 'auto', status: 'scheduled' })).toBe(2)
    expect(cardLane({ kind: 'decision', status: 'done' })).toBe(3)
    expect(cardLane({ kind: 'info', status: 'acknowledged' })).toBe(3)
  })

  it('刚生成但已结束的卡排在待处理卡后面', () => {
    const cards = [
      row('已结束的决策', { kind: 'decision', status: 'done', createdAt: 900 }),
      row('等我拍板', { kind: 'decision', status: 'open', createdAt: 100 }),
      row('等我知晓', { kind: 'info', status: 'open', createdAt: 200 }),
      row('自动处理中', { kind: 'auto', status: 'scheduled', createdAt: 300 }),
    ]
    expect(ids(sortCards(cards))).toEqual(['等我拍板', '等我知晓', '自动处理中', '已结束的决策'])
  })

  it('同车道里 severity 高的在前', () => {
    const cards = [
      row('低', { severity: 'low' }),
      row('高', { severity: 'high' }),
      row('中', { severity: 'normal' }),
    ]
    expect(ids(sortCards(cards))).toEqual(['高', '中', '低'])
  })

  it('同车道同 severity 时新的在前', () => {
    const cards = [
      row('旧', { createdAt: 100 }),
      row('新', { createdAt: 300 }),
      row('中', { createdAt: 200 }),
    ]
    expect(ids(sortCards(cards))).toEqual(['新', '中', '旧'])
  })

  it('不改原数组，比较器可单独用于 sort', () => {
    const cards = [row('a', { status: 'done' }), row('b', { status: 'open' })]
    const sorted = sortCards(cards)
    expect(ids(cards)).toEqual(['a', 'b'])
    expect(ids(sorted)).toEqual(['b', 'a'])
    expect(compareCards(cards[0] as Row, cards[1] as Row)).toBeGreaterThan(0)
  })
})

describe('KPI 与侧栏未读', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = 1_760_000_000_000

  it('「要我知晓」只数最近 24 小时的知晓卡，读没读都算', () => {
    const cards = [
      row('刚生成', { createdAt: now - 1000 }),
      row('已读但今天的', { createdAt: now - DAY + 1000, status: 'acknowledged' }),
      row('两天前', { createdAt: now - 2 * DAY }),
      row('决策卡', { kind: 'decision', createdAt: now }),
      row('已忽略', { status: 'dismissed', createdAt: now }),
    ]
    expect(recentInfoCount(cards, now)).toBe(2)
  })

  it('侧栏圆点只数还没已读的知晓卡', () => {
    const cards = [
      row('未读'),
      row('已读', { status: 'acknowledged' }),
      row('决策卡', { kind: 'decision' }),
      row('自动卡', { kind: 'auto', status: 'scheduled' }),
    ]
    expect(unreadInfoCount(cards)).toBe(1)
  })
})
