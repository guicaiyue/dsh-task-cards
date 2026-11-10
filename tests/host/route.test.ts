// 阶段 B：授权路由三档穷举 + wait 结构闸门（服务端降级，不靠提示词）。

import { describe, expect, it } from 'vitest'
import { route, waitStructureOk } from '../../src/host/decision/route'
import { budgetPolicy } from './helpers/policy-fixture'

const baseAdvice = {
  verdict: 'approve' as const,
  effect: 'write-code' as const,
  confidence: 'high' as const,
  reversible: true,
  precedentIds: ['p-1'],
  basis: '同类判例 p-1 批过',
  question: '',
  options: [
    { name: '执行', cost: '', gain: '', worst: '', answer: '执行', verdict: 'approve' as const },
  ],
}

function card(over: Record<string, unknown> = {}) {
  return { kind: 'decision' as const, ask: 'judgment' as const, ...over }
}

describe('授权路由三档', () => {
  it('destructive / spend / external → user（危险特权，不可委派）', () => {
    for (const effect of ['destructive', 'spend', 'external'] as const) {
      const out = route({ card: card(), advice: { ...baseAdvice, effect }, policy: budgetPolicy() })
      expect(out.decider).toBe('user')
      expect(out.reason).toContain('danger-effect')
    }
  })

  it('effect=read → auto（不要求判例，§9.2）', () => {
    const out = route({
      card: card(),
      advice: { ...baseAdvice, effect: 'read', precedentIds: [] },
      policy: budgetPolicy(),
    })
    expect(out.decider).toBe('auto')
  })

  it('可逆 + 有判例 + 高置信 → secretary（delegated 档）', () => {
    const out = route({ card: card(), advice: baseAdvice, policy: budgetPolicy() })
    expect(out.decider).toBe('secretary')
    expect(out.threshold.length).toBeGreaterThan(0)
  })

  it('低置信 / 无判例（写入类）/ 不可逆 → user', () => {
    const low = route({
      card: card(),
      advice: { ...baseAdvice, confidenceScore: 0.6 },
      policy: budgetPolicy(),
    })
    expect(low.decider).toBe('user')
    expect(low.reason).toContain('low-confidence')

    const noPrecedent = route({
      card: card(),
      advice: { ...baseAdvice, precedentIds: [], confidenceScore: 0.7 },
      policy: budgetPolicy(),
    })
    expect(noPrecedent.decider).toBe('user')
    expect(noPrecedent.reason).toContain('no-precedent')

    const irreversible = route({
      card: card(),
      advice: { ...baseAdvice, reversible: false },
      policy: budgetPolicy(),
    })
    expect(irreversible.decider).toBe('user')
  })

  it('§12：无票拟 → 默认派秘书（不是 user 档）', () => {
    const out = route({ card: card(), policy: budgetPolicy() })
    expect(out.decider).toBe('secretary')
    expect(out.reason).toContain('pending_secretary')
  })

  it('§12：无判例按 effect/置信度分档——write-code ≥0.9 可 delegated，<0.9 → user', () => {
    const high = route({
      card: card(),
      advice: { ...baseAdvice, precedentIds: [], confidenceScore: 0.95 },
      policy: budgetPolicy(),
    })
    expect(high.decider).toBe('secretary')
    const low = route({
      card: card(),
      advice: { ...baseAdvice, precedentIds: [], confidenceScore: 0.7 },
      policy: budgetPolicy(),
    })
    expect(low.decider).toBe('user')
  })

  it('冲突票 → user；notice 卡不进决定状态机', () => {
    expect(
      route({ card: card(), advice: baseAdvice, policy: budgetPolicy(), conflict: true }).decider,
    ).toBe('user')
    expect(
      route({ card: { kind: 'info' as const, ask: 'judgment' as const }, policy: budgetPolicy() })
        .reason,
    ).toContain('notice')
  })
})

describe('wait 结构闸门（§10.2）', () => {
  it('wait 缺 question / reason / 选项 → 结构不合格', () => {
    expect(waitStructureOk({ ...baseAdvice, verdict: 'wait', question: '', basis: 'x' })).toBe(
      false,
    )
    expect(
      waitStructureOk({ ...baseAdvice, verdict: 'wait', question: '缺哪条事实？', basis: '' }),
    ).toBe(false)
    expect(
      waitStructureOk({
        ...baseAdvice,
        verdict: 'wait',
        question: '缺哪条事实？',
        basis: 'x',
        options: [],
      }),
    ).toBe(false)
  })

  it('wait 结构完整 → 仍可按 delegated 走；结构不全 → 服务端降级 escalate（user）', () => {
    const ok = route({
      card: card(),
      advice: { ...baseAdvice, verdict: 'wait', question: '缺部署窗口？', basis: '需要窗口' },
      policy: budgetPolicy(),
    })
    expect(ok.decider).toBe('secretary')

    const broken = route({
      card: card(),
      advice: { ...baseAdvice, verdict: 'wait', question: '', basis: '需要窗口' },
      policy: budgetPolicy(),
    })
    expect(broken.decider).toBe('user')
    expect(broken.reason).toContain('wait-structure-missing')
  })
})
