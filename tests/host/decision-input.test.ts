import { describe, expect, it } from 'vitest'
import { buildDecisionInput, DECISION_INPUT_MAX_BYTES } from '../../src/host/decision/input'
import type { Card, Precedent } from '../../src/shared/contract'

function makeCard(overrides: Partial<Card> = {}): Card {
  const base: Card = {
    id: 'c-1',
    title: '要不要把登录页重做',
    detail: '现在的登录页能跑，但结构乱',
    kind: 'decision',
    severity: 'normal',
    status: 'open',
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
  }
  return Object.assign(base, overrides)
}

function makePrecedent(overrides: Partial<Precedent> = {}): Precedent {
  const base: Precedent = {
    id: 'P-1',
    at: 1,
    cardId: 'c-1',
    title: '上次的同类决定',
    question: '当时要定的事',
    choice: '先跑通最小验证',
    outcome: 'unknown',
    note: '',
    keywords: ['登录'],
  }
  return Object.assign(base, overrides)
}

/** 取某个标签块里的正文，方便直接 JSON.parse。 */
function blockOf(input: string, tag: string): string {
  const start = input.indexOf(`<${tag}>`)
  const end = input.indexOf(`</${tag}>`)
  expect(start, `缺少 <${tag}>`).toBeGreaterThan(-1)
  expect(end, `缺少 </${tag}>`).toBeGreaterThan(start)
  return input.slice(start + tag.length + 2, end).trim()
}

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

describe('决策输入构造', () => {
  it('卡片块带 id/title/detail/kind/severity/action，判例块带六项', () => {
    const input = buildDecisionInput(
      [makeCard({ id: 'c-9', title: '删掉旧表', kind: 'auto', severity: 'high' })],
      [makePrecedent()],
      30,
    )
    const cards = JSON.parse(blockOf(input, 'cards')) as Array<Record<string, unknown>>
    expect(cards[0]).toMatchObject({
      id: 'c-9',
      title: '删掉旧表',
      kind: 'auto',
      severity: 'high',
      action: '',
    })
    expect(cards[0]?.detail).toBe('现在的登录页能跑，但结构乱')

    const precedents = JSON.parse(blockOf(input, 'precedents')) as Array<Record<string, unknown>>
    expect(precedents[0]).toMatchObject({
      id: 'P-1',
      title: '上次的同类决定',
      question: '当时要定的事',
      choice: '先跑通最小验证',
      outcome: 'unknown',
      note: '',
    })
    expect(precedents[0]?.keywords).toEqual(['登录'])
  })

  it('卡片块带上观察者给的 reason（分类凭据），空则是空串', () => {
    const input = buildDecisionInput(
      [
        makeCard({ id: 'c-1', origin: { reason: '模型在等你确认是否开始重构' } }),
        makeCard({ id: 'c-2' }),
      ],
      [],
      30,
    )
    const cards = JSON.parse(blockOf(input, 'cards')) as Array<Record<string, unknown>>
    expect(cards[0]?.reason).toBe('模型在等你确认是否开始重构')
    expect(cards[1]?.reason).toBe('')
  })

  it('有到点动作的卡把 action.input 带上（说明别重复安排）', () => {
    const input = buildDecisionInput(
      [makeCard({ action: { type: 'prompt', delayMs: 600000, input: '10 分钟后重试' } })],
      [],
      30,
    )
    const cards = JSON.parse(blockOf(input, 'cards')) as Array<Record<string, unknown>>
    expect(cards[0]?.action).toBe('10 分钟后重试')
  })

  it('outcome=reworked 的判例一条都不送进去', () => {
    const input = buildDecisionInput(
      [makeCard()],
      [
        makePrecedent({ id: 'P-good', outcome: 'valid' }),
        makePrecedent({ id: 'P-bad', outcome: 'reworked', note: '后来返工了' }),
        makePrecedent({ id: 'P-unknown', outcome: 'unknown' }),
      ],
      30,
    )
    expect(input).toContain('P-good')
    expect(input).toContain('P-unknown')
    expect(input).not.toContain('P-bad')
    expect(input).not.toContain('后来返工了')
  })

  it('判例按时间倒序，并按 limit 截断', () => {
    const input = buildDecisionInput(
      [makeCard()],
      [
        makePrecedent({ id: 'P-old', at: 100 }),
        makePrecedent({ id: 'P-new', at: 300 }),
        makePrecedent({ id: 'P-mid', at: 200 }),
      ],
      2,
    )
    const rows = JSON.parse(blockOf(input, 'precedents')) as Array<{ id: string }>
    expect(rows.map((row) => row.id)).toEqual(['P-new', 'P-mid'])
    expect(input).not.toContain('P-old')
  })

  it('limit=0 时一条判例都不带', () => {
    const input = buildDecisionInput([makeCard()], [makePrecedent({ id: 'P-only' })], 0)
    expect(JSON.parse(blockOf(input, 'precedents'))).toEqual([])
    expect(input).not.toContain('P-only')
  })

  it('超长按字节截断，不突破上限', () => {
    const cards = Array.from({ length: 6 }, (_, i) =>
      makeCard({ id: `c-${i}`, title: `卡 ${i}`, detail: 'x'.repeat(1500) }),
    )
    const precedents = Array.from({ length: 6 }, (_, i) =>
      makePrecedent({ id: `P-${i}`, at: i, question: 'y'.repeat(500) }),
    )
    const input = buildDecisionInput(cards, precedents, 30, 2000)
    expect(bytes(input)).toBeLessThanOrEqual(2000)
  })

  it('单个字段先截短：detail 最多 1000 字', () => {
    const input = buildDecisionInput([makeCard({ detail: 'd'.repeat(3000) })], [], 30)
    const cards = JSON.parse(blockOf(input, 'cards')) as Array<{ detail: string }>
    expect(cards[0]?.detail.length).toBe(1000)
    expect(bytes(input)).toBeLessThanOrEqual(DECISION_INPUT_MAX_BYTES)
  })
})

describe('决策输入：来源与能力', () => {
  it('带用户原话、来源卡、UI 卡和能力清单', () => {
    const card = makeCard({
      ask: 'permission',
      origin: {
        sessionId: 's-1',
        reason: '模型在等确认',
        userQuote: '先只做 P0-2，别碰 P1',
        sourceKind: 'card-answer',
        sourceCardId: 'c-old',
        uiCardId: 'c-ui',
        relatedCardIds: ['c-1', 'c-2'],
      },
    })
    const input = buildDecisionInput([card], [], 30)
    expect(input).toContain('先只做 P0-2，别碰 P1')
    expect(input).toContain('"sourceKind":"card-answer"')
    expect(input).toContain('"sourceCardId":"c-old"')
    expect(input).toContain('"uiCardId":"c-ui"')
    expect(input).toContain('<capabilities>')
    expect(input).toContain('cards.append')
  })
})
