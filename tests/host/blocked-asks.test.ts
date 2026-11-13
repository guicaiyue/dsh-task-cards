// 阻塞提醒（task-10）：10m 阈值 / ask:blocked 事件带时长 / KPI / off 不提醒。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/host/cards/defaults'
import { Store } from '../../src/host/cards/store'
import { sweepBlockedAsks } from '../../src/host/kernel/blocked-asks'
import type { Card } from '../../src/shared/contract'
import { ASK_BLOCK_THRESHOLD_MS, blockedAsksOf, isBlockedAsk } from '../../src/shared/state'

function setup(askTimeoutAction: 'off' | 'notify' | 'suggest' = 'off') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-blocked-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const logs: string[] = []
  const settings = { ...DEFAULT_SETTINGS, askTimeoutAction }
  const sweep = (now: number) =>
    sweepBlockedAsks({
      cards,
      settings: () => settings,
      log: (line: string) => logs.push(line),
      now: () => now,
    })
  return { cards, logs, sweep }
}

async function askCard(cards: Store, minutes: number, sessionId = 's-1'): Promise<Card> {
  const created = await cards.create('版本号用哪个？', {
    kind: 'decision',
    origin: { sessionId },
  })
  await cards.patch(created.id, { createdAt: 1_000_000, status: 'open' }, 'test')
  return cards.find(created.id) as Card
}

const NOW = 1_000_000

describe('阻塞判定边界', () => {
  it('9 分钟不算、10 分钟算、11 分钟也算', async () => {
    const { cards } = setup()
    const card = await askCard(cards, 0)
    const at = (minutes: number) => NOW + minutes * 60_000
    expect(isBlockedAsk(card as never, at(9))).toBe(false)
    expect(isBlockedAsk(card as never, at(10))).toBe(true)
    expect(isBlockedAsk(card as never, at(11))).toBe(true)
    expect(ASK_BLOCK_THRESHOLD_MS).toBe(10 * 60_000)
  })
})

describe('阻塞扫描', () => {
  it('超 10 分钟：写 ask:blocked 事件（带时长/会话）、severity=high、KPI 命中', async () => {
    const { cards, sweep } = setup()
    const card = await askCard(cards, 0)
    expect(await sweep(NOW + 11 * 60_000)).toBe(1)
    const after = cards.find(card.id) as Card
    const event = after.events.filter((item) => item.type === 'ask:blocked').pop()
    expect(event?.meta?.minutes).toBe(11)
    expect(event?.meta?.sessionId).toBe('s-1')
    expect(after.severity).toBe('high')
    const kpi = blockedAsksOf([after as never], NOW + 11 * 60_000)
    expect(kpi.count).toBe(1)
    expect(kpi.maxMs).toBeGreaterThanOrEqual(11 * 60_000)
    // 幂等：再扫不会重复写
    expect(await sweep(NOW + 12 * 60_000)).toBe(1)
    expect(
      (cards.find(card.id) as Card).events.filter((item) => item.type === 'ask:blocked'),
    ).toHaveLength(1)
  })

  it('答完之后写 ask:unblocked（带时长）', async () => {
    const { cards, sweep } = setup()
    const card = await askCard(cards, 0)
    await sweep(NOW + 11 * 60_000)
    await cards.patch(card.id, { answer: '用 1.2.3', status: 'done' }, 'answered')
    await sweep(NOW + 12 * 60_000)
    const after = cards.find(card.id) as Card
    const unblocked = after.events.filter((item) => item.type === 'ask:unblocked').pop()
    expect(unblocked).toBeTruthy()
    expect(unblocked?.meta?.durationMs).toBeGreaterThan(0)
  })

  it('askTimeoutAction=off 仍记录事件/KPI（检测不失效），但不写提醒日志', async () => {
    const { cards, logs, sweep } = setup('off')
    const card = await askCard(cards, 0)
    await sweep(NOW + 31 * 60_000)
    expect((cards.find(card.id) as Card).events.some((e) => e.type === 'ask:blocked')).toBe(true)
    expect(logs).toHaveLength(0)
  })

  it('notify：写提醒日志；suggest 30 分钟后日志带建议', async () => {
    const notify = setup('notify')
    const card = await askCard(notify.cards, 0)
    await notify.sweep(NOW + 11 * 60_000)
    expect(notify.logs.some((line) => line.includes('阻塞提醒'))).toBe(true)
    expect(card.id).toBeTruthy()

    const suggest = setup('suggest')
    const card2 = await askCard(suggest.cards, 0)
    await suggest.sweep(NOW + 31 * 60_000)
    expect(suggest.logs.some((line) => line.includes('阻塞提醒') && line.includes('建议'))).toBe(
      true,
    )
    expect(card2.id).toBeTruthy()
  })
})
