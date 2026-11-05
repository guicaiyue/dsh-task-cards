import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

// 必须在 import 插件之前改 DSH_HOME：store 在加载时算数据路径。
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-home-'))
process.env.DSH_HOME = HOME

const { apply } = await import('../../src/host/index')

type Handler = (req: unknown, res: unknown) => Promise<unknown>

function harness(): { routes: Map<string, Handler>; dispose: () => void } {
  const routes = new Map<string, Handler>()
  const disposers: Array<() => void> = []
  const ctx = {
    webServer: {
      register(route: { path: string; handler: Handler }) {
        routes.set(route.path, route.handler)
        const dispose = () => routes.delete(route.path)
        disposers.push(dispose)
        return dispose
      },
    },
    effect(fn: () => () => void) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    // 没有宿主 connection 服务 → 走「只认回环」的分支
    get() {
      return undefined
    },
    // 只给诊断端点用的最小会话查询：不做真实事件读，够验参数校验与形状
    sessionQuery: {
      async readSession(id: string) {
        return { id, events: [{ type: 'user/message', data: { text: 'hello' } }] }
      },
    },
  }
  apply({
    inject: (_names: string[], cb: (value: typeof ctx) => void) => cb(ctx),
    on: () => () => {},
    effect(fn: () => (() => void) | undefined) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
  } as never)
  return {
    routes,
    dispose: () => {
      for (const fn of disposers) fn()
    },
  }
}

interface FakeResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
  headersSent: boolean
  writableEnded: boolean
  writeHead(code: number, headers?: Record<string, string>): void
  setHeader(name: string, value: string): void
  end(body?: string): void
  destroy(): void
}

function request(
  method: string,
  url: string,
  options: { body?: string; headers?: Record<string, string> } = {},
) {
  const chunks = options.body === undefined ? [] : [Buffer.from(options.body, 'utf8')]
  return {
    method,
    url,
    headers: { host: '127.0.0.1:13080', ...(options.headers || {}) },
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Buffer>> {
          return chunks.length
            ? { value: chunks.shift() as Buffer, done: false }
            : { value: undefined, done: true }
        },
      }
    },
  }
}

function response(): FakeResponse {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    writableEnded: false,
    writeHead(code: number, headers?: Record<string, string>) {
      this.statusCode = code
      Object.assign(this.headers, headers || {})
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value
    },
    end(body?: string) {
      this.body = body || ''
      this.headersSent = true
      this.writableEnded = true
    },
    destroy() {},
  }
}

