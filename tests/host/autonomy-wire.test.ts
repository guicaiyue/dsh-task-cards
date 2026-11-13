// P1 审计载荷：policyVersion 必须来自 approval-policy（不是硬编码 1）。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createTurnGate } from '../../src/host/autonomy/gate-wire'
import { DEFAULT_SETTINGS } from '../../src/host/cards/defaults'
import { Store } from '../../src/host/cards/store'
import type { GateRootLike } from '../../src/host/gate/gate'
import type { ToolExecutionLike } from '../../src/host/host-api'

const PROD_ALTER = 'docker exec postgres psql -d story -c "alter table t add column x int"'
const REVERSIBLE = 'echo ok > /workspace/proj/src/note.txt'

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('等待超时')
}

describe('审计 policyVersion', () => {
  it('autonomy:auto 与 ask:open 的 meta.policyVersion 都取策略版本 7', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-aw-'))
    const cards = new Store(path.join(dir, 'cards.json'))
    const events: Array<Record<string, unknown>> = []
    const asks: Array<Record<string, unknown>> = []
    const kernel = {
      journal: { append: async (event: Record<string, unknown>) => void events.push(event) },
      asks: {
        create: async (input: Record<string, unknown>) => {
          const ask = { kind: 'ask', id: 'ask-1', createdAt: 1, ...input }
          asks.push(ask)
          return { ask, duplicate: false }
        },
      },
      approvalPolicy: { read: () => ({ version: 7 }) },
    }
    const settings = {
      ...DEFAULT_SETTINGS,
      autonomyMode: 'auto' as const,
      turnGate: 'high-risk' as const,
    }
    const gate = createTurnGate({
      cards,
      settings: () => settings,
      log: () => undefined,
      kernel: kernel as never,
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
    const exec = (command: string): ToolExecutionLike => ({
      name: 'bash',
      arguments: { command },
      agent: { id: 's-audit', session: { header: { cwd: '/workspace/proj' } } },
    })

    holder.fn?.(exec(REVERSIBLE))
    await until(() => events.length >= 1)
    expect(events[0]?.meta).toMatchObject({ type: 'autonomy:auto', policyVersion: 7 })
    expect((events[0]?.meta as Record<string, unknown>)?.beforeRef).toBeDefined()

    const deny = holder.fn?.(exec(PROD_ALTER))
    expect(String(deny)).toContain('ask 通道')
    await until(() => asks.length >= 1 && events.length >= 2)
    if (asks[0]?.policyVersion !== 7) throw new Error(`ASK ${JSON.stringify(asks[0])}`)
    expect(events[1]?.meta).toMatchObject({ type: 'ask:open', policyVersion: 7 })
  })
})

describe('M8：edit/write 仓内写产生 autonomy:auto 审计', () => {
  it('edit 工作区文件 → 1 条 autonomy:auto（beforeRef 非空）+ 0 卡片', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-edit-'))
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-edit-repo-'))
    const git = (args: string[]) =>
      require('node:child_process').execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
    git(['init', '-q'])
    git(['config', 'user.email', 't@t'])
    git(['config', 'user.name', 't'])
    fs.writeFileSync(path.join(repo, 'a.txt'), '1')
    git(['add', '.'])
    git(['commit', '-qm', 'init'])
    const cards = new Store(path.join(dir, 'cards.json'))
    const events: Array<Record<string, unknown>> = []
    const kernel = {
      journal: { append: async (event: Record<string, unknown>) => void events.push(event) },
      asks: { create: async () => ({}) },
      approvalPolicy: { read: () => ({ version: 2 }) },
    }
    const settings = { ...DEFAULT_SETTINGS, autonomyMode: 'auto' as const }
    const gate = createTurnGate({
      cards,
      settings: () => settings,
      log: () => undefined,
      kernel: kernel as never,
    })
    const holder: { fn?: (exec: unknown) => string | undefined } = {}
    gate.attach({
      inject: (_n: string[], cb: (ctx: unknown) => void) =>
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
    } as never)
    holder.fn?.({
      name: 'edit',
      arguments: { path: path.join(repo, 'lib/a.ts'), old_string: 'a', new_string: 'b' },
      agent: { id: 's-edit', session: { header: { cwd: repo } } },
    })
    expect(cards.list()).toHaveLength(0)
    await until(() => events.length >= 1)
    const meta = events[0]?.meta as Record<string, unknown>
    expect(meta.type).toBe('autonomy:auto')
    expect(meta.effect).toBe('write-code')
    expect(meta.goalId).toBe('s-edit')
    expect(typeof meta.beforeRef).toBe('string')
    expect(meta.beforeRef).not.toBe('')
  })
})
