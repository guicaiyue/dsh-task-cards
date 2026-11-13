// P2：默认答案 + 超时自动继续（askAutoContinue / askTimeoutMinutes / blocking 例外）。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sweepAskStore, sweepAutoContinue, timeoutMsOf } from '../../src/host/asks/auto-continue'
import { AskStore } from '../../src/host/asks/store'
import { DEFAULT_SETTINGS } from '../../src/host/cards/defaults'
import { Store } from '../../src/host/cards/store'
import { sweepBlockedAsks } from '../../src/host/kernel/blocked-asks'
import type { Card, Settings } from '../../src/shared/contract'

const NOW = 2_000_000_000
const MIN = 60_000

function setup(over: Partial<Settings> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-auto-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const delivered: Array<{ id: string; text: string }> = []
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    askAutoContinue: true,
    askTimeoutMinutes: 10,
    ...over,
  }
  const sweep = () =>
    sweepAutoContinue({
      cards,
      settings: () => settings,
      log: () => undefined,
      deliver: async (card, text) => {
        delivered.push({ id: card.id, text })
      },
      now: () => NOW,
    })
  return { cards, settings, sweep, delivered }
}

async function ask(cards: Store, over: Partial<Card> = {}): Promise<Card> {
  const created = await cards.create('用哪个版本号？', {
    kind: 'decision',
    origin: { sessionId: 's-1' },
  })
  await cards.patch(created.id, { createdAt: NOW - 11 * MIN, status: 'open', ...over }, 'test')
  return cards.find(created.id) as Card
}

describe('超时自动继续', () => {
  it('11 分钟未答 → 按 defaultAnswer 继续：投递 + 事件 + 卡标记 auto', async () => {
    const env = setup()
    const card = await ask(env.cards, { defaultAnswer: '沿用 0.1.x' })
    expect(await env.sweep()).toBe(1)
    expect(env.delivered).toEqual([{ id: card.id, text: '沿用 0.1.x' }])
    const after = env.cards.find(card.id) as Card
    expect(after.answer).toBe('沿用 0.1.x')
    expect(after.answeredVia).toBe('auto')
    expect(after.status).toBe('done')
    const event = after.events.filter((item) => item.type === 'ask:auto-continued').pop()
    expect(event?.meta?.timeoutMs).toBe(10 * MIN)
    expect(event?.meta?.defaultAnswer).toBe('沿用 0.1.x')
    expect(event?.meta?.answer).toBe('沿用 0.1.x')
    expect(event?.meta?.auto).toBe(true)
    // 幂等：再扫不重复投递
    expect(await env.sweep()).toBe(0)
    expect(env.delivered).toHaveLength(1)
  })

  it('blocking=true 不自动继续；askAutoContinue=false 也不继续', async () => {
    const blocked = setup()
    const card = await ask(blocked.cards, { defaultAnswer: '继续', blocking: true })
    expect(await blocked.sweep()).toBe(0)
    expect(blocked.cards.find(card.id)?.answer).toBeUndefined()

    const off = setup({ askAutoContinue: false })
    const card2 = await ask(off.cards, { defaultAnswer: '继续' })
    expect(await off.sweep()).toBe(0)
    expect(off.cards.find(card2.id)?.answer).toBeUndefined()
    expect(timeoutMsOf(off.settings)).toBe(10 * MIN)
  })

  it('未到 10 分钟不继续（9 分钟边界）', async () => {
    const env = setup()
    const created = await env.cards.create('还在等', {
      kind: 'decision',
      origin: { sessionId: 's-1' },
    })
    await env.cards.patch(
      created.id,
      { createdAt: NOW - 9 * MIN, status: 'open', defaultAnswer: 'x' },
      't',
    )
    expect(await env.sweep()).toBe(0)
  })

  it('自动继续后阻塞扫描写 ask:unblocked（meta.auto=true）', async () => {
    const env = setup()
    const card = await ask(env.cards, { defaultAnswer: '沿用 0.1.x' })
    // 先造一条 blocked 事件，模拟此前已阻塞
    await env.cards.patch(card.id, {}, { type: 'ask:blocked', meta: { minutes: 11 } })
    await env.sweep()
    await sweepBlockedAsks({
      cards: env.cards,
      settings: () => env.settings,
      log: () => undefined,
      now: () => NOW,
    })
    const unblocked = (env.cards.find(card.id) as Card).events
      .filter((item) => item.type === 'ask:unblocked')
      .pop()
    expect(unblocked?.meta?.auto).toBe(true)
  })
})

describe('ask 通道超时继续', () => {
  it('非 blocking 超时自动答；blocking 不动', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-asks-'))
    const asks = new AskStore(path.join(dir, 'asks.json'))
    const { ask: a1 } = await asks.create({
      goalId: 'g',
      sessionId: 's',
      question: 'q1',
      defaultAnswer: '按默认',
      blocking: false,
      reason: '',
      effect: 'write-code',
      beforeRef: '',
      policyVersion: 1,
    })
    const { ask: a2 } = await asks.create({
      goalId: 'g',
      sessionId: 's',
      question: 'q2',
      defaultAnswer: '不动',
      blocking: true,
      reason: '',
      effect: 'destructive',
      beforeRef: '',
      policyVersion: 1,
    })
    const settings = { ...DEFAULT_SETTINGS, askAutoContinue: true, askTimeoutMinutes: 10 }
    const audited: string[] = []
    const count = await sweepAskStore({
      asks,
      settings: () => settings,
      log: () => undefined,
      audit: (id) => audited.push(id),
      now: () => Date.now() + 11 * MIN,
    })
    expect(count).toBe(1)
    expect(audited).toEqual([a1.id])
    const list = asks.list()
    expect(list.find((ask) => ask.id === a1.id)?.autoContinued).toBe(true)
    expect(list.find((ask) => ask.id === a2.id)?.answeredAt).toBeUndefined()
    expect(asks.open().map((ask) => ask.id)).toEqual([a2.id])
  })
})