async function call(
  routes: Map<string, Handler>,
  method: string,
  url: string,
  options?: { body?: string; headers?: Record<string, string> },
): Promise<{ status: number; json: Record<string, never> | null }> {
  const handler = routes.get(url.split('?')[0] as string)
  expect(handler, `路由未注册：${url}`).toBeTruthy()
  const res = response()
  await handler?.(request(method, url, options), res)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

describe('面板后端路由', () => {
  beforeAll(() => {
    fs.rmSync(path.join(HOME, 'dsh-task-cards'), { recursive: true, force: true })
  })

  it('建卡 → 列表 → 完成 → 删除 的整条往返', async () => {
    const { routes, dispose } = harness()
    try {
      const empty = await call(routes, 'GET', '/dsh-task-cards/api/cards')
      expect(empty.status).toBe(200)
      expect((empty.json as unknown as { cards: unknown[] }).cards).toEqual([])

      const created = await call(routes, 'POST', '/dsh-task-cards/api/cards', {
        body: JSON.stringify({ title: '把面板搭起来' }),
      })
      expect(created.status).toBe(200)
      const card = (created.json as unknown as { card: { id: string; title: string } }).card
      expect(card.title).toBe('把面板搭起来')

      const listed = await call(routes, 'GET', '/dsh-task-cards/api/cards')
      expect((listed.json as unknown as { cards: unknown[] }).cards).toHaveLength(1)

      const done = await call(routes, 'POST', '/dsh-task-cards/api/action', {
        body: JSON.stringify({ id: card.id, action: 'complete' }),
      })
      expect(done.status).toBe(200)
      expect((done.json as unknown as { card: { status: string } }).card.status).toBe('done')

      const removed = await call(routes, 'POST', '/dsh-task-cards/api/action', {
        body: JSON.stringify({ id: card.id, action: 'delete' }),
      })
      expect(removed.status).toBe(200)
      const after = await call(routes, 'GET', '/dsh-task-cards/api/cards')
      expect((after.json as unknown as { cards: unknown[] }).cards).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  it('数据确实落在 $DSH_HOME 下', async () => {
    const { routes, dispose } = harness()
    try {
      await call(routes, 'POST', '/dsh-task-cards/api/cards', {
        body: JSON.stringify({ title: '落盘' }),
      })
      const file = path.join(HOME, 'dsh-task-cards', 'cards.json')
      expect(fs.existsSync(file)).toBe(true)
      const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown[] | { cards: unknown[] }
      const list = Array.isArray(stored) ? stored : stored.cards
      expect(list).toHaveLength(1)
    } finally {
      dispose()
    }
  })

  it('空标题 400，未知操作 400，缺 id 400', async () => {
    const { routes, dispose } = harness()
    try {
      const empty = await call(routes, 'POST', '/dsh-task-cards/api/cards', {
        body: JSON.stringify({ title: '  ' }),
      })
      expect(empty.status).toBe(400)
      expect((empty.json as unknown as { code: string }).code).toBe('EMPTY_TITLE')

      const badAction = await call(routes, 'POST', '/dsh-task-cards/api/action', {
        body: JSON.stringify({ id: 'x', action: 'nope' }),
      })
      expect(badAction.status).toBe(400)

      const noId = await call(routes, 'POST', '/dsh-task-cards/api/action', {
        body: JSON.stringify({ action: 'complete' }),
      })
      expect(noId.status).toBe(400)
      expect((noId.json as unknown as { code: string }).code).toBe('MISSING_ID')
    } finally {
      dispose()
    }
  })

  it('跨站请求 403，非法方法 405', async () => {
    const { routes, dispose } = harness()
    try {
      const cross = await call(routes, 'GET', '/dsh-task-cards/api/cards', {
        headers: { 'sec-fetch-site': 'cross-site' },
      })
      expect(cross.status).toBe(403)

      const wrongMethod = await call(routes, 'DELETE', '/dsh-task-cards/api/cards')
      expect(wrongMethod.status).toBe(405)
    } finally {
      dispose()
    }
  })

  it('诊断端点：缺 id 是 400 而不是 500，给了 id 就返回形状', async () => {
    const { routes, dispose } = harness()
    try {
      const missing = await call(routes, 'GET', '/dsh-task-cards/api/inspect')
      expect(missing.status).toBe(400)
      expect((missing.json as unknown as { code: string }).code).toBe('MISSING_ID')

      const ok = await call(routes, 'GET', '/dsh-task-cards/api/inspect?id=session-x')
      expect(ok.status).toBe(200)
      const body = ok.json as unknown as {
        sessionId: string
        toolCount: number
        eventTypes: string[]
      }
      expect(body.sessionId).toBe('session-x')
      expect(Array.isArray(body.eventTypes)).toBe(true)

      const events = await call(routes, 'GET', '/dsh-task-cards/api/inspect?events=1&id=session-x')
      expect(events.status).toBe(200)
      expect(Array.isArray((events.json as unknown as { events: unknown[] }).events)).toBe(true)
    } finally {
      dispose()
    }
  })

  it('设置往返：GET 有默认提示词，POST 改完能读回', async () => {
    const { routes, dispose } = harness()
    try {
      const got = await call(routes, 'GET', '/dsh-task-cards/api/settings')
      const settings = (
        got.json as unknown as { settings: { systemPrompt: string; enabled: boolean } }
      ).settings
      expect(settings.enabled).toBe(true)
      expect(settings.systemPrompt.length).toBeGreaterThan(10)

      const saved = await call(routes, 'POST', '/dsh-task-cards/api/settings', {
        body: JSON.stringify({ settings: { ...settings, minReplyChars: 42 } }),
      })
      expect(saved.status).toBe(200)
      expect(
        (saved.json as unknown as { settings: { minReplyChars: number } }).settings.minReplyChars,
      ).toBe(42)
    } finally {
      dispose()
    }
  })
})
