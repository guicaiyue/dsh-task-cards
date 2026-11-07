import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '../../src/host/cards/defaults'
import { Store } from '../../src/host/cards/store'
import { markRecentInfoCardsSeen, RECENT_SEEN_MS, SeenTracker } from '../../src/host/observer/seen'
import { createHandlers } from '../../src/host/observer/trigger'

function tempStore(): Store {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-seen-'))
  return new Store(path.join(dir, 'cards.json'))
}

describe('用户晚到时的补标已读', () => {
  it('把该会话最近落盘、仍 open 的 info 卡补成 silent', async () => {
    const cards = tempStore()
    const info = await cards.create('根分区使用率达 89%', {
      kind: 'info',
      origin: { sessionId: 's-1', reason: '' },
    })
    expect(info.silent).toBe(false)
    expect(info.status).toBe('open')

    const n = await markRecentInfoCardsSeen(cards, 's-1')
    expect(n).toBe(1)
    const after = cards.find(info.id)
    expect(after?.silent).toBe(true)
    expect(after?.status).toBe('acknowledged')
    expect(after?.events.at(-1)).toMatchObject({ type: 'acknowledged', via: 'silent' })
  })

  it('trigger 收到 human user/message 时会补标', async () => {
    const cards = tempStore()
    const info = await cards.create('刚落的通知', {
      kind: 'info',
      origin: { sessionId: 's-1', reason: '' },
    })
    const handlers = createHandlers({
      observer: {
        waiter: { cancel: () => {} },
        enqueue: async (job: () => Promise<unknown>) => job(),
        run: async () => null,
      } as never,
      settings: () => DEFAULT_SETTINGS,
      log: () => {},
      captureQuestion: async () => {},
      tracker: new Map(),
      seen: new SeenTracker(),
      cards,
    })
    handlers.onSessionEvent(
      { id: 's-1', header: {} },
      {
        type: 'user/message',
        time: Date.now(),
        data: { content: [{ type: 'text', text: '收到' }], source: { kind: 'user' } },
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(cards.find(info.id)?.silent).toBe(true)
    expect(cards.find(info.id)?.status).toBe('acknowledged')
  })

  it('不碰别的会话、决策卡、已完成卡和过老的卡', async () => {
    const cards = tempStore()
    const other = await cards.create('别的会话', {
      kind: 'info',
      origin: { sessionId: 's-2', reason: '' },
    })
    const decision = await cards.create('决策卡', {
      kind: 'decision',
      origin: { sessionId: 's-1', reason: '' },
    })
    const done = await cards.create('已完成通知', {
      kind: 'info',
      origin: { sessionId: 's-1', reason: '' },
    })
    await cards.patch(done.id, { status: 'done' })
    const old = await cards.create('很久以前的通知', {
      kind: 'info',
      origin: { sessionId: 's-1', reason: '' },
    })
    await cards.patch(old.id, { createdAt: Date.now() - RECENT_SEEN_MS - 1 })

    expect(await markRecentInfoCardsSeen(cards, 's-1')).toBe(0)
    expect(cards.find(other.id)?.status).toBe('open')
    expect(cards.find(decision.id)?.status).toBe('open')
    expect(cards.find(done.id)?.status).toBe('done')
    expect(cards.find(old.id)?.silent).toBe(false)
  })
})
