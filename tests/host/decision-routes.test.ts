import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Advice, Card } from '../../src/shared/contract'

// 必须在 import 插件之前改 DSH_HOME：store 在加载时算数据路径。
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-decision-'))
process.env.DSH_HOME = HOME

const { apply } = await import('../../src/host/index')
const { Store } = await import('../../src/host/cards/store')

const API = '/dsh-task-cards/api'
const CARDS_FILE = path.join(HOME, 'dsh-task-cards', 'cards.json')
const DATA_DIR = path.join(HOME, 'dsh-task-cards')

type Json = Record<string, unknown>
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
    get() {
      return undefined
    },
    // 作答通道：卡片有 origin.sessionId 时走 prompt（模拟把回答投回原会话）。
    sessionController: {
      async prompt() {
        return { ok: true }
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
): Promise<{ status: number; json: Json | null }> {
  const handler = routes.get(url.split('?')[0] as string)
  expect(handler, `路由未注册：${url}`).toBeTruthy()
  const res = response()
  await handler?.(request(method, url, options), res)
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as Json) : null }
}

async function seedCard(title: string, extra: Record<string, unknown> = {}): Promise<Card> {
  const store = new Store(CARDS_FILE)
  return store.create(title, extra)
}

const ADVICE: Advice = {
  verdict: 'modify',
  summary: '先跑通最小验证',
  options: [
    {
      name: '先跑通最小验证',
      cost: '1 小时',
      gain: '以后每次少走 2 步',
      worst: '白做 1 小时',
      answer: '先跑通最小验证，再谈重构',
      verdict: 'approve',
    },
    {
      name: '直接重构',
      cost: '一天',
      gain: '0 步',
      worst: '方案被推翻重来',
      answer: '直接重构整个登录页',
      verdict: 'reject',
    },
  ],
  basis: '无同类判例',
  precedentIds: [],
  confidence: 'normal',
  question: '',
  lane: 'decision',
  applied: false,
  at: Date.now(),
}

async function seedAdvisedCard(): Promise<Card> {
  const card = await seedCard('要不要加缓存', {
    kind: 'decision',
    detail: '每次请求都查库',
    origin: { sessionId: 's-adopt' },
  })
  const store = new Store(CARDS_FILE)
  return store.patch(card.id, { advice: ADVICE }, 'advised')
}

async function listCards(routes: Map<string, Handler>): Promise<Card[]> {
  const res = await call(routes, 'GET', `${API}/cards`)
  return (res.json as { cards: Card[] }).cards
}

async function listPrecedents(routes: Map<string, Handler>): Promise<Json[]> {
  const res = await call(routes, 'GET', `${API}/decisions`)
  return (res.json as { precedents: Json[] }).precedents
}

function findCard(cards: Card[], id: string): Card | undefined {
  return cards.find((card) => card.id === id)
}

