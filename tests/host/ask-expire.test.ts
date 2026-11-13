// blocking 提问没人来答（会话常常已经结束）时按默认答案收尾。
//
// 真实现象（2026-11-12）：asks.json 里 3 条 blocking 提问来自已结束的会话，
// 没有任何东西会推进它们；面板要人一直在浏览器前才有机会答。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { expireBlockingAsks, STALE_BLOCKING_MS } from '../../src/host/asks/auto-continue'
import { AskStore } from '../../src/host/asks/store'
import { DEFAULT_SETTINGS } from '../../src/host/cards/defaults'

const NOW = 3_000_000_000_000

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-ask-expire-'))
  return { dir, asks: new AskStore(path.join(dir, 'asks.json')) }
}

const base = {
  goalId: '',
  sessionId: 'session-dead',
  defaultAnswer: '不执行（保持现状）',
  blocking: true,
  reason: 'prod-db',
  effect: 'destructive' as const,
  beforeRef: '',
  policyVersion: 1,
}

const logs: string[] = []
const log = (line: string) => void logs.push(line)

describe('blocking ask 过期收尾', () => {
  it('超过 6 小时未答 → 按默认答案收尾并写审计', async () => {
    const { asks } = setup()
    const { ask } = await asks.create({ ...base, key: 'k1', question: '要删生产表？' })
    const audited: Array<{ id: string; waited: number; answer: string }> = []
    const count = await expireBlockingAsks({
      asks,
      settings: () => DEFAULT_SETTINGS,
      log,
      now: () => ask.createdAt + STALE_BLOCKING_MS + 1,
      audit: (id, waited, answer) => audited.push({ id, waited, answer }),
    })
    expect(count).toBe(1)
    expect(asks.open()).toHaveLength(0)
    expect(audited[0]?.id).toBe(ask.id)
    expect(audited[0]?.answer).toBe('不执行（保持现状）')
    expect(asks.list()[0]?.answer).toBe('不执行（保持现状）')
  })

  it('没到 6 小时不动它（人可能还在路上）', async () => {
    const { asks } = setup()
    const { ask } = await asks.create({ ...base, key: 'k2', question: '要删生产表？' })
    const count = await expireBlockingAsks({
      asks,
      settings: () => DEFAULT_SETTINGS,
      log,
      now: () => ask.createdAt + STALE_BLOCKING_MS - 60_000,
    })
    expect(count).toBe(0)
    expect(asks.open()).toHaveLength(1)
  })

  it('非 blocking 的由既有超时通道处理，这里不抢', async () => {
    const { asks } = setup()
    const { ask } = await asks.create({ ...base, key: 'k3', blocking: false, question: '小事' })
    const count = await expireBlockingAsks({
      asks,
      settings: () => DEFAULT_SETTINGS,
      log,
      now: () => ask.createdAt + STALE_BLOCKING_MS + 1,
    })
    expect(count).toBe(0)
    expect(asks.open()).toHaveLength(1)
  })

  it('关掉自动继续时不收尾（人明确要求不要替他答）', async () => {
    const { asks } = setup()
    const { ask } = await asks.create({ ...base, key: 'k4', question: '要删生产表？' })
    const count = await expireBlockingAsks({
      asks,
      settings: () => ({ ...DEFAULT_SETTINGS, askAutoContinue: false }),
      log,
      now: () => ask.createdAt + STALE_BLOCKING_MS + 1,
    })
    expect(count).toBe(0)
    expect(asks.open()).toHaveLength(1)
  })

  it('已经答过的不会再被收尾一次', async () => {
    const { asks } = setup()
    const { ask } = await asks.create({ ...base, key: 'k5', question: '要删生产表？' })
    await asks.answer(ask.id, '人工答过了')
    const count = await expireBlockingAsks({
      asks,
      settings: () => DEFAULT_SETTINGS,
      log,
      now: () => ask.createdAt + STALE_BLOCKING_MS + 1,
    })
    expect(count).toBe(0)
    expect(asks.list()[0]?.answer).toBe('人工答过了')
  })
})
