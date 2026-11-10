// 面板组件测试：真实渲染 Panel，fetch 换成受控的假后端。
// 这里验的是「用户看到什么 / 点了发什么」，不是实现细节。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Panel } from '../../src/client/components/Panel'
import { DICT } from '../../src/client/locale'
import type { Advice, Card, ObserverRecord, Precedent, Settings } from '../../src/client/types'

const zh = DICT.zh as Record<string, string>

/** 与宿主 locale.bind 同形状：键 + {占位符}。 */
function translate(key: string, vars?: Record<string, string | number>): string {
  const template = zh[key] ?? key
  return vars
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match))
    : template
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c-1',
    title: '登录页空态要补',
    detail: '',
    kind: 'info',
    severity: 'normal',
    status: 'open',
    action: null,
    dueAt: null,
    source: 'human',
    interaction: 'reply',
    question: null,
    origin: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    silent: false,
    events: [],
    ...overrides,
  } as Card
}

const SETTINGS: Settings = {
  enabled: true,
  systemPrompt: '只输出 JSON',
  provider: '',
  model: '',
  minReplyChars: 120,
  includeSubagents: false,
  maxInputBytes: 16000,
  timeoutMs: 60000,
  decisionEnabled: true,
  decisionPrompt: '',
  decisionProvider: '',
  decisionModel: '',
  decisionPrecedentLimit: 30,
  decisionAutoApply: true,
  autoApproveDiagnostics: false,
  autoDecide: true,
  fallbackObserve: true,
  receiptTimeoutMs: 180000,
  turnGate: 'high-risk',
}

/** 一张完整的票拟：两个方案、一条被引用的判例，推荐第一个且可自动执行。 */
const ADVICE: Advice = {
  verdict: 'modify',
  summary: '先跑通最小验证',
  options: [
    {
      name: 'A: 最小验证',
      cost: '半天',
      gain: '少走 2 步',
      worst: '验证结论不成立',
      answer: '先只做最小验证',
      verdict: 'modify',
    },
    {
      name: 'B: 完整重构',
      cost: '三天',
      gain: '以后每次少走 4 步',
      worst: '方案被推翻',
      answer: '按完整重构开工',
      verdict: 'approve',
    },
  ],
  basis: 'P-002 返工过，不算准绳',
  precedentIds: ['P-002'],
  confidence: 'high',
  question: '这次改动能不能撤回？',
  chosen: 0,
  autoApply: true,
  lane: 'decision',
  applied: false,
  at: Date.now(),
}

const PRECEDENTS: Precedent[] = [
  {
    id: 'P-002',
    at: Date.now() - 86_400_000,
    cardId: 'c-old',
    title: '旧表下线',
    question: '现在拆吗',
    choice: '先跑通最小验证',
    outcome: 'reworked',
    note: '验证没跑通就开工',
    keywords: ['迁移'],
  },
  {
    id: 'P-003',
    at: Date.now() - 172_800_000,
    cardId: 'c-old-2',
    title: '换构建工具',
    question: '换不换',
    choice: '不换',
    outcome: 'valid',
    note: '',
    keywords: ['构建'],
  },
]

/** 决策代理人的执行记录：一条成功、一条失败，外加一条观察者记录（不该出现在决策页）。 */
const _RECORDS: ObserverRecord[] = [
  {
    id: 'r-2',
    at: Date.now() - 60_000,
    phase: 'decision',
    status: 'ok',
    model: 'deepseek-chat',
    durationMs: 2400,
    cardsCreated: 3,
    applied: 1,
    corrected: 2,
  },
  {
    id: 'r-1',
    at: Date.now() - 3_600_000,
    phase: 'decision',
    status: 'error',
    model: 'deepseek-chat',
    durationMs: 500,
    error: '429 rate limited',
  },
  {
    id: 'r-0',
    at: Date.now() - 7_200_000,
    phase: 'observer',
    status: 'ok',
    cardsCreated: 9,
  },
]

interface Calls {
  method: string
  url: string
  body: unknown
}

interface StubOptions {
  cards?: Card[]
  settings?: Settings
  precedents?: Precedent[]
  records?: ObserverRecord[]
  /** /action 的额外回包字段：approve 的 pushed/reason。 */
  action?: { pushed?: boolean; reason?: string }
}

