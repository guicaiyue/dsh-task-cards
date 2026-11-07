import { describe, expect, it } from 'vitest'

import { provenanceOf } from '../../src/host/observer/provenance'

describe('消息来源判定', () => {
  it('普通用户消息是 human', () => {
    const result = provenanceOf({
      source: { kind: 'user', rpcId: 'rpc-1' },
      content: [{ type: 'text', text: '继续' }],
    })
    expect(result).toEqual({ kind: 'human', cardId: '' })
  })

  it('time-context 心跳是 system，不占用户轮次', () => {
    const result = provenanceOf({
      source: { kind: 'time-context', form: 'snapshot' },
      content: [{ type: 'text', text: 'Time sampled…' }],
    })
    expect(result.kind).toBe('system')
  })

  it('card-answer 的 rpcId 能识别，并从文本标记取卡片 id', () => {
    const result = provenanceOf({
      source: { kind: 'user', rpcId: 'card-answer-mw4s44xw' },
      content: [{ type: 'text', text: '〔任务卡答复 c-abc「要不要再跑一次」〕\n跑一次' }],
    })
    expect(result).toEqual({ kind: 'card-answer', cardId: 'c-abc' })
  })

  it('没有 rpcId 时用文本标记兜底', () => {
    const result = provenanceOf({
      content: [{ type: 'text', text: '〔任务卡答复 c-xyz「标题」〕\n允许' }],
    })
    expect(result).toEqual({ kind: 'card-answer', cardId: 'c-xyz' })
  })

  it('其它 source.kind 一律 system', () => {
    expect(provenanceOf({ source: { kind: 'subagent' } }).kind).toBe('system')
  })
})
