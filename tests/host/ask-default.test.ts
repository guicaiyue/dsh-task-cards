// 默认答案必须站在「不执行」那一边，尤其是 destructive / spend。
//
// 真实账本（2026-11-11）：两条 `rule:destructive-sql` 的 ask 拿到的默认答案是
// 「按最小改动继续」——因为旧判据只认 `/prod-db|spend|.../` 这几个字面量，
// 而「删数据的 SQL」的判据文字是 `destructive-sql`，没命中。过期收尾（6h）时
// 这条默认答案等于放行一次删库。

import { describe, expect, it } from 'vitest'
import { createAskFor } from '../../src/host/gate/autonomy-hooks'
import type { GateDecision } from '../../src/host/gate/classify'
import type { Inspection } from '../../src/host/gate/hooks'

const decision = (over: Partial<GateDecision>): GateDecision => ({
  gate: true,
  effect: 'write-code',
  target: 'x',
  reasons: ['rule:x'],
  argHash: 'h',
  identity: 'i',
  ...over,
})

const inspect = (d: GateDecision): Inspection => ({
  decision: d,
  key: 'k1',
  sessionId: 's1',
  toolName: 'bash',
  existing: null,
})

function askOf(d: GateDecision) {
  const seen: Array<Record<string, unknown>> = []
  createAskFor(
    {
      settings: () => ({ turnGate: 'high-risk', autonomyMode: 'auto' }),
      createAsk: (e) => void seen.push(e as never),
    },
    inspect(d),
  )
  return seen[0] as { defaultAnswer: string; blocking: boolean; key: string }
}

describe('ask 默认答案', () => {
  it('destructive 效果 → 默认不执行，且阻塞等答', () => {
    const ask = askOf(decision({ effect: 'destructive', reasons: ['rule:rm-outside'] }))
    expect(ask.defaultAnswer).toBe('不执行（保持现状）')
    expect(ask.blocking).toBe(true)
  })

  it('destructive-sql 判据 + write-code 效果 → 仍默认不执行（旧代码在这里放行）', () => {
    const ask = askOf(
      decision({ effect: 'write-code', reasons: ['rule:destructive-sql', 'seg#3'] }),
    )
    expect(ask.defaultAnswer).toBe('不执行（保持现状）')
  })

  it('花钱 → 默认不执行', () => {
    expect(askOf(decision({ effect: 'spend', reasons: ['rule:spend'] })).defaultAnswer).toBe(
      '不执行（保持现状）',
    )
  })

  it('普通仓内改写 → 默认按最小改动继续（不阻塞）', () => {
    const ask = askOf(decision({ effect: 'write-code', reasons: ['rule:write-outside'] }))
    expect(ask.defaultAnswer).toBe('按最小改动继续')
    expect(ask.blocking).toBe(false)
  })

  it('去重键带上会话，同一次判定在两条回调之间可复用', () => {
    expect(askOf(decision({ effect: 'write-code' })).key).toBe('s1:k1')
  })
})
