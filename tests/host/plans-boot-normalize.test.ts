// R2 接线级测试：走 bootKernel 把旧三字段 plans.json 升级为四段。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { Store } from '../../src/host/cards/store'
import { assembleKernel } from '../../src/host/kernel/assemble'
import { bootKernel } from '../../src/host/kernel/boot'

const rootStub = {
  inject: (_n: string[], cb: (ctx: unknown) => void) => cb({}),
  on: () => () => {},
  effect: (fn: () => (() => void) | undefined) => fn(),
} as never

describe('boot 归一化 plans.json', () => {
  it('旧三字段文件（缺 verdicts/attempts）→ boot 后磁盘四段齐全', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-plans-boot-'))
    const cards = new Store(path.join(dir, 'cards.json'))
    const card = await cards.create('旧计划卡', { kind: 'decision' })
    const plansFile = path.join(dir, 'plans.json')
    fs.writeFileSync(
      plansFile,
      JSON.stringify({
        version: 1,
        plans: [{ id: 'p-old', cardId: card.id, instruction: 'x', idempotencyKey: 'plan:p-old' }],
        outcomes: [],
        updatedAt: 0,
      }),
      'utf8',
    )

    const logs: string[] = []
    const kernel = assembleKernel({ cards, log: (l: string) => logs.push(l), getCtx: () => null })
    bootKernel({ root: rootStub, cards, kernel, log: (l) => logs.push(l), migrate: true })
    for (let i = 0; i < 100; i += 1) {
      if (logs.some((line) => line.includes('计划账本归一化'))) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(logs.some((line) => line.includes('计划账本归一化'))).toBe(true)

    const onDisk = JSON.parse(fs.readFileSync(plansFile, 'utf8')) as {
      plans: Array<Record<string, unknown>>
      outcomes: unknown[]
      verdicts: unknown[]
    }
    expect(Array.isArray(onDisk.verdicts)).toBe(true)
    expect(Array.isArray(onDisk.outcomes)).toBe(true)
    const plan = onDisk.plans[0] as Record<string, unknown>
    expect(plan.attempts).toEqual([])
    expect(plan.dependsOn).toEqual([])
    expect(plan.acceptance).toEqual([])
  })
})
