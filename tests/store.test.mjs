import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { Store, StoreError } from '../lib/store.mjs'

function tempFile(name = 'cards.json') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-store-'))
  return path.join(dir, name)
}

test('新建 → 落盘 → 新实例还能读到', async () => {
  const file = tempFile()
  const store = new Store(file)
  const card = await store.create('  登录页空态要补  ')

  assert.equal(card.title, '登录页空态要补')
  assert.equal(card.status, 'open')
  assert.equal(card.kind, 'info')
  assert.deepEqual(card.events.map((e) => e.type), ['created'])

  const reopened = new Store(file)
  assert.equal(reopened.list().length, 1)
  assert.equal(reopened.list()[0].id, card.id)
})

test('完成与恢复都会追加事件', async () => {
  const store = new Store(tempFile())
  const card = await store.create('跑一次测试')

  const done = await store.setState(card.id, 'done')
  assert.equal(done.status, 'done')
  assert.deepEqual(done.events.map((e) => e.type), ['created', 'completed'])

  const back = await store.setState(card.id, 'todo')
  assert.equal(back.status, 'open')
  assert.deepEqual(back.events.map((e) => e.type), ['created', 'completed', 'reopened'])
})

test('删除后不再出现在列表里', async () => {
  const store = new Store(tempFile())
  const card = await store.create('临时的一件事')
  await store.remove(card.id)
  assert.equal(store.list().length, 0)
})

test('空标题与超长标题被拒', async () => {
  const store = new Store(tempFile())
  await assert.rejects(() => store.create('   '), (err) => err instanceof StoreError && err.code === 'EMPTY_TITLE')
  await assert.rejects(() => store.create('a'.repeat(201)), (err) => err.code === 'TITLE_TOO_LONG')
})

test('不存在的 id 与未知操作被拒', async () => {
  const store = new Store(tempFile())
  await assert.rejects(() => store.setState('nope', 'done'), (err) => err.code === 'NOT_FOUND')
  await assert.rejects(() => store.setState('nope', 'weird'), (err) => err.code === 'BAD_STATE')
})

test('坏文件被挪走，不阻塞开工，且留下 warning', () => {
  const file = tempFile()
  fs.writeFileSync(file, '{ 这不是 json', 'utf8')
  const store = new Store(file)
  assert.deepEqual(store.list(), [])
  assert.ok(store.warning && store.warning.includes('无法解析'))
  assert.ok(fs.readdirSync(path.dirname(file)).some((name) => name.startsWith('cards.json.bad-')))
})

test('并发写入不丢卡', async () => {
  const store = new Store(tempFile())
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.create(`卡 ${i}`)))
  assert.equal(new Store(store.file).list().length, 20)
})
