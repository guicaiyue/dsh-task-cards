import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// 必须在 import 插件之前改 DSH_HOME：store.mjs 在加载时算数据路径。
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-home-'))
process.env.DSH_HOME = HOME

const { default: plugin } = await import('../lib/index.js')

function harness() {
  const routes = new Map()
  const disposers = []
  const ctx = {
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        const dispose = () => routes.delete(route.path)
        disposers.push(dispose)
        return dispose
      },
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    // 没有宿主 connection 服务 → 走「只认回环」的分支
    get() {
      return undefined
    },
  }
  plugin.apply({
    inject: (_names, cb) => cb(ctx),
    // 事件订阅：本测试不驱动观察者，只保证注册不炸
    on: () => () => {},
    // 扫描器在 apply 里注册一个清理 effect
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
  })
  return { routes, dispose: () => disposers.forEach((fn) => fn()) }
}

function request(method, url, { body, headers } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(body, 'utf8')]
  return {
    method,
    url,
    headers: { host: '127.0.0.1:13080', ...(headers || {}) },
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return chunks.length ? { value: chunks.shift(), done: false } : { done: true, value: undefined }
        },
      }
    },
  }
}

function response() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    writableEnded: false,
    writeHead(code, headers) {
      this.statusCode = code
      Object.assign(this.headers, headers || {})
    },
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(body) {
      this.body = body || ''
      this.headersSent = true
      this.writableEnded = true
    },
    destroy() {},
  }
  return res
}

async function call(routes, method, url, options) {
  const handler = routes.get(url.split('?')[0])
  assert.ok(handler, `路由未注册：${url}`)
  const res = response()
  await handler(request(method, url, options), res)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, res }
}

test('建卡 → 列表 → 完成 → 删除 的整条往返', async () => {
  const { routes, dispose } = harness()
  try {
    const empty = await call(routes, 'GET', '/dsh-task-cards/api/cards')
    assert.equal(empty.status, 200)
    assert.deepEqual(empty.json.cards, [])

    const created = await call(routes, 'POST', '/dsh-task-cards/api/cards', { body: JSON.stringify({ title: '把面板搭起来' }) })
    assert.equal(created.status, 200)
    assert.equal(created.json.card.title, '把面板搭起来')
    const id = created.json.card.id

    const listed = await call(routes, 'GET', '/dsh-task-cards/api/cards')
    assert.equal(listed.json.cards.length, 1)

    const done = await call(routes, 'POST', '/dsh-task-cards/api/action', { body: JSON.stringify({ id, action: 'complete' }) })
    assert.equal(done.status, 200)
    assert.equal(done.json.card.status, 'done')

    const removed = await call(routes, 'POST', '/dsh-task-cards/api/action', { body: JSON.stringify({ id, action: 'delete' }) })
    assert.equal(removed.status, 200)
    assert.equal((await call(routes, 'GET', '/dsh-task-cards/api/cards')).json.cards.length, 0)
  } finally {
    dispose()
  }
})

test('数据确实落在 $DSH_HOME 下', async () => {
  const { routes, dispose } = harness()
  try {
    await call(routes, 'POST', '/dsh-task-cards/api/cards', { body: JSON.stringify({ title: '落盘' }) })
    const file = path.join(HOME, 'dsh-task-cards', 'cards.json')
    assert.ok(fs.existsSync(file), '期望 cards.json 落盘')
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
    const list = Array.isArray(stored) ? stored : stored.cards
    assert.equal(list.length, 1)
  } finally {
    dispose()
  }
})

test('空标题 400，未知操作 400，缺 id 400', async () => {
  const { routes, dispose } = harness()
  try {
    const empty = await call(routes, 'POST', '/dsh-task-cards/api/cards', { body: JSON.stringify({ title: '  ' }) })
    assert.equal(empty.status, 400)
    assert.equal(empty.json.code, 'EMPTY_TITLE')

    const badAction = await call(routes, 'POST', '/dsh-task-cards/api/action', { body: JSON.stringify({ id: 'x', action: 'nope' }) })
    assert.equal(badAction.status, 400)

    const noId = await call(routes, 'POST', '/dsh-task-cards/api/action', { body: JSON.stringify({ action: 'complete' }) })
    assert.equal(noId.status, 400)
    assert.equal(noId.json.code, 'MISSING_ID')
  } finally {
    dispose()
  }
})

test('跨站请求 403，非法方法 405', async () => {
  const { routes, dispose } = harness()
  try {
    const cross = await call(routes, 'GET', '/dsh-task-cards/api/cards', { headers: { 'sec-fetch-site': 'cross-site' } })
    assert.equal(cross.status, 403)

    const wrongMethod = await call(routes, 'DELETE', '/dsh-task-cards/api/cards')
    assert.equal(wrongMethod.status, 405)
  } finally {
    dispose()
  }
})
