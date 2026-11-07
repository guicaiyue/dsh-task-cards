import { describe, expect, it } from 'vitest'
import type { AdviceDraft } from '../../src/host/decision/parse'
import { guardVagueReference, unresolvedCardReference } from '../../src/host/decision/reference'
import type { Card } from '../../src/shared/contract'

function card(title: string, detail = ''): Card {
  return {
    id: 'c-new',
    title,
    detail,
    kind: 'decision',
    severity: 'normal',
    status: 'open',
    action: null,
    dueAt: null,
    source: 'agent',
    interaction: 'reply',
    question: null,
    ask: 'judgment',
    origin: { sessionId: 's-1', reason: '' },
    advice: null,
    silent: false,
    createdAt: 1,
    updatedAt: 1,
    events: [],
  }
}

const draft: AdviceDraft = {
  cardId: 'c-new',
  verdict: 'approve',
  summary: '回填三张旧卡',
  options: [],
  basis: '',
  precedentIds: [],
  chosen: 0,
  autoApply: false,
  confidence: 'normal',
  question: '',
  lane: 'decision',
  ask: 'permission',
  applied: false,
}

describe('多卡指代的硬门禁', () => {
  it('卡里说「三张旧卡」但没有任何 id：不批准，转澄清', () => {
    const target = card('确认是否回填三张旧卡并重拟')
    expect(unresolvedCardReference(target)).toBe(true)
    const guarded = guardVagueReference(target, draft)
    expect(guarded.ask).toBe('clarification')
    expect(guarded.question).toContain('卡片 id')
    expect(guarded.blockedReasons).toContain('missing-card-ids')
    expect(guarded.autoApply).toBe(false)
  })

  it('卡里给出真实 id：不拦', () => {
    const target = card(
      '确认是否回填三张旧卡并重拟',
      '三张旧卡是 c-mw4s30ab-5hyxo、c-mw4sg1w9-f79be、c-mw4sg1wa-gx37q',
    )
    expect(unresolvedCardReference(target)).toBe(false)
    expect(guardVagueReference(target, draft)).toBe(draft)
  })
})