describe('决策阶段路由', () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true })
  })

  it('GET /decisions 初始为空', async () => {
    const { routes, dispose } = harness()
    try {
      const res = await call(routes, 'GET', `${API}/decisions`)
      expect(res.status).toBe(200)
      expect(res.json).toMatchObject({ ok: true, precedents: [] })
    } finally {
      dispose()
    }
  })

  it('作答落一条判例（choice = 回答文本），卡同时变成 done', async () => {
    const card = await seedCard('要不要把登录页重做', {
      kind: 'decision',
      detail: '现状能跑但结构乱',
      origin: { sessionId: 's-answer' },
    })
    const { routes, dispose } = harness()
    try {
      const res = await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: card.id, action: 'answer', option: '先跑通最小验证' }),
      })
      expect(res.status).toBe(200)

      const precedents = await listPrecedents(routes)
      expect(precedents).toHaveLength(1)
      expect(precedents[0]).toMatchObject({
        cardId: card.id,
        title: '要不要把登录页重做',
        question: '现状能跑但结构乱',
        choice: '先跑通最小验证',
        outcome: 'unknown',
      })
      const keywords = precedents[0]?.keywords as string[] | undefined
      expect(keywords?.length ?? 0).toBeGreaterThan(0)

      const after = findCard(await listCards(routes), card.id)
      expect(after?.status).toBe('done')
      expect(after?.answer).toBe('先跑通最小验证')
    } finally {
      dispose()
    }
  })

  it('完成写「批了」、忽略写「不批，忽略」，重复完成不重复落判例', async () => {
    const done = await seedCard('把面板搭起来')
    const dropped = await seedCard('换个配色')
    const { routes, dispose } = harness()
    try {
      const first = await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: done.id, action: 'complete' }),
      })
      expect(first.status).toBe(200)
      await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: done.id, action: 'complete' }),
      })
      await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: dropped.id, action: 'dismiss' }),
      })

      const precedents = await listPrecedents(routes)
      expect(precedents.map((row) => row.choice)).toEqual(['不批，忽略', '批了'])
    } finally {
      dispose()
    }
  })

  it('POST /decisions mark-reworked 把判例改 reworked 并在卡上记事件', async () => {
    const card = await seedCard('要不要把登录页重做', {
      kind: 'decision',
      origin: { sessionId: 's-rework' },
    })
    const { routes, dispose } = harness()
    try {
      await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: card.id, action: 'answer', option: '先跑通最小验证' }),
      })
      const res = await call(routes, 'POST', `${API}/decisions`, {
        body: JSON.stringify({ action: 'mark-reworked', id: card.id, option: '方案选错了' }),
      })
      expect(res.status).toBe(200)
      expect(res.json).toMatchObject({ ok: true, created: false })

      const precedents = await listPrecedents(routes)
      expect(precedents[0]).toMatchObject({ outcome: 'reworked', note: '方案选错了' })
      const after = findCard(await listCards(routes), card.id)
      expect(after?.events.map((event) => event.type)).toContain('reworked')
    } finally {
      dispose()
    }
  })

  it('POST /action mark-reworked 也行；没有判例的旧卡就地补一条', async () => {
    const card = await seedCard('很久以前的决定', { kind: 'decision' })
    const { routes, dispose } = harness()
    try {
      const res = await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: card.id, action: 'mark-reworked', option: '想错了' }),
      })
      expect(res.status).toBe(200)
      expect(res.json).toMatchObject({ ok: true, created: true })

      const precedents = await listPrecedents(routes)
      expect(precedents).toHaveLength(1)
      expect(precedents[0]).toMatchObject({
        cardId: card.id,
        outcome: 'reworked',
        choice: '（未记录）',
        note: '想错了',
      })
    } finally {
      dispose()
    }
  })

  it('adopt 用方案 answer 作答（等价 answer），非法序号 400', async () => {
    const card = await seedAdvisedCard()
    const { routes, dispose } = harness()
    try {
      const res = await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: card.id, action: 'adopt', option: '1' }),
      })
      expect(res.status).toBe(200)

      const after = findCard(await listCards(routes), card.id)
      expect(after?.status).toBe('done')
      expect(after?.answer).toBe('直接重构整个登录页')

      const precedents = await listPrecedents(routes)
      expect(precedents[0]?.choice).toBe('直接重构整个登录页')

      const bad = await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: card.id, action: 'adopt', option: '9' }),
      })
      expect(bad.status).toBe(400)
      expect(bad.json).toMatchObject({ code: 'BAD_OPTION' })
    } finally {
      dispose()
    }
  })

  it('没有票拟的卡 adopt 是 400 BAD_OPTION', async () => {
    const card = await seedCard('还没出票拟', { kind: 'decision' })
    const { routes, dispose } = harness()
    try {
      const res = await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: card.id, action: 'adopt', option: '0' }),
      })
      expect(res.status).toBe(400)
      expect(res.json).toMatchObject({ code: 'BAD_OPTION' })
    } finally {
      dispose()
    }
  })

  it('redecide 立即排队返回；参数错误回 400，方法错误回 405', async () => {
    const card = await seedCard('要不要重出票拟', { kind: 'decision' })
    const { routes, dispose } = harness()
    try {
      const scheduled = await call(routes, 'POST', `${API}/decisions`, {
        body: JSON.stringify({ action: 'redecide', id: card.id }),
      })
      expect(scheduled.status).toBe(200)
      expect(scheduled.json).toMatchObject({ ok: true, scheduled: true })

      const noId = await call(routes, 'POST', `${API}/decisions`, {
        body: JSON.stringify({ action: 'redecide' }),
      })
      expect(noId.status).toBe(400)
      expect(noId.json).toMatchObject({ code: 'MISSING_ID' })

      const badAction = await call(routes, 'POST', `${API}/decisions`, {
        body: JSON.stringify({ action: 'nope', id: card.id }),
      })
      expect(badAction.status).toBe(400)
      expect(badAction.json).toMatchObject({ code: 'BAD_ACTION' })

      const missing = await call(routes, 'POST', `${API}/decisions`, {
        body: JSON.stringify({ action: 'redecide', id: 'c-nope' }),
      })
      expect(missing.status).toBe(400)
      expect(missing.json).toMatchObject({ code: 'NOT_FOUND' })

      const wrongMethod = await call(routes, 'DELETE', `${API}/decisions`)
      expect(wrongMethod.status).toBe(405)
    } finally {
      dispose()
    }
  })

  it('设置里能保存决策字段（提示词 / 开关 / 判例条数）', async () => {
    const { routes, dispose } = harness()
    try {
      const saved = await call(routes, 'POST', `${API}/settings`, {
        body: JSON.stringify({
          settings: {
            decisionEnabled: false,
            decisionPrompt: '自定义决策画像',
            decisionProvider: 'p',
            decisionModel: 'm',
            decisionPrecedentLimit: 5,
          },
        }),
      })
      expect(saved.status).toBe(200)
      const settings = (saved.json as { settings: Record<string, unknown> }).settings
      expect(settings).toMatchObject({
        decisionEnabled: false,
        decisionPrompt: '自定义决策画像',
        decisionProvider: 'p',
        decisionModel: 'm',
        decisionPrecedentLimit: 5,
      })

      const read = await call(routes, 'GET', `${API}/settings`)
      expect((read.json as { settings: Record<string, unknown> }).settings).toMatchObject({
        decisionEnabled: false,
        decisionPrompt: '自定义决策画像',
      })
    } finally {
      dispose()
    }
  })
})
