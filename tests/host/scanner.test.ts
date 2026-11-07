import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { Store } from '../../src/host/cards/store'
import type { HostRuntime } from '../../src/host/host-api'
import { Scanner } from '../../src/host/scanner/scanner'

function tempStore(name = 'cards.json'): Store {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-scan-'))
  return new Store(path.join(dir, name))
}

function fakeCtx(
  prompts: Array<{ sessionId?: string; content?: Array<{ text?: string }> }>,
): HostRuntime {
  return {
    sessionController: {
      async prompt(request) {
        prompts.push(request as never)
        return undefined
      },
    },
  }
}

describe('自动卡扫描器', () => {
  it('到点的自动卡会在原会话里补一句话，然后收掉', async () => {
    const cards = tempStore()
    const prompts: Array<{ sessionId?: string; content?: Array<{ text?: string }> }> = []
    const scanner = new Scanner({ getCtx: () => fakeCtx(prompts), cards })
    const card = await cards.create('限流重试', {
      kind: 'auto',
      action: { type: 'prompt', delayMs: 0, input: '继续刚才那步' },
      origin: { sessionId: 'session-x' },
    })
    expect(card.status).toBe('scheduled')

    const results = await scanner.tick(Date.now() + 10)
    expect(results).toHaveLength(1)
    expect(results[0]?.ok).toBe(true)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]?.sessionId).toBe('session-x')
    expect(prompts[0]?.content?.[0]?.text).toContain('〔任务卡答复')
    expect(prompts[0]?.content?.[0]?.text).toContain('继续刚才那步')

    const after = cards.find(card.id)
    expect(after?.status).toBe('done')
    expect(after?.executedAt).toBeTypeOf('number')
  })

  it('还没到点的卡不会被扫到', async () => {
    const cards = tempStore()
    const prompts: Array<{ sessionId?: string }> = []
    const scanner = new Scanner({ getCtx: () => fakeCtx(prompts as never), cards })
    await cards.create('十分钟后重试', {
      kind: 'auto',
      action: { type: 'prompt', delayMs: 600000, input: '重试' },
      origin: { sessionId: 'session-y' },
    })
    const results = await scanner.tick(Date.now())
    expect(results).toHaveLength(0)
    expect(prompts).toHaveLength(0)
  })

  it('执行失败退回「要我知晓」并留下原因', async () => {
    const cards = tempStore()
    const scanner = new Scanner({
      getCtx: () => ({
        sessionController: {
          async prompt() {
            throw new Error('会话不存在')
          },
        },
      }),
      cards,
    })
    const card = await cards.create('会失败的自动卡', {
      kind: 'auto',
      action: { type: 'prompt', delayMs: 0, input: '继续' },
      origin: { sessionId: 'session-z' },
    })
    await scanner.tick(Date.now() + 10)
    const after = cards.find(card.id)
    expect(after?.status).toBe('open')
    expect(after?.lastError).toMatch(/会话不存在/)
  })

  it('没有可回访会话的卡不会被投递', async () => {
    const cards = tempStore()
    const prompts: unknown[] = []
    const scanner = new Scanner({ getCtx: () => fakeCtx(prompts as never), cards })
    const card = await cards.create('没有会话的自动卡', {
      kind: 'auto',
      action: { type: 'prompt', delayMs: 0, input: '继续' },
    })
    const results = await scanner.tick(Date.now() + 10)
    expect(results[0]?.ok).toBe(false)
    expect(prompts).toHaveLength(0)
    expect(cards.find(card.id)?.status).toBe('open')
  })
})
