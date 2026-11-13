// 接线级测试：走 bootKernel 而不是直接调迁移函数。
//
// 事故背景（两次）：migrateDecisions / normalize 写了、单测绿，但 boot 里没接线，
// 生产数据永远不纠正。这条用临时数据目录走一遍 boot，断言磁盘被真正改写。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { Store } from '../../src/host/cards/store'
import { assembleKernel } from '../../src/host/kernel/assemble'
import { bootKernel } from '../../src/host/kernel/boot'

const rootStub = {
  inject: (_names: string[], cb: (ctx: unknown) => void) => cb({}),
  on: () => () => {},
  effect: (fn: () => (() => void) | undefined) => fn(),
} as never

describe('boot 接线（防「函数写了没接」）', () => {
  it('空档 approval-policy.json + boot → 磁盘被重写为非空，且打启动自检', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-boot-'))
    const cards = new Store(path.join(dir, 'cards.json'))
    await cards.create('启动自检卡', { kind: 'decision' })
    const policyFile = path.join(path.dirname(cards.file), 'approval-policy.json')
    fs.mkdirSync(path.dirname(policyFile), { recursive: true })
    fs.writeFileSync(
      policyFile,
      JSON.stringify({ version: 1, tiers: { auto: [], delegated: [], user: [] }, updatedAt: 0 }),
      'utf8',
    )

    const logs: string[] = []
    const kernel = assembleKernel({
      cards,
      log: (line: string) => logs.push(line),
      getCtx: () => null,
    })
    bootKernel({ root: rootStub, cards, kernel, log: (line) => logs.push(line), migrate: true })

    // 全量测试并行时 CPU 紧张，给归一化更宽的等待窗（3s）。
    for (let i = 0; i < 300; i += 1) {
      if (logs.some((line) => line.startsWith('启动自检'))) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(logs.some((line) => line.includes('审批策略归一化'))).toBe(true)
    expect(fs.readFileSync(policyFile, 'utf8')).not.toContain('"auto":[]')

    const onDisk = JSON.parse(fs.readFileSync(policyFile, 'utf8')) as {
      tiers: { auto: string[]; delegated: string[]; user: string[] }
    }
    expect(onDisk.tiers.auto.length).toBeGreaterThan(0)
    expect(onDisk.tiers.delegated.length).toBeGreaterThan(0)
    expect(onDisk.tiers.user.length).toBeGreaterThan(0)

    const selfCheck = logs.find((line) => line.startsWith('启动自检'))
    expect(selfCheck).toContain('approvalTiers=auto:')
    expect(selfCheck).toContain('plans=')
    expect(selfCheck).toContain('decision=')
  })
})
