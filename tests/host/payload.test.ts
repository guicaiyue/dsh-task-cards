// 观察者输入构造：只读别人的回复，所以「送什么进去」必须可控、可测。

import { describe, expect, it } from 'vitest'

import { buildPayload, messageText, truncateBytes } from '../../src/host/observer/payload'
import { textOf } from '../../src/host/question/record'

describe('观察者输入', () => {
  it('取 assistant/message 里的纯文本块，忽略工具块', () => {
    expect(
      messageText({
        content: [
          { type: 'text', text: '第一段' },
          { type: 'tool_use', name: 'read_file' },
          { type: 'text', text: '第二段' },
        ],
      }),
    ).toBe('第一段\n第二段')
    expect(messageText({ content: [] })).toBe('')
    expect(messageText(null)).toBe('')
  })

  it('按字节截断，不切开多字节字符', () => {
    const text = '中文中文中文'
    const cut = truncateBytes(text, 7)
    expect(Buffer.byteLength(cut, 'utf8')).toBeLessThanOrEqual(7)
    expect(cut).not.toContain('\uFFFD')
  })

  it('按来源分节：人类轮次带「用户原话」标题，越靠后越新', () => {
    const turns = Array.from({ length: 3 }, (_, i) => ({
      provenance: 'human' as const,
      user: `问 ${i}`,
      assistant: `答 ${i}`,
    }))
    const payload = buildPayload(turns, '最终回复', 100000)
    expect(payload).toContain('【第 1 轮 · 用户原话】')
    expect(payload).toContain('【第 3 轮 · 用户原话】')
    expect(payload).toContain('问 2')
    expect(payload).not.toContain('问 -1')
  })

  it('系统代发标成「系统代发」，不写成用户', () => {
    const payload = buildPayload(
      [{ provenance: 'card-answer', user: '跑一次复现', cardId: 'c-1' }],
      '结果如下',
      100000,
    )
    expect(payload).toContain('系统代发（来源：任务卡 c-1）')
    expect(payload).toContain('系统：跑一次复现')
    expect(payload).not.toContain('用户：跑一次复现')
  })

  it('卡片答复触发时，trigger 标成系统代发，最后真人原话单独放', () => {
    const payload = buildPayload(
      [{ provenance: 'card-answer', user: '跑一次复现', cardId: 'c-1' }],
      '结果如下',
      100000,
      {
        triggerMessage: '跑一次复现',
        triggerUserMessage: '先只做 P0-2',
        triggerSourceKind: 'card-answer',
        triggerCardId: 'c-1',
      },
    )
    expect(payload).toContain('<trigger>')
    expect(payload).toContain('本轮由系统代发（来源：任务卡 c-1）触发：')
    expect(payload).toContain('跑一次复现')
    expect(payload).toContain('<last_user_quote>')
    expect(payload).toContain('用户最近一次原话')
    expect(payload).toContain('先只做 P0-2')
    expect(payload).not.toContain('用户在使用：')
  })

  it('没有轮次时退回「本轮模型最终输出」', () => {
    const payload = buildPayload([], '只有这一句', 100000)
    expect(payload).toContain('【本轮 · 模型最终输出】')
    expect(payload).toContain('只有这一句')
  })

  it('总量受 maxInputBytes 限制', () => {
    const turns = [{ user: 'x'.repeat(20000), assistant: 'y'.repeat(20000) }]
    const payload = buildPayload(turns, '', 4000)
    expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(4000)
  })

  it('user/message 的几种形状都能取到文本', () => {
    expect(textOf({ message: { content: [{ type: 'text', text: 'A' }] } })).toBe('A')
    expect(textOf({ content: [{ type: 'text', text: 'B' }] })).toBe('B')
    expect(textOf({ text: 'C' })).toBe('C')
    expect(textOf(undefined)).toBe('')
  })
})
