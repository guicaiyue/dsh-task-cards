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

  it('最多带三轮「用户 + 模型」，越靠后越新', () => {
    const turns = Array.from({ length: 5 }, (_, i) => ({ user: `问 ${i}`, assistant: `答 ${i}` }))
    const payload = buildPayload(turns, '最终回复', 100000)
    expect(payload).toContain('【第 1 轮】')
    expect(payload).toContain('【第 5 轮】')
    expect(payload).toContain('问 4')
    expect(payload).not.toContain('问 -1')
  })

  it('没有轮次时退回「最后一轮」', () => {
    const payload = buildPayload([], '只有这一句', 100000)
    expect(payload).toContain('【最后一轮】')
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
