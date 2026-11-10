// 内核路由联调：批准入队、卡全景、清单、证据、对账五条路径。
//
// 这一组用例把「宿主装配 + 路由 + 内核」串起来跑，DTC_KERNEL=on 才启用新路径。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-kernel-routes-'))
process.env.DSH_HOME = HOME
process.env.DTC_TEST_KERNEL = '1'
process.env.DTC_KERNEL = 'on'
// 面板常用局域网地址访问：让来源允许列表在模块装配前就知道部署地址（与生产一致）。
process.env.DSH_PUBLIC_URL = 'http://192.168.1.4:3080'
process.env.DSH_TRUSTED_HOSTS = '192.168.1.4:3080'
// 信任栅栏只认插件自己的白名单变量（host:port 形式）。
process.env.DSH_TASK_CARDS_TRUSTED_HOSTS = '192.168.1.4:3080'

const { RecordStore, Store } = await import('../../src/host/cards/store')
const { apply } = await import('../../src/host/index')

const CARDS_FILE = path.join(HOME, 'dsh-task-cards', 'cards.json')

type Json = Record<string, unknown>
type Handler = (req: unknown, res: unknown) => Promise<unknown>

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

function request(method: string, url: string, body?: unknown, headers?: Record<string, string>) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    method,
    url,
    headers: {
      host: '127.0.0.1:13080',
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
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

const routes = new Map<string, Handler>()
const disposers: Array<() => void> = []
const seeded: Record<string, string> = {}

const ADVICE = {
  verdict: 'approve' as const,
  summary: '可以',
  options: [
    {
      name: '继续',
      cost: '1 小时',
      gain: '少走 1 步',
      worst: '白做',
      answer: '按这个方向继续',
      verdict: 'approve' as const,
    },
  ],
  chosen: 0,
  answer: '按这个方向继续',
  basis: '测试夹具',
  precedentIds: [],
  confidence: 'normal' as const,
  question: '',
  autoApply: false,
  applied: false,
  lane: 'decision' as const,
  at: 1_700_000_000_000,
}

beforeAll(async () => {
  const store = new Store(CARDS_FILE)
  for (const [key, title, sessionId] of [
    ['primary', '跑测试并提交 feat/scheduler 分支', 's-7d31'],
    ['overview', '全景卡', 's-1'],
    ['todo', '清单卡', 's-2'],
    ['evidence', '证据卡', 's-3'],
  ] as const) {
    const card = await store.create(title, {
      kind: 'decision',
      source: 'agent',
      origin: { sessionId, turn: 1 },
    })
    await store.patch(card.id, { advice: ADVICE }, 'seed')
    seeded[key] = card.id
  }

  const ctx: Record<string, unknown> = {
    webServer: {
      register(route: { path: string; handler: Handler }) {
        routes.set(route.path, route.handler)
        const dispose = () => routes.delete(route.path)
        disposers.push(dispose)
        return dispose
      },
    },
    get() {
      return undefined
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
})

afterAll(() => {
  for (const fn of disposers) fn()
  delete process.env.DTC_KERNEL
})

let panelToken = ''

async function call(method: string, url: string, body?: unknown, headers?: Record<string, string>) {
  const handler = routes.get(url.split('?')[0] as string)
  expect(handler, `路由未注册：${url}`).toBeTruthy()
  const res = response()
  await handler?.(request(method, url, body, headers), res)
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as Json) : null }
}

async function ensurePanelToken(_routes?: Map<string, Handler>): Promise<string> {
  if (panelToken) return panelToken
  const { issuePanelToken } = await import('../../src/host/routes/auth')
  panelToken = issuePanelToken({
    headers: {
      origin: 'http://127.0.0.1:13080',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0',
    },
  }).token
  return panelToken
}

/** 特权写（approve/deny/reopen/todo done/freeze/settings/evidence）要带面板令牌。 */
async function privileged(method: string, url: string, body?: unknown) {
  const token = await ensurePanelToken()
  return call(method, url, body, {
    origin: 'http://127.0.0.1:13080',
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0',
    'x-panel-token': token,
  })
}

describe('内核路由', () => {
  it('批准进入队列：返回 queued，卡进入 waiting（不直接投递）', async () => {
    const result = await privileged('POST', '/dsh-task-cards/api/action', {
      id: seeded.primary,
      action: 'approve',
    })
    if (result.status !== 200) console.error('approve failed', result.json)
    expect(result.status).toBe(200)
    expect(result.json?.pushed).toBe(false)
    expect(result.json?.reason).toBe('queued')
    const patched = (result.json?.card as Json) ?? {}
    expect(patched.deliveryState).toBe('waiting')
    expect(patched.decisionSeq).toBe(1)
    expect(patched.answer).toBe('按这个方向继续')
    // 生命周期单一真源：入队即离开「要我决策」车道，status 与投递状态一次写完。
    expect(patched.status).toBe('done')
  })

  it('同一张卡再批准一次 → 拒绝（幂等，避免重复投递）', async () => {
    const again = await privileged('POST', '/dsh-task-cards/api/action', {
      id: seeded.primary,
      action: 'approve',
    })
    expect(again.status).toBe(400)
    expect(again.json?.code).toBe('ALREADY_APPROVED')
  })

  it('重开一张已入队的卡：投递状态退回 idle，status 重新打开', async () => {
    const reopened = await privileged('POST', '/dsh-task-cards/api/action', {
      id: seeded.primary,
      action: 'reopen',
    })
    expect(reopened.status).toBe(200)
    const card = (reopened.json?.card as Json) ?? {}
    expect(card.deliveryState).toBe('idle')
    expect(card.status).toBe('open')
    // 重开之后必须还能重新批准（幂等闸门只看投递状态，不看 status）。
    const again = await privileged('POST', '/dsh-task-cards/api/action', {
      id: seeded.primary,
      action: 'approve',
    })
    expect(again.status).toBe(200)
    expect((again.json?.card as Json)?.deliveryState).toBe('waiting')
  })

  it('已落 unknown 的卡再批准 → 400 ALREADY_APPROVED（事故 2 的形状）', async () => {
    const store = new Store(CARDS_FILE)
    await store.patch(seeded.primary, { deliveryState: 'unknown' }, 'test-unknown')
    const again = await privileged('POST', '/dsh-task-cards/api/action', {
      id: seeded.primary,
      action: 'approve',
    })
    expect(again.status).toBe(400)
    expect(again.json?.code).toBe('ALREADY_APPROVED')
  })

  it('已失效（invalidated）的卡批准 → 400 ALREADY_APPROVED', async () => {
    const store = new Store(CARDS_FILE)
    const card = await store.create('已经失效的卡', {
      kind: 'decision',
      source: 'agent',
      origin: { sessionId: 's-9' },
    })
    await store.patch(card.id, { deliveryState: 'invalidated', status: 'dismissed' }, 'test')
    const result = await privileged('POST', '/dsh-task-cards/api/action', {
      id: card.id,
      action: 'approve',
    })
    expect(result.status).toBe(400)
    expect(result.json?.code).toBe('ALREADY_APPROVED')
  })

  it('记录屏能看到「观察跳过」：records.json 的 skipped 并进 /records', async () => {
    const records = new RecordStore(path.join(HOME, 'dsh-task-cards', 'records.json'))
    await records.add({
      phase: 'observer',
      status: 'skipped',
      originSessionId: 's-skip',
      error: '没有轮次触发器',
      skipReason: '没有轮次触发器',
    } as never)
    const result = await call('GET', '/dsh-task-cards/api/records?limit=50')
    expect(result.status).toBe(200)
    const rows = (result.json?.records as Json[]) ?? []
    const skipped = rows.find((row) => row.phase === 'observe')
    expect(skipped).toBeTruthy()
    expect(String(skipped?.reason)).toContain('没有轮次触发器')
  })

  it('P0-4：/evidence 拒绝外部任意命令（checks/cmd）→ 403 PLAN_BOUND', async () => {
    const result = await call('POST', '/dsh-task-cards/api/evidence', {
      caseId: seeded.primary,
      checks: [{ kind: 'exit', cmd: 'rm -rf /tmp/x', expect: 0 }],
    })
    expect(result.status).toBe(403)
    expect(String(result.json?.code)).toBe('PLAN_BOUND')
  })

  it('P0-4：未批准（没有 planId）的卡不能按计划收证据 → 403', async () => {
    const result = await call('POST', '/dsh-task-cards/api/evidence', {
      caseId: seeded.primary,
      planId: 'fake-plan',
    })
    expect(result.status).toBe(403)
    expect(String(result.json?.code)).toBe('PLAN_MISMATCH')
  })

  it('P0-4：批准时冻结 planId/nonce；按 planId 收集证据成功且带 level=E2/sourceRef', async () => {
    const store = new Store(CARDS_FILE)
    const card = await store.create('带验收计划的卡', {
      kind: 'decision',
      source: 'agent',
      origin: { sessionId: 's-9' },
      acceptance: [
        {
          id: 'a1',
          level: 'E2',
          spec: { kind: 'file', path: 'src/shared/contract.ts', expect: 'exists' },
        },
      ],
    })
    const approved = await privileged('POST', '/dsh-task-cards/api/action', {
      id: card.id,
      action: 'approve',
    })
    expect(approved.status).toBe(200)
    const frozen = new Store(CARDS_FILE).find(card.id)
    expect(frozen?.planId).toBeTruthy()

    const token = await ensurePanelToken()
    const collected = await call(
      'POST',
      '/dsh-task-cards/api/evidence',
      { caseId: card.id, planId: frozen?.planId },
      {
        origin: 'http://127.0.0.1:13080',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0',
        'x-panel-token': token,
      },
    )
    expect(collected.status, `token=${JSON.stringify(token)}`).toBe(200)
    const records = (collected.json?.records as Array<Record<string, unknown>>) ?? []
    expect(records).toHaveLength(1)
    expect(records[0]?.level).toBe('E2')
    expect(String(records[0]?.sourceRef)).toContain(frozen?.planId)
    expect(records[0]?.ok).toBe(true)
  })

  it('P0-4：todo done/freeze 是特权写：无令牌 403，有令牌（人操作）才 200', async () => {
    const store = new Store(CARDS_FILE)
    const card = await store.create('执行者的清单', {
      kind: 'decision',
      origin: { sessionId: 's-9' },
    })
    await call('POST', '/dsh-task-cards/api/todo', {
      caseId: card.id,
      actor: 'user',
      ops: [{ type: 'add', id: 't1', text: '跑测试' }],
    })
    // 客户端自称 actor=user 不算数：没有面板令牌一律 403
    const forged = await call('POST', '/dsh-task-cards/api/todo', {
      caseId: card.id,
      actor: 'user',
      ops: [{ type: 'update', id: 't1', status: 'done' }, { type: 'freeze' }],
    })
    expect(forged.status).toBe(403)
    // 无令牌请求通常先被来源校验拦下（PANEL_ORIGIN_REJECTED）；两者都属于 403。
    expect(['PANEL_TOKEN_REQUIRED', 'PANEL_ORIGIN_REJECTED']).toContain(String(forged.json?.code))

    const allowed = await privileged('POST', '/dsh-task-cards/api/todo', {
      caseId: card.id,
      actor: 'user',
      ops: [{ type: 'freeze' }],
    })
    expect(allowed.status).toBe(200)
  })

  it('P0-2：presence 发令牌端点自防——无 Origin / 脚本 UA 一律 403', async () => {
    const noOrigin = await call('POST', '/dsh-task-cards/api/presence', {
      sessionId: 's-x',
      active: true,
    })
    expect(noOrigin.status).toBe(403)
    expect(String(noOrigin.json?.code)).toBe('PANEL_ORIGIN_REJECTED')

    const scriptUa = await call(
      'POST',
      '/dsh-task-cards/api/presence',
      { sessionId: 's-x', active: true },
      { origin: 'http://127.0.0.1:13080', 'user-agent': 'curl/8.5.0' },
    )
    expect(scriptUa.status).toBe(403)
    expect(String(scriptUa.json?.code)).toBe('PANEL_BROWSER_REQUIRED')
  })

  it('P0-2：来源允许列表含部署实际地址（局域网面板可用），非信任来源拒绝', async () => {
    process.env.DSH_PUBLIC_URL = 'http://192.168.1.4:3080'
    const { originAllowed } = await import('../../src/host/routes/auth')
    expect(originAllowed('http://192.168.1.4:3080')).toBe(true)
    expect(originAllowed('http://127.0.0.1:3080')).toBe(true)
    expect(originAllowed('http://evil.example.com')).toBe(false)
    expect(originAllowed('')).toBe(false)
  })

  it('P0-A/C：GET /cards 不暴露令牌字段（planNonce 已删除）', async () => {
    const result = await call('GET', '/dsh-task-cards/api/cards')
    expect(result.status).toBe(200)
    expect(JSON.stringify(result.json)).not.toContain('planNonce')
    expect(JSON.stringify(result.json)).not.toContain('panelToken')
  })

  it('P0-B：/case 返回 delegated verdicts（审计可读 authority/policyVersion/confidence）', async () => {
    const store = new Store(CARDS_FILE)
    const card = await store.create('带 verdict 的卡', {
      kind: 'decision',
      origin: { sessionId: 's-v' },
    })
    const { PlansStore } = await import('../../src/host/plans/store')
    // 与运行时同一数据目录：$DSH_HOME/dsh-task-cards/plans.json
    const plans = new PlansStore(path.join(HOME, 'dsh-task-cards', 'plans.json'))
    await plans.recordVerdict({
      id: 'v-1',
      cardId: card.id,
      decisionSeq: 1,
      actor: 'secretary',
      actorType: 'secretary',
      authority: 'delegated',
      policyVersion: 3,
      channel: 'system',
      decision: 'approve',
      rationale: 'reversible+precedent+high-confidence',
      confidence: 0.95,
      evidenceRefs: ['p-1'],
      at: Date.now(),
    })
    const result = await call('GET', `/dsh-task-cards/api/case?id=${card.id}`)
    expect(result.status).toBe(200)
    const verdicts = (result.json?.verdicts as Array<Record<string, unknown>>) ?? []
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]?.authority).toBe('delegated')
    expect(verdicts[0]?.policyVersion).toBe(3)
    expect(verdicts[0]?.confidence).toBe(0.95)
    expect(verdicts[0]?.rationale).toBeTruthy()
    expect(verdicts[0]?.evidenceRefs).toEqual(['p-1'])
  })

  it('卡全景：事件流、清单、证据一次返回', async () => {
    await privileged('POST', '/dsh-task-cards/api/action', {
      id: seeded.overview,
      action: 'approve',
    })
    const result = await call('GET', `/dsh-task-cards/api/case?id=${seeded.overview}`)
    expect(result.status).toBe(200)
    const events = (result.json?.events as Json[]) ?? []
    expect(events.length).toBeGreaterThan(0)
    expect(events[0]?.caseId).toBe(seeded.overview)
    expect(result.json?.badLines).toBe(0)
  })

  it('Todo：加项 + 冻结，读回基线', async () => {
    const added = await privileged('POST', '/dsh-task-cards/api/todo', {
      caseId: seeded.todo,
      actor: 'user',
      ops: [
        { type: 'add', id: 't1', text: '跑测试' },
        { type: 'add', id: 't2', text: '提交' },
        { type: 'freeze' },
      ],
    })
    expect(added.status).toBe(200)
    const todo = added.json?.todo as Json
    expect(todo?.frozen).toBe(true)
    expect(todo?.baselineIds).toEqual(['t1', 't2'])
  })

  it('证据：按冻结的 acceptance 收集并返回 ok（不接受外部 checks）', async () => {
    const store = new Store(CARDS_FILE)
    const card = await store.create('证据卡', {
      kind: 'decision',
      source: 'agent',
      origin: { sessionId: 's-ev' },
      acceptance: [
        {
          id: 'a1',
          level: 'E2',
          spec: { kind: 'file', path: 'src/shared/case.ts', expect: 'exists' },
        },
      ],
    })
    await privileged('POST', '/dsh-task-cards/api/action', { id: card.id, action: 'approve' })
    const frozen = new Store(CARDS_FILE).find(card.id)
    const token = await ensurePanelToken()
    const result = await call(
      'POST',
      '/dsh-task-cards/api/evidence',
      { caseId: card.id, planId: frozen?.planId },
      {
        origin: 'http://127.0.0.1:13080',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0',
        'x-panel-token': token,
      },
    )
    expect(result.status).toBe(200)
    const records = (result.json?.records as Json[]) ?? []
    expect(records).toHaveLength(1)
    expect(records[0]?.ok).toBe(true)
    expect(records[0]?.caseId).toBe(card.id)
  })

  it('验收路由：不在 executed 的卡返回 400', async () => {
    const result = await call('POST', '/dsh-task-cards/api/verify', { caseId: seeded.evidence })
    expect(result.status).toBe(400)
    expect(result.json?.code).toBe('NOT_EXECUTED')
  })

  it('进度：返回清单完成度摘要', async () => {
    await privileged('POST', '/dsh-task-cards/api/todo', {
      caseId: seeded.todo,
      actor: 'user',
      ops: [
        { type: 'add', id: 'p1', text: '跑测试' },
        { type: 'update', id: 'p1', status: 'done' },
        { type: 'add', id: 'p2', text: '提交' },
        { type: 'freeze' },
      ],
    })
    const result = await call('GET', '/dsh-task-cards/api/progress')
    expect(result.status).toBe(200)
    const progress = (result.json?.progress as Record<string, Json>) ?? {}
    expect(progress[seeded.todo]).toMatchObject({ done: 1, frozen: true })
    expect((progress[seeded.todo] as Json)?.total).toBeGreaterThanOrEqual(2)
  })

  it('记录：返回跨卡事件，且带 traceId', async () => {
    const result = await call('GET', '/dsh-task-cards/api/records?limit=20')
    expect(result.status).toBe(200)
    const records = (result.json?.records as Json[]) ?? []
    expect(records.length).toBeGreaterThan(0)
    expect(typeof records[0]?.traceId).toBe('string')
    expect(typeof result.json?.truncated).toBe('boolean')
  })

  it('对账：接口可跑并返回统计', async () => {
    const result = await call('POST', '/dsh-task-cards/api/reconcile')
    expect(result.status).toBe(200)
    expect(typeof result.json?.scanned).toBe('number')
    expect(Array.isArray(result.json?.invalidated)).toBe(true)
  })
})
