import { describe, expect, it } from 'vitest'

import { clarificationAnswer, permissionAnswer } from '../../src/host/decision/templates'
import type { Advice, Card } from '../../src/shared/contract'

function card(action: string, scope: string): Card {
  const value: Advice = {
    verdict: 'approve',
    summary: '',
    options: [],
    basis: '',
    precedentIds: [],
    chosen: 0,
    autoApply: false,
    confidence: 'normal',
    question: '',
    lane: 'decision',
    ask: 'permission',
    effect: 'write-code',
    requires: ['session.reply'],
    action,
    scope,
    reversible: true,
    candidates: [],
    blockedReasons: [],
    applied: false,
    at: 1,
  }
  return {
    id: 'c-1',
    title: '提交改动',
    detail: '',
    kind: 'decision',
    severity: 'normal',
    status: 'open',
    action: null,
    dueAt: null,
    source: 'agent',
    interaction: 'reply',
    question: null,
    ask: 'permission',
    origin: { sessionId: 's-1', reason: '' },
    advice: value,
    silent: false,
    createdAt: 1,
    updatedAt: 1,
    events: [],
  }
}

describe('固定答复模板', () => {
  it('许可 allow / deny 都带动作和范围，能独立成立', () => {
    const value = card('git commit', 'dsh-task-cards/**')
    expect(permissionAnswer(value, true)).toContain('已允许：git commit')
    expect(permissionAnswer(value, true)).toContain('范围：dsh-task-cards/**')
    expect(permissionAnswer(value, false)).toContain('不允许：git commit')
  })

  it('澄清答复带原问题和补充值', () => {
    expect(clarificationAnswer('是哪张卡？', 'c-1')).toBe(
      '补充信息：c-1。这是对「是哪张卡？」的回答，继续。',
    )
  })
})
