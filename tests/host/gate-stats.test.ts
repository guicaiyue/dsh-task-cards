// 零静默账本：拒绝次数与 ask 去向分别计数，差值是「没有去向的拒绝」。
//
// 真实风险：闸门拒绝后若 ask 没落地（写盘失败、依赖缺失），执行方以为「已经登记给人了」，
// 人却永远看不到——日志里只有一行 warn，没人会去翻。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GateStatsStore, unaccountedOf } from '../../src/host/gate/gate-stats'

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-gate-stats-'))
  return new GateStatsStore(path.join(dir, 'gate-stats.json'))
}

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

describe('闸门零静默账本', () => {
  it('拒绝与三种去向分别累计，落盘后能读回', async () => {
    const s = store()
    s.bump('denied')
    s.bump('askCreated')
    s.bump('denied')
    s.bump('askDeduped')
    await wait()
    const read = s.read()
    expect(read.denied).toBe(2)
    expect(read.askCreated).toBe(1)
    expect(read.askDeduped).toBe(1)
    expect(unaccountedOf(read)).toBe(0)
    expect(fs.existsSync(s.file)).toBe(true)
  })

  it('写失败也算一种去向，但会计入 askFailed', async () => {
    const s = store()
    s.bump('denied')
    s.bump('askFailed')
    await wait()
    const read = s.read()
    expect(read.askFailed).toBe(1)
    expect(unaccountedOf(read)).toBe(0)
  })

  it('拒绝后什么都没落地 → unaccounted 暴露静默', async () => {
    const s = store()
    s.bump('denied')
    s.bump('denied')
    s.bump('askCreated')
    await wait()
    expect(unaccountedOf(s.read())).toBe(1)
  })

  it('空账本读出来是零，不会得到 undefined', () => {
    const read = store().read()
    expect(read).toMatchObject({ denied: 0, askCreated: 0, askDeduped: 0, askFailed: 0 })
    expect(unaccountedOf(read)).toBe(0)
  })
})

describe('测试隔离', () => {
  it('测试环境里默认账本落在临时目录，不写真实数据目录', async () => {
    const { gateStats } = await import('../../src/host/gate/gate-stats')
    const file = gateStats().file
    expect(file).toContain('dtc-gate-stats-test.json')
    expect(file.startsWith('/tmp') || file.startsWith(process.env.TMPDIR ?? '/tmp')).toBe(true)
  })
})