/** 一个够用的假后端：只认面板会打的几个端点。 */
function stubApi(options: StubOptions = {}) {
  const calls: Calls[] = []
  const cards = options.cards ?? []
  const settings = options.settings ?? SETTINGS
  const precedents = options.precedents ?? PRECEDENTS
  const records = options.records ?? []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method || 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    const json = (payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })

    if (url.endsWith('/api/cards') && method === 'GET')
      return json({ ok: true, cards, warning: null })
    if (url.endsWith('/api/cards') && method === 'POST')
      return json({
        ok: true,
        card: card({ id: 'c-new', title: String(body?.title ?? ''), kind: 'info' }),
      })
    if (url.endsWith('/api/action')) {
      const id = String(body?.id ?? '')
      const action = String(body?.action ?? '')
      const status =
        action === 'complete' || action === 'adopt' || action === 'approve'
          ? 'done'
          : action === 'acknowledge'
            ? 'acknowledged'
            : action === 'dismiss'
              ? 'dismissed'
              : 'open'
      return json({ ok: true, card: card({ id, status }), ...(options.action || {}) })
    }
    if (url.endsWith('/api/decisions') && method === 'GET')
      return json({ ok: true, precedents, records })
    if (url.endsWith('/api/decisions') && method === 'POST') return json({ ok: true })
    if (url.endsWith('/api/settings') && method === 'GET') return json({ ok: true, settings })
    if (url.endsWith('/api/settings') && method === 'POST')
      return json({ ok: true, settings: { ...settings, ...(body?.settings || {}) } })
    if (url.includes('/api/models'))
      return json({
        ok: true,
        groups: [{ provider: 'deepseek', models: [{ id: 'm', name: 'M' }] }],
      })
    if (url.includes('/api/titles')) return json({ ok: true, titles: {} })
    if (url.includes('/api/timeline')) return json({ ok: true, title: '会话', turns: [] })
    if (url.endsWith('/api/presence')) return json({ ok: true })
    if (url.endsWith('/api/progress')) return json({ ok: true, progress: {} })
    if (url.includes('/api/case')) return json({ ok: true, events: [], todo: null, evidence: [] })
    if (url.includes('/api/records'))
      return json({
        ok: true,
        truncated: false,
        records: [
          {
            id: 'r-1',
            caseId: 'c-1',
            traceId: 'trace-1',
            at: Date.now(),
            phase: 'verify',
            from: 'verifying',
            to: 'confirmed',
            actor: 'verifier',
            reason: 'exit 0',
          },
        ],
      })
    if (url.endsWith('/api/reconcile')) return json({ ok: true, scanned: 0, invalidated: [] })
    return new Response(JSON.stringify({ ok: false, error: `未处理的请求 ${url}` }), {
      status: 404,
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('面板（七屏）', () => {
  it('默认落在工作台：五个 KPI、卡片、阶段徽标', async () => {
    stubApi({
      cards: [
        card({ id: 'c-1', title: '待决的卡', deliveryState: 'waiting', kind: 'decision' }),
        card({ id: 'c-2', title: '执行中的卡', deliveryState: 'dispatched', kind: 'auto' }),
      ],
    })
    render(<Panel t={translate} />)
    await screen.findByText('待决的卡')
    expect(screen.getAllByText(zh.kpiPending as string).length).toBeGreaterThan(0)
    expect(screen.getAllByText(zh.kpiAttention as string).length).toBeGreaterThan(0)
    expect(screen.getAllByText(zh.stageRunning as string).length).toBeGreaterThan(0)
  })

  it('没有卡时显示空态文案', async () => {
    stubApi({ cards: [] })
    render(<Panel t={translate} />)
    expect(await screen.findByText(zh.emptyAll as string)).toBeTruthy()
  })

  it('最前面是等我处理的那条，不是刚生成的那条', async () => {
    stubApi({
      cards: [
        card({
          id: 'c-done',
          title: '已经处理完的决策',
          status: 'done',
          deliveryState: 'confirmed',
        }),
        // 待拍板 = 还没进执行链路（idle + open）；waiting 是已批准排队，由生命周期映射收成已结束。
        card({ id: 'c-wait', title: '等我拍板的决策', kind: 'decision', deliveryState: 'idle' }),
      ],
    })
    const { container } = render(<Panel t={translate} />)
    await screen.findByText('等我拍板的决策')
    const texts = [...container.querySelectorAll('.dtc-text')].map((node) => node.textContent)
    expect(texts[0]).toBe('等我拍板的决策')
    expect(texts[texts.length - 1]).toBe('已经处理完的决策')
  })

  it('失败卡行内给「重开」，不再显示「已批准，执行中」chip、也没有「批准」', async () => {
    stubApi({
      cards: [
        card({
          id: 'c-fail',
          title: '失败待处置',
          kind: 'decision',
          status: 'done',
          deliveryState: 'failed',
        }),
      ],
    })
    render(<Panel t={translate} />)
    await screen.findByText('失败待处置')
    const reopen = screen.getByRole('button', { name: zh.reopen as string })
    expect(reopen).toBeTruthy()
    expect(screen.queryByText(zh.approveInFlight as string)).toBeNull()
    expect(screen.queryByRole('button', { name: zh.approve as string })).toBeNull()
  })

  it('多问题卡逐题分组：每题选一个、全选完才可提交，提交体带 answers', async () => {
    const { calls } = stubApi({
      cards: [
        card({
          id: 'c-q',
          title: '三个问题等你定',
          kind: 'decision',
          interaction: 'question',
          question: {
            sessionId: 's-q',
            items: [
              { id: 'q1', question: '用哪个数据库', options: ['SQLite', 'Postgres'] },
              { id: 'q2', question: '部署到哪', options: ['本机', 'NAS'] },
            ],
          },
        }),
      ],
    })
    render(<Panel t={translate} />)
    await screen.findByText('三个问题等你定')
    // 逐题分组：两道题的问题文本都在，选项不会被平铺成一个列表
    expect(screen.getByText('用哪个数据库')).toBeTruthy()
    expect(screen.getByText('部署到哪')).toBeTruthy()
    const submit = screen.getByRole('button', { name: zh.answerSubmit as string })
    expect(submit.hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Postgres' }))
    expect(submit.hasAttribute('disabled')).toBe(true) // 还差第二题
    fireEvent.click(screen.getByRole('button', { name: 'NAS' }))
    expect(submit.hasAttribute('disabled')).toBe(false)

    fireEvent.click(submit)
    await waitFor(() => {
      const call = calls.find((item) => item.url.endsWith('/api/action'))
      const body = call?.body as {
        action?: string
        answers?: Array<{ id: string; selected: string[] }>
      }
      expect(body?.action).toBe('answer')
      expect(body?.answers).toEqual([
        { id: 'q1', selected: ['Postgres'] },
        { id: 'q2', selected: ['NAS'] },
      ])
    })
  })

  it('决策卡点「批准」发出 approve，并说出「已推回原会话」', async () => {
    const { calls } = stubApi({
      cards: [card({ id: 'c-9', title: '要批的卡', kind: 'decision', deliveryState: 'idle' })],
    })
    render(<Panel t={translate} />)
    await screen.findByText('要批的卡')
    fireEvent.click(screen.getByRole('button', { name: zh.approve as string }))
    await waitFor(() => {
      const call = calls.find((item) => item.url.endsWith('/api/action'))
      expect((call?.body as { action?: string })?.action).toBe('approve')
    })
    expect(await screen.findByText(zh.approvePushed as string)).toBeTruthy()
  })

  it('手写一条卡：POST /cards 并清空输入', async () => {
    const { calls } = stubApi({ cards: [] })
    render(<Panel t={translate} />)
    const input = await screen.findByPlaceholderText(zh.placeholder as string)
    fireEvent.change(input, { target: { value: '记一件事' } })
    fireEvent.click(screen.getByRole('button', { name: zh.add as string }))
    await waitFor(() => {
      const call = calls.find((item) => item.url.endsWith('/api/cards') && item.method === 'POST')
      expect((call?.body as { title?: string })?.title).toBe('记一件事')
    })
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('点「查看详情」切到详情屏：五段在，返回回到工作台', async () => {
    stubApi({
      cards: [card({ id: 'c-9', title: '要批的卡', kind: 'decision', deliveryState: 'failed' })],
    })
    render(<Panel t={translate} />)
    await screen.findByText('要批的卡')
    fireEvent.click(screen.getByRole('button', { name: zh.detail as string }))
    expect(await screen.findByText(zh.segDecide as string)).toBeTruthy()
    for (const key of ['segPlan', 'segTodo', 'segRun', 'segVerify']) {
      expect(screen.getByText(zh[key] as string)).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: zh.backToWorkbench as string }))
    expect(await screen.findByText(zh.viewSession as string)).toBeTruthy()
  })

  it('详情屏采纳票拟：POST action=adopt, option=0', async () => {
    const { calls } = stubApi({
      cards: [card({ id: 'c-9', title: '要批的卡', kind: 'decision', advice: ADVICE })],
      precedents: PRECEDENTS,
    })
    render(<Panel t={translate} />)
    await screen.findByText('要批的卡')
    fireEvent.click(screen.getByRole('button', { name: zh.detail as string }))
    const adoptButtons = await screen.findAllByText(zh.adviceAdopt as string)
    fireEvent.click(adoptButtons[0] as HTMLElement)
    await waitFor(() => {
      const call = calls.find((item) => item.url.endsWith('/api/action'))
      expect((call?.body as { action?: string })?.action).toBe('adopt')
      expect((call?.body as { option?: string })?.option).toBe('0')
    })
  })

  it('记录屏能打开，列出跨卡事件', async () => {
    stubApi({ cards: [card({ id: 'c-1', title: '待决的卡' })] })
    render(<Panel t={translate} />)
    await screen.findByText('待决的卡')
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${zh.tabRecords}`) }))
    expect(await screen.findByText('exit 0')).toBeTruthy()
  })

  it('七屏页签都在', async () => {
    stubApi({ cards: [] })
    render(<Panel t={translate} />)
    await screen.findByText(zh.emptyAll as string)
    for (const key of [
      'tabWorkbench',
      'tabDetail',
      'tabFailure',
      'tabPolicy',
      'tabRecords',
      'tabSettings',
      'tabSession',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(`^${zh[key]}`) })).toBeTruthy()
    }
  })
})
