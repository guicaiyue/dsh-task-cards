import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Store } from '../../src/host/cards/store'
import { applyAdvice, laneCorrection } from '../../src/host/decision/apply'
import type { AdviceDraft } from '../../src/host/decision/parse'
import type { Card } from '../../src/shared/contract'

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-apply-'))
  return path.join(dir, 'cards.json')
}

function makeDraft(overrides: Partial<AdviceDraft> = {}): AdviceDraft {
  const base: AdviceDraft = {
    cardId: 'c-1',
    verdict: 'approve',
    summary: '先跑通最小验证',
    options: [],
    basis: '无同类判例',
    precedentIds: [],
    chosen: 0,
    autoApply: false,
    confidence: 'normal',
    question: '',
    lane: 'decision',
    applied: false,
  }
  return Object.assign(base, overrides)
}

describe('票拟写回', () => {
  it('decision 卡被纠正成 info：applied=true，两条事件都在卡上', async () => {
    const store = new Store(tempFile())
    const card = await store.create('只是通知我一下', { kind: 'decision' })
    const draft = makeDraft({ cardId: card.id, lane: 'info', summary: '这是事实，不用你拍板' })

    const result = await applyAdvice(store, card, draft)
    expect(result.corrected).toBe(true)
    expect(result.card.kind).toBe('info')
    expect(result.card.advice?.applied).toBe(true)
    expect(result.card.advice?.lane).toBe('info')
    expect(result.card.advice?.at).toBeTypeOf('number')
    expect(result.card.events.map((event) => event.type)).toEqual([
      'created',
      'lane:info',
      'advised',
    ])
  })

  it('info/auto 想升成 decision 不落盘，只在票拟里说明', async () => {
    const store = new Store(tempFile())
    const card = await store.create('也许要我拍板', { kind: 'info' })
    const draft = makeDraft({ cardId: card.id, lane: 'decision', summary: '其实得你定' })

    const result = await applyAdvice(store, card, draft)
    expect(result.corrected).toBe(false)
    expect(result.card.kind).toBe('info')
    expect(result.card.advice?.lane).toBe('decision')
    expect(result.card.advice?.applied).toBe(false)
    expect(result.card.events.map((event) => event.type)).toEqual(['created', 'advised'])
  })

  it('车道一致时不纠正也不标 applied', async () => {
    const store = new Store(tempFile())
    const card = await store.create('删库吗', { kind: 'decision' })
    const result = await applyAdvice(store, card, makeDraft({ cardId: card.id, lane: 'decision' }))
    expect(result.corrected).toBe(false)
    expect(result.card.advice?.applied).toBe(false)
    expect(result.card.kind).toBe('decision')
  })

  it('绝不执行 action：自动卡的排期与动作原样保留', async () => {
    const store = new Store(tempFile())
    const card = await store.create('限流重试', {
      kind: 'auto',
      action: { type: 'prompt', delayMs: 600000, input: '10 分钟后重试' },
      origin: { sessionId: 'session-a' },
    })
    const before = { status: card.status, action: card.action, dueAt: card.dueAt }
    const result = await applyAdvice(store, card, makeDraft({ cardId: card.id, lane: 'auto' }))
    expect(result.card.status).toBe(before.status)
    expect(result.card.action).toEqual(before.action)
    expect(result.card.dueAt).toBe(before.dueAt)
    expect(result.card.executedAt).toBeUndefined()
  })

  it('laneCorrection 只认 decision → info', () => {
    const decisionCard = { kind: 'decision' } as Card
    const infoCard = { kind: 'info' } as Card
    const autoCard = { kind: 'auto' } as Card
    expect(laneCorrection(decisionCard, makeDraft({ lane: 'info' }))).toBe('info')
    expect(laneCorrection(decisionCard, makeDraft({ lane: 'decision' }))).toBeNull()
    expect(laneCorrection(decisionCard, makeDraft({ lane: 'auto' }))).toBeNull()
    expect(laneCorrection(infoCard, makeDraft({ lane: 'info' }))).toBeNull()
    expect(laneCorrection(infoCard, makeDraft({ lane: 'decision' }))).toBeNull()
    expect(laneCorrection(autoCard, makeDraft({ lane: 'info' }))).toBeNull()
  })

  it('卡不存在时抛 NOT_FOUND', async () => {
    const store = new Store(tempFile())
    const card = await store.create('会被删掉', { kind: 'decision' })
    await store.remove(card.id)
    await expect(applyAdvice(store, card, makeDraft({ cardId: card.id }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})
