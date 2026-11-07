import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Advice, Card } from '../../src/shared/contract'

// 必须在 import 插件之前改 DSH_HOME：store 在加载时算数据路径。
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-approve-'))
process.env.DSH_HOME = HOME

const { apply } = await import('../../src/host/index')
const { Store } = await import('../../src/host/cards/store')

const API = '/dsh-task-cards/api'
const CARDS_FILE = path.join(HOME, 'dsh-task-cards', 'cards.json')
const DATA_DIR = path.join(HOME, 'dsh-task-cards')

type Json = Record<string, unknown>
type Handler = (req: unknown, res: unknown) => Promise<unknown>

interface PromptCall {
  sessionId: string
  text: string
}

/** 投递通道的三种状态：能推、推的时候报错、宿主根本没有 sessionController。 */
type PromptMode = 'ok' | 'throw' | 'missing'

interface Harness {
  routes: Map<string, Handler>
  prompts: PromptCall[]
  dispose: () => void
}

function harness(mode: PromptMode = 'ok'): Harness {
  const routes = new Map<string, Handler>()
  const prompts: PromptCall[] = []
  const disposers: Array<() => void> = []
  const ctx: Record<string, unknown> = {
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
  }
  if (mode !== 'missing') {
    ctx.sessionController = {
      async prompt(request: { sessionId: string; content: Array<{ text: string }> }) {
        if (mode === 'throw') throw new Error('目标会话已经结束')
        prompts.push({
          sessionId: request.sessionId,
          text: request.content.map((block) => block.text).join('\n'),
        })
        return { ok: true }
      },
    }
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
    prompts,
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

const ADVICE: Advice = {
  verdict: 'approve',
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
  chosen: 1,
  autoApply: true,
  confidence: 'normal',
  question: '',
  lane: 'decision',
  applied: false,
  at: Date.now(),
}

async function seedCard(
  title: string,
  extra: Record<string, unknown> = {},
  advice: Advice | null = null,
): Promise<Card> {
  const store = new Store(CARDS_FILE)
  const card = await store.create(title, { kind: 'decision', ...extra })
  if (!advice) return card
  return store.patch(card.id, { advice }, 'advised')
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

describe('批红 = 把话推回原会话', () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true })
  })

  it('有会话：推推荐方案的 answer，卡变 done 并落一条判例', async () => {
    const card = await seedCard('要不要重做登录页', { origin: { sessionId: 's-approve' } }, ADVICE)
    const { routes, prompts, dispose } = harness('ok')
    try {
      const res = await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: card.id, action: 'approve' }),
      })
      expect(res.status).toBe(200)
      expect(res.json).toMatchObject({ ok: true, pushed: true })

      // 推的是 advice.chosen（1）那句，并且推给了 origin.sessionId
      expect(prompts).toHaveLength(1)
      expect(prompts[0]?.sessionId).toBe('s-approve')
      expect(prompts[0]?.text).toContain('直接重构整个登录页')
      expect(prompts[0]?.text).toContain(card.id)

      const after = findCard(await listCards(routes), card.id)
      expect(after?.status).toBe('done')
      expect(after?.answer).toBe('直接重构整个登录页')
      expect(after?.answeredVia).toBe('card')
      expect(after?.answeredAt).toBeTypeOf('number')
      expect(after?.events.map((event) => event.type)).toContain('approved')

      const precedents = await listPrecedents(routes)
      expect(precedents).toHaveLength(1)
      expect(precedents[0]).toMatchObject({
        cardId: card.id,
        choice: '直接重构整个登录页',
        outcome: 'unknown',
      })
    } finally {
      dispose()
    }
  })

  it('没有 origin.sessionId：照样结束卡，返回 pushed:false 且不落判例', async () => {
    const card = await seedCard('要不要上线', {}, ADVICE)
    const { routes, prompts, dispose } = harness('ok')
    try {
      const res = await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: card.id, action: 'approve' }),
      })
      expect(res.status).toBe(200)
      expect(res.json).toMatchObject({ ok: true, pushed: false, reason: 'no-session' })
      expect(prompts).toHaveLength(0)

      const after = findCard(await listCards(routes), card.id)
      expect(after?.status).toBe('done')
      expect(after?.answeredVia).toBeUndefined()
      expect(after?.events.map((event) => event.type)).toContain('approved:no-session')
      expect(await listPrecedents(routes)).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  it('投递失败：卡不能卡死，返回 pushed:false 并留 approved:failed', async () => {
    const card = await seedCard('要不要删旧表', { origin: { sessionId: 's-dead' } }, ADVICE)
    const { routes, dispose } = harness('throw')
    try {
      const res = await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: card.id, action: 'approve' }),
      })
      expect(res.status).toBe(200)
      expect(res.json).toMatchObject({ ok: true, pushed: false })
      expect(String(res.json?.reason)).toContain('已经结束')

      const after = findCard(await listCards(routes), card.id)
      expect(after?.status).toBe('done')
      // 决定留在卡上，但不冒充「回给原会话了」
      expect(after?.answer).toBe('直接重构整个登录页')
      expect(after?.answeredVia).toBeUndefined()
      expect(after?.events.map((event) => event.type)).toEqual(
        expect.arrayContaining(['advised', 'approved:failed']),
      )
      // 没推进会话的批准不算他定过，不落判例
      expect(await listPrecedents(routes)).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  it('文本优先级：body.option 最高；票拟与旧回答都没有时用兜底模板', async () => {
    const explicit = await seedCard('要不要加缓存', { origin: { sessionId: 's-a' } }, ADVICE)
    const bare = await seedCard('要不要改配色', { origin: { sessionId: 's-b' } })
    const { routes, prompts, dispose } = harness('ok')
    try {
      await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: explicit.id, action: 'approve', option: '照第 3 版做' }),
      })
      expect(prompts[0]?.text).toContain('照第 3 版做')

      await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: bare.id, action: 'approve' }),
      })
      expect(prompts[1]?.text).toContain('已批准：要不要改配色。按这个方向继续。')

      const after = findCard(await listCards(routes), bare.id)
      expect(after?.answer).toBe('已批准：要不要改配色。按这个方向继续。')
    } finally {
      dispose()
    }
  })

  it('info 卡的「知道了」仍是 acknowledge，不投递', async () => {
    const store = new Store(CARDS_FILE)
    const card = await store.create('跑完了', { kind: 'info', origin: { sessionId: 's-info' } })
    const { routes, prompts, dispose } = harness('ok')
    try {
      const res = await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: card.id, action: 'acknowledge' }),
      })
      expect(res.status).toBe(200)
      expect(prompts).toHaveLength(0)
      const after = findCard(await listCards(routes), card.id)
      expect(after?.status).toBe('acknowledged')
    } finally {
      dispose()
    }
  })
})

