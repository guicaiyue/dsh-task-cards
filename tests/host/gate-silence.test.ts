// 端到端：闸门在 auto 模式拒绝一次，账本必须同时记「拒绝 1 次」和「ask 落地 1 次」；
// ask 写失败时必须记 askFailed——这样 /stats.silence.unaccounted 才能暴露静默。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createTurnGate } from '../../src/host/autonomy/gate-wire'
import { DEFAULT_SETTINGS } from '../../src/host/cards/defaults'
import { Store } from '../../src/host/cards/store'
import type { GateRootLike } from '../../src/host/gate/gate'
import { GateStatsStore, unaccountedOf } from '../../src/host/gate/gate-stats'
import type { ToolExecutionLike } from '../../src/host/host-api'

const PROD_ALTER = 'docker exec postgres psql -d story -c "alter table t add column x int"'

async function until(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 4000; i += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error(`等待超时：${label}`)
}

function setup(create: () => Promise<{ ask: unknown; duplicate: boolean }>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-gate-silence-'))
  const stats = new GateStatsStore(path.join(dir, 'gate-stats.json'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const gate = createTurnGate({
    cards,
    settings: () => ({
      ...DEFAULT_SETTINGS,
      autonomyMode: 'auto' as const,
      turnGate: 'high-risk' as const,
    }),
    log: () => undefined,
    stats,
    kernel: {
      journal: { append: async () => undefined },
      asks: { create },
      approvalPolicy: { read: () => ({ version: 1 }) },
    } as never,
  })
  const holder: { fn?: (exec: unknown) => string | undefined } = {}
  const root: GateRootLike = {
    inject: (_names, cb) =>
      cb({
        tools: {
          guard: (fn: (exec: unknown) => string | undefined) => {
            holder.fn = fn
            return () => undefined
          },
        },
      }),
    on: () => () => undefined,
    effect: (fn: () => (() => void) | undefined) => fn(),
  }
  gate.attach(root)
  const exec = (): ToolExecutionLike => ({
    name: 'bash',
    arguments: { command: PROD_ALTER },
    agent: { id: 's-silence', session: { header: { cwd: '/workspace/proj' } } },
  })
  return { stats, guard: holder.fn, exec }
}

describe('零静默：拒绝与 ask 去向', () => {
  it('拒绝一次且 ask 落地 → denied=1 askCreated=1，unaccounted=0', async () => {
    const { stats, guard, exec } = setup(async () => ({ ask: { id: 'a1' }, duplicate: false }))
    expect(String(guard?.(exec()))).toContain('ask 通道')
    await until(() => stats.read().askCreated === 1, 'ask 落地')
    const read = stats.read()
    expect(read.denied).toBe(1)
    expect(unaccountedOf(read)).toBe(0)
  })

  it('ask 写失败 → askFailed=1，仍然没有静默（有人能看见这条失败）', async () => {
    const { stats, guard, exec } = setup(async () => {
      throw new Error('磁盘满了')
    })
    expect(String(guard?.(exec()))).toContain('ask 通道')
    await until(() => stats.read().askFailed === 1, 'ask 失败')
    expect(unaccountedOf(stats.read())).toBe(0)
  })
})
