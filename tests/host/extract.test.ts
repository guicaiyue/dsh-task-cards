import { describe, expect, it } from 'vitest'

import { coerceCards, extractJson } from '../../src/host/observer/extract'

describe('从模型输出里抠 JSON', () => {
  it('整段就是 JSON', () => {
    const result = extractJson('{"cards":[{"title":"跑测试"}]}')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ cards: [{ title: '跑测试' }] })
  })

  it('包在 markdown 代码块里', () => {
    const result = extractJson('```json\n{"cards":[{"title":"补空态"}]}\n```')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.via).toBe('fence')
      expect((result.value as { cards: Array<{ title: string }> }).cards[0]?.title).toBe('补空态')
    }
  })

  it('前后带解释文字', () => {
    const result = extractJson('好的，我判断如下：\n{"cards":[{"title":"删掉旧表"}]}\n以上。')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.via).toBe('bracket')
      expect((result.value as { cards: Array<{ title: string }> }).cards[0]?.title).toBe('删掉旧表')
    }
  })

  it('字符串里的花括号不打乱扫描', () => {
    const result = extractJson('{"cards":[{"title":"把 {x} 换成 {y}","detail":"a}b"}]}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.value as { cards: Array<{ title: string }> }).cards[0]?.title).toBe(
        '把 {x} 换成 {y}',
      )
    }
  })

  it('没有 JSON 时明确失败', () => {
    const result = extractJson('这次没有需要跟进的事。')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0)
  })

  it('空输出失败而不是当成空卡', () => {
    expect(extractJson('').ok).toBe(false)
    expect(extractJson('   ').ok).toBe(false)
  })
})

describe('把 JSON 收敛成卡片草稿', () => {
  it('接受 cards 数组、单对象、裸数组', () => {
    const a = coerceCards({ cards: [{ title: 'A', detail: 'a' }] })
    expect(a.ok).toBe(true)
    if (a.ok) {
      expect(a.cards[0]?.title).toBe('A')
      expect(a.cards[0]?.detail).toBe('a')
      expect(a.cards[0]?.kind).toBe('info')
    }
    const b = coerceCards({ title: 'B' })
    if (b.ok) expect(b.cards[0]?.title).toBe('B')
    const c = coerceCards([{ name: 'C' }])
    if (c.ok) expect(c.cards[0]?.title).toBe('C')
  })

  it('auto 卡必须带可执行动作，否则降级成 info', () => {
    const withAction = coerceCards({
      cards: [
        {
          title: '限流重试',
          kind: 'auto',
          action: { type: 'prompt', delayMs: 600000, input: '继续' },
        },
      ],
    })
    if (withAction.ok) {
      expect(withAction.cards[0]?.kind).toBe('auto')
      expect(withAction.cards[0]?.action?.delayMs).toBe(600000)
    }
    const noAction = coerceCards({ cards: [{ title: '没有动作', kind: 'auto' }] })
    if (noAction.ok) {
      expect(noAction.cards[0]?.kind).toBe('info')
      expect(noAction.cards[0]?.action).toBeNull()
    }
  })

  it('decision 卡保留 kind 与 severity', () => {
    const result = coerceCards({ cards: [{ title: '删表', kind: 'decision', severity: 'high' }] })
    if (result.ok) {
      expect(result.cards[0]?.kind).toBe('decision')
      expect(result.cards[0]?.severity).toBe('high')
    }
  })

  it('丢掉没有标题的行，形状不对就报错', () => {
    const result = coerceCards({ cards: [{ title: '  ' }, { title: '留下' }] })
    if (result.ok) {
      expect(result.cards).toHaveLength(1)
      expect(result.cards[0]?.title).toBe('留下')
    }
    expect(coerceCards({ foo: 1 }).ok).toBe(false)
  })

  it('动作延迟被夹到 0…24 小时', () => {
    const result = coerceCards({
      cards: [
        {
          title: '太久的重试',
          kind: 'auto',
          action: { type: 'prompt', delayMs: 10 ** 12, input: '继续' },
        },
      ],
    })
    if (result.ok) expect(result.cards[0]?.action?.delayMs).toBe(24 * 60 * 60 * 1000)
  })
})