describe('许可 / 澄清卡', () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true })
  })

  const PERMISSION: Advice = {
    ...ADVICE,
    ask: 'permission',
    effect: 'write-code',
    requires: ['session.reply'],
    action: 'git commit -m "test"',
    scope: 'src/**',
    reversible: true,
    options: [],
  }

  it('许可卡批准：推固定模板，动作和范围都在句子里', async () => {
    const card = await seedCard(
      '提交改动',
      { origin: { sessionId: 's-perm' }, ask: 'permission' },
      PERMISSION,
    )
    const { routes, prompts, dispose } = harness('ok')
    try {
      const res = await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: card.id, action: 'approve' }),
      })
      expect(res.status).toBe(200)
      expect(prompts[0]?.text).toContain('已允许：git commit -m "test"')
      expect(prompts[0]?.text).toContain('范围：src/**')
      const after = findCard(await listCards(routes), card.id)
      expect(after?.status).toBe('done')
    } finally {
      dispose()
    }
  })

  it('许可卡拒绝：推「不允许」模板，卡结束并落一条判例', async () => {
    const card = await seedCard(
      '拒绝提交',
      { origin: { sessionId: 's-deny' }, ask: 'permission' },
      PERMISSION,
    )
    const { routes, prompts, dispose } = harness('ok')
    try {
      const res = await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: card.id, action: 'deny' }),
      })
      expect(res.status).toBe(200)
      expect(res.json).toMatchObject({ ok: true, pushed: true })
      expect(prompts[0]?.text).toContain('不允许：git commit -m "test"')
      const after = findCard(await listCards(routes), card.id)
      expect(after?.status).toBe('done')
      expect(await listPrecedents(routes)).toHaveLength(1)
    } finally {
      dispose()
    }
  })

  it('澄清卡作答：把问题和补充值拼成一句发回去', async () => {
    const card = await seedCard(
      '是哪张卡',
      { origin: { sessionId: 's-clar' }, ask: 'clarification' },
      {
        ...ADVICE,
        ask: 'clarification',
        question: '你指的是哪张卡？',
        candidates: ['c-1'],
        effect: 'read',
      },
    )
    const { routes, prompts, dispose } = harness('ok')
    try {
      const res = await call(routes, 'POST', `${API}/action`, {
        body: JSON.stringify({ id: card.id, action: 'answer', option: 'c-1' }),
      })
      expect(res.status).toBe(200)
      expect(prompts[0]?.text).toContain('补充信息：c-1')
      expect(prompts[0]?.text).toContain('你指的是哪张卡？')
      const after = findCard(await listCards(routes), card.id)
      expect(after?.status).toBe('done')
    } finally {
      dispose()
    }
  })
})
