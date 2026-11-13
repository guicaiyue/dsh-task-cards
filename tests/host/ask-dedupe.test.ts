// 一次工具调用只该问一次：guard 与 pre-execute 是宿主的两条回调，都会判定同一次执行。
//
// 真实故障（2026-11-11 账本）：asks.json 里 6 条 ask 是 3 个问题的成对副本，
// 间隔 10–46 ms，同一会话同一命令。人会被问两遍，且两条都要各自等超时。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AskStore } from '../../src/host/asks/store'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-ask-dedupe-'))
  return { dir, asks: new AskStore(path.join(dir, 'asks.json')) }
}

const base = {
  goalId: '',
  sessionId: 'session-1',
  question: '要删生产表？',
  defaultAnswer: '不执行（保持现状）',
  blocking: true,
  reason: 'prod-db',
  effect: 'destructive' as const,
  beforeRef: '',
  policyVersion: 1,
}

describe('ask 去重（同一次调用两条回调）', () => {
  it('同会话同 key 的第二次判定复用第一条，不新增', async () => {
    const { asks } = setup()
    const first = await asks.create({ ...base, key: 'session-1:permit-1' })
    const second = await asks.create({ ...base, key: 'session-1:permit-1' })
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.ask.id).toBe(first.ask.id)
    expect(asks.list()).toHaveLength(1)
  })

  it('换个 key 就是另一件事，各自一条', async () => {
    const { asks } = setup()
    await asks.create({ ...base, key: 'session-1:permit-1' })
    const other = await asks.create({ ...base, key: 'session-1:permit-2' })
    expect(other.duplicate).toBe(false)
    expect(asks.list()).toHaveLength(2)
  })

  it('两次回调来自不同会话时不合并（会话本身就是身份）', async () => {
    const { asks } = setup()
    await asks.create({ ...base, key: 'session-1:permit-1' })
    const other = await asks.create({ ...base, sessionId: 'session-2', key: 'session-2:permit-1' })
    expect(other.duplicate).toBe(false)
    expect(asks.list()).toHaveLength(2)
  })

  it('第一条答过之后再命中同一 key，是新的一次提问', async () => {
    const { asks } = setup()
    const first = await asks.create({ ...base, key: 'session-1:permit-1' })
    await asks.answer(first.ask.id, '不执行')
    const again = await asks.create({ ...base, key: 'session-1:permit-1' })
    expect(again.duplicate).toBe(false)
    expect(again.ask.id).not.toBe(first.ask.id)
    expect(asks.open()).toHaveLength(1)
  })

  it('没有 key 的旧写法照旧每条都建（历史数据没有去重键）', async () => {
    const { asks } = setup()
    await asks.create({ ...base })
    await asks.create({ ...base })
    expect(asks.list()).toHaveLength(2)
  })
})
