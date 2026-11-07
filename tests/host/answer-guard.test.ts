import { describe, expect, it } from 'vitest'
import {
  checkAnswer,
  manualBlockers,
  safeDiagnosticWrite,
} from '../../src/host/decision/answer-guard'
import { autoApplyAllowed } from '../../src/host/decision/autoapply'
import type { Advice, Card } from '../../src/shared/contract'

function advice(overrides: Partial<Advice> = {}): Advice {
  return {
    verdict: 'approve',
    summary: '先跑通',
    options: [],
    basis: '',
    precedentIds: [],
    chosen: 0,
    autoApply: true,
    confidence: 'normal',
    question: '',
    lane: 'decision',
    ask: 'judgment',
    effect: 'read',
    requires: ['session.reply'],
    action: '',
    scope: '',
    reversible: false,
    candidates: [],
    blockedReasons: [],
    applied: false,
    at: 1,
    ...overrides,
  }
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c-1',
    title: '要不要加缓存',
    detail: '',
    kind: 'decision',
    severity: 'normal',
    status: 'open',
    action: null,
    dueAt: null,
    source: 'agent',
    interaction: 'reply',
    question: null,
    ask: 'judgment',
    origin: { sessionId: 's-1', turn: 1, observerSessionId: 'o-1', reason: '' },
    advice: advice(),
    silent: false,
    createdAt: 1,
    updatedAt: 1,
    events: [],
    ...overrides,
  }
}

describe('自动执行闸门', () => {
  it('effect=read、能力支持、句子独立成立 → 放行', () => {
    expect(checkAnswer(card(), '先跑通最小验证再谈重构')).toEqual({ ok: true, reasons: [] })
  })

  it('effect != read → 拦', () => {
    expect(
      checkAnswer(card({ advice: advice({ effect: 'write-code' }) }), '提交 16 个文件'),
    ).toMatchObject({
      ok: false,
    })
    expect(
      checkAnswer(card({ advice: advice({ effect: 'write-code' }) }), '提交 16 个文件').reasons,
    ).toContain('effect:write-code')
  })

  it('可逆的诊断性 write-code 自动放行；commit 之类的仍拦', () => {
    const diagnostic = advice({
      effect: 'write-code',
      reversible: true,
      action: '加一行临时日志后复测，跑完移除',
      scope: '仅日志插桩，不改判定逻辑',
    })
    expect(safeDiagnosticWrite(diagnostic)).toBe(true)
    expect(checkAnswer(card({ advice: diagnostic }), '已允许：加日志后复测')).toEqual({
      ok: true,
      reasons: [],
    })

    const commit = advice({
      effect: 'write-code',
      reversible: true,
      action: 'git commit 22 个文件',
      scope: 'workspace',
    })
    expect(safeDiagnosticWrite(commit)).toBe(false)
    expect(checkAnswer(card({ advice: commit }), '已允许：git commit 22 个文件').ok).toBe(false)
  })

  it('独立诊断开关只放行诊断类，通用开关仍放行全部', () => {
    const diagnostic = advice({
      effect: 'write-code',
      reversible: true,
      action: '加临时日志后复测',
      scope: '仅日志',
      ask: 'permission',
    })
    expect(autoApplyAllowed(diagnostic, false, true)).toBe(true)
    expect(autoApplyAllowed(diagnostic, false, false)).toBe(false)
    expect(autoApplyAllowed(diagnostic, true, false)).toBe(true)

    const commit = advice({
      effect: 'write-code',
      reversible: true,
      action: 'git commit 22 个文件',
      scope: 'workspace',
      ask: 'permission',
    })
    expect(autoApplyAllowed(commit, false, true)).toBe(false)
  })

  it('缺能力 → 拦', () => {
    const result = checkAnswer(
      card({ advice: advice({ requires: ['cards.append'] }) }),
      '把结果贴回卡片 c-1',
    )
    expect(result.reasons).toContain('missing-capability:cards.append')
  })

  it('没有目标指代 → 拦；带卡片 id/标题 → 放行', () => {
    expect(checkAnswer(card(), '贴回这张卡').reasons).toContain('deictic-without-target')
    expect(checkAnswer(card(), '贴回卡片 c-1').ok).toBe(true)
  })

  it('人工批准只拦不存在的能力，不拦指代', () => {
    expect(manualBlockers(card(), '贴回这张卡')).toEqual([])
    expect(
      manualBlockers(card({ advice: advice({ requires: ['cards.append'] }) }), '贴回这张卡'),
    ).toEqual(['missing-capability:cards.append'])
  })
})
