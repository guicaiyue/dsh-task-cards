import { describe, expect, it } from 'vitest'

import { parseAdvice } from '../../src/host/decision/parse'

const KNOWN = new Set(['c-1', 'c-2'])

function parse(raw: string) {
  return parseAdvice(raw, KNOWN)
}

describe('票拟解析', () => {
  it('容忍 markdown 代码块与前后废话', () => {
    const raw = [
      '好的，我看了这几张卡：',
      '```json',
      '{"decisions":[{"cardId":"c-1","verdict":"approve","summary":"先跑通最小验证"}]}',
      '```',
      '以上。',
    ].join('\n')
    const drafts = parse(raw)
    expect(drafts).toHaveLength(1)
    expect(drafts?.[0]).toMatchObject({
      cardId: 'c-1',
      verdict: 'approve',
      summary: '先跑通最小验证',
    })
  })

  it('未知 cardId 丢弃，重复的只留第一条，id 字段也认', () => {
    const raw = JSON.stringify({
      decisions: [
        { cardId: 'c-1', summary: '第一条' },
        { cardId: 'nope', summary: '不认识的卡' },
        { id: 'c-2', summary: '用 id 字段' },
        { cardId: 'c-1', summary: '重复的' },
      ],
    })
    const drafts = parse(raw)
    expect(drafts?.map((draft) => draft.cardId)).toEqual(['c-1', 'c-2'])
    expect(drafts?.[0]?.summary).toBe('第一条')
  })

  it('options 截到 3 条，没有名字的方案丢掉', () => {
    const raw = JSON.stringify({
      decisions: [
        {
          cardId: 'c-1',
          options: [
            {
              name: '先跑通',
              cost: '1 小时',
              gain: '少走 3 步',
              worst: '白做 1 小时',
              answer: '先跑通',
            },
            { name: '', cost: '没名字' },
            { name: '直接重构' },
            { name: '第四条' },
            { name: '第五条' },
          ],
        },
      ],
    })
    const drafts = parse(raw)
    expect(drafts?.[0]?.options.map((option) => option.name)).toEqual([
      '先跑通',
      '直接重构',
      '第四条',
    ])
    expect(drafts?.[0]?.options[0]).toMatchObject({
      cost: '1 小时',
      gain: '少走 3 步',
      worst: '白做 1 小时',
      answer: '先跑通',
      verdict: 'modify',
    })
  })

  it('缺字段按 schema 默认值补', () => {
    const drafts = parse(JSON.stringify({ decisions: [{ cardId: 'c-1' }] }))
    expect(drafts?.[0]).toMatchObject({
      verdict: 'wait',
      summary: '',
      options: [],
      basis: '',
      precedentIds: [],
      confidence: 'normal',
      question: '',
      lane: 'decision',
      applied: false,
    })
  })

  it('裸数组与单条对象都能救回来', () => {
    const fromArray = parse(JSON.stringify([{ cardId: 'c-1', summary: '数组里的' }]))
    expect(fromArray?.[0]?.summary).toBe('数组里的')
    const fromObject = parse(JSON.stringify({ cardId: 'c-2', summary: '单个对象' }))
    expect(fromObject?.[0]).toMatchObject({ cardId: 'c-2', summary: '单个对象' })
  })

  it('没有 decisions 数组或整段不是 JSON 时返回 null', () => {
    expect(parse('完全不 JSON')).toBeNull()
    expect(parse('{"foo":1}')).toBeNull()
    expect(parse('')).toBeNull()
  })

  it('空 decisions 返回空数组（不是失败）', () => {
    expect(parse('{"decisions":[]}')).toEqual([])
  })

  it('非法枚举值退回默认，precedentIds 截到 6 条', () => {
    const drafts = parse(
      JSON.stringify({
        decisions: [
          {
            cardId: 'c-1',
            verdict: 'maybe',
            confidence: 'sure',
            lane: 'later',
            precedentIds: ['P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'P-6', 'P-7', '', 42],
          },
        ],
      }),
    )
    expect(drafts?.[0]).toMatchObject({
      verdict: 'wait',
      confidence: 'normal',
      lane: 'decision',
      precedentIds: ['P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'P-6'],
    })
  })
})
