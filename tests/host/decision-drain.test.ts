// 决策排水（水平触发）：无票拟的 pending_secretary 卡在 tick 后进入决策队列。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/host/cards/defaults'
import { Store } from '../../src/host/cards/store'
import { drainPendingDecisions } from '../../src/host/decision/drain'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-drain-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const queued: string[][] = []
  const logs: string[] = []
  const settings = { ...DEFAULT_SETTINGS, autoDecide: true }
  const drain = (now = Date.now()) =>
    drainPendingDecisions({
      cards,
      enqueue: (list) => queued.push(list.map((card) => card.id)),
      settings: () => settings,
      log: (line: string) => logs.push(line),
      now: () => now,
    })
  return { cards, queued, logs, settings, drain }
}

describe('决策排水', () => {
  it('无票拟卡进决策队列；notice/已有票拟的卡不排', async () => {
    const { cards, queued, drain } = setup()
    const pending = await cards.create('待票拟', { kind: 'decision' })
    await cards.create('通知卡', { kind: 'info' })
    const advised = await cards.create('已有票拟', { kind: 'decision' })
    await cards.patch(
      advised.id,
      {
        advice: {
          verdict: 'approve',
          summary: '',
          options: [],
          basis: '',
          precedentIds: [],
          confidence: 'high',
          question: '',
          chosen: 0,
          autoApply: false,
          lane: 'decision',
          at: 1,
        } as never,
      },
      'test',
    )
    expect(drain()).toBe(1)
    expect(queued[0]).toEqual([pending.id])
  })

  it('重试上限 2 次 + 退避：连续 drain 不会无限打模型', async () => {
    const { cards, queued, drain } = setup()
    const card = await cards.create('一直失败的卡', { kind: 'decision' })
    const now = Date.now()
    const flush = () => new Promise((resolve) => setTimeout(resolve, 10))
    expect(drain(now)).toBe(1)
    await flush()
    expect(drain(now + 1000)).toBe(0)
    expect(drain(now + 6 * 60 * 1000)).toBe(1)
    await flush()
    expect(drain(now + 12 * 60 * 1000)).toBe(0)
    expect(queued).toEqual([[card.id], [card.id]])
  })

  it('Settings.autoDecide=false 时不排水', async () => {
    const { cards, queued, settings, drain } = setup()
    await cards.create('待票拟', { kind: 'decision' })
    settings.autoDecide = false
    expect(drain()).toBe(0)
    expect(queued).toHaveLength(0)
  })
})
