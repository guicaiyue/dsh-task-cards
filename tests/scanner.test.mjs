import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { Scanner } from '../lib/scanner.mjs'
import { Store } from '../lib/store.mjs'

function tempStore(name = 'cards.json') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-scan-'))
  return new Store(path.join(dir, name))
}

function fakeCtx(prompts) {
  return {
    sessionController: {
      async prompt(request) {
        prompts.push(request)
      },
    },
  }
}

test('到点的自动卡会在原会话里补一句话，然后收掉', async () => {
  const cards = tempStore()
  const prompts = []
  const scanner = new Scanner({ getCtx: () => fakeCtx(prompts), cards })
  // delayMs=0 → dueAt = now
  const card = await cards.create('限流重试', {
    kind: 'auto',
    action: { type: 'prompt', delayMs: 0, input: '继续刚才那步' },
    origin: { sessionId: 'session-x' },
  })
  assert.equal(card.status, 'scheduled')

  const results = await scanner.tick(Date.now() + 10)
  assert.equal(results.length, 1)
  assert.equal(results[0].ok, true)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].sessionId, 'session-x')
  assert.equal(prompts[0].content[0].text, '继续刚才那步')

  const after = cards.find(card.id)
  assert.equal(after.status, 'done')
  assert.ok(after.executedAt)
})

test('还没到点的卡不会被扫到', async () => {
  const cards = tempStore()
  const prompts = []
  const scanner = new Scanner({ getCtx: () => fakeCtx(prompts), cards })
  await cards.create('十分钟后重试', {
    kind: 'auto',
    action: { type: 'prompt', delayMs: 600000, input: '重试' },
    origin: { sessionId: 'session-y' },
  })
  const results = await scanner.tick(Date.now())
  assert.equal(results.length, 0)
  assert.equal(prompts.length, 0)
})

test('执行失败退回「要我知晓」并留下原因', async () => {
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
  assert.equal(after.status, 'open')
  assert.match(after.lastError, /会话不存在/)
})
