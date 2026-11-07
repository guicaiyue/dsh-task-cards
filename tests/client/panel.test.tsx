// 面板组件测试：真实渲染 Panel，fetch 换成受控的假后端。
// 这里验的是「用户看到什么 / 点了发什么」，不是实现细节。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Panel } from '../../src/client/components/Panel'
import { READ_DWELL_MS } from '../../src/client/hooks/useReadOnScreen'
import { DICT } from '../../src/client/locale'
import type { Advice, Card, ObserverRecord, Precedent, Settings } from '../../src/client/types'
import { intersectionObserverFor } from './setup'

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
const RECORDS: ObserverRecord[] = [
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

describe('面板', () => {
  it('渲染 KPI 与卡片标题，空态给出说明', async () => {
    stubApi({
      cards: [
        card({ id: 'c-1', kind: 'decision', title: '删掉旧表' }),
        card({ id: 'c-2', kind: 'info' }),
      ],
    })
    render(<Panel t={translate} />)
    await screen.findByText('删掉旧表')
    expect(screen.getByText('登录页空态要补')).toBeTruthy()
    // 决策 1 张、知晓 1 张
    const kpis = screen.getAllByText('1')
    expect(kpis.length).toBeGreaterThanOrEqual(2)
  })

  it('「要我知晓」KPI 数最近 24 小时的知晓卡，不是未读数', async () => {
    const now = Date.now()
    stubApi({
      cards: [
        card({
          id: 'c-today-1',
          kind: 'info',
          status: 'open',
          title: '今天的通知',
          createdAt: now,
        }),
        card({
          id: 'c-today-2',
          kind: 'info',
          status: 'acknowledged',
          title: '今天已读的通知',
          createdAt: now - 3_600_000,
        }),
        card({
          id: 'c-old',
          kind: 'info',
          status: 'acknowledged',
          title: '两天前的通知',
          createdAt: now - 48 * 3_600_000,
        }),
      ],
    })
    const { container } = render(<Panel t={translate} />)
    await screen.findByText('今天的通知')
    const kpis = container.querySelectorAll('.dtc-kpi')
    expect(kpis[1]?.textContent).toContain(zh.kpiInfo as string)
    expect(kpis[1]?.querySelector('.dtc-kpi-value')?.textContent).toBe('2')
  })

  it('没有卡时显示空态文案', async () => {
    stubApi({ cards: [] })
    render(<Panel t={translate} />)
    await screen.findByText(zh.emptyAll as string)
  })

  it('最前面是等我处理的那条，不是刚生成的那条', async () => {
    const now = Date.now()
    stubApi({
      cards: [
        card({
          id: 'c-done',
          kind: 'decision',
          status: 'done',
          title: '已经处理完的决策',
          createdAt: now,
          origin: { sessionId: 's-new', reason: '' },
        }),
        card({
          id: 'c-open',
          kind: 'decision',
          status: 'open',
          title: '等我拍板的决策',
          createdAt: now - 60_000,
          origin: { sessionId: 's-old', reason: '' },
        }),
        card({
          id: 'c-info',
          kind: 'info',
          status: 'open',
          title: '等我知晓的事',
          createdAt: now - 120_000,
          origin: { sessionId: 's-old', reason: '' },
        }),
      ],
    })
    const { container } = render(<Panel t={translate} />)
    await screen.findByText('等我拍板的决策')
    const texts = [...container.querySelectorAll('.dtc-text')].map((node) => node.textContent)
    expect(texts[0]).toBe('等我拍板的决策')
    expect(texts[texts.length - 1]).toBe('已经处理完的决策')
  })

  it('观察者的通知卡没有「知道了 / 忽略」，在视口里停满 2 秒才自动已读', async () => {
    const { calls } = stubApi({
      cards: [card({ id: 'c-n', kind: 'info', source: 'agent', title: '发布完成' })],
    })
    const { container } = render(<Panel t={translate} />)
    await screen.findByText('发布完成')
    expect(screen.queryByText(zh.know as string)).toBeNull()
    expect(screen.queryByText(zh.dismiss as string)).toBeNull()

    // 渲染出来不算看过：要真的在视口里。
    const row = container.querySelector('.dtc-card')
    expect(row).toBeTruthy()
    intersectionObserverFor(row as Element).enter()

    await waitFor(
      () => {
        const ack = calls.find(
          (item) =>
            item.url.endsWith('/api/action') &&
            (item.body as { action?: string } | undefined)?.action === 'acknowledge',
        )
        expect((ack?.body as { id?: string } | undefined)?.id).toBe('c-n')
      },
      { timeout: READ_DWELL_MS + 2000 },
    )
  })

  it('扫一眼就划走不算看过：不足 2 秒离开视口，不自动已读', async () => {
    const { calls } = stubApi({
      cards: [card({ id: 'c-brief', kind: 'info', source: 'agent', title: '一闪而过' })],
    })
    const { container } = render(<Panel t={translate} />)
    await screen.findByText('一闪而过')

    const observer = intersectionObserverFor(container.querySelector('.dtc-card') as Element)
    observer.enter()
    await new Promise((resolve) => setTimeout(resolve, READ_DWELL_MS / 2))
    observer.leave()
    await new Promise((resolve) => setTimeout(resolve, READ_DWELL_MS))

    expect(calls.some((item) => item.url.endsWith('/api/action'))).toBe(false)
  }, 10_000)

  it('页面不可见时不自动已读', async () => {
    const { calls } = stubApi({
      cards: [card({ id: 'c-hidden', kind: 'info', source: 'agent', title: '后台的通知' })],
    })
    const { container } = render(<Panel t={translate} />)
    await screen.findByText('后台的通知')

    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    try {
      intersectionObserverFor(container.querySelector('.dtc-card') as Element).enter()
      await new Promise((resolve) => setTimeout(resolve, READ_DWELL_MS + 400))
      expect(calls.some((item) => item.url.endsWith('/api/action'))).toBe(false)
    } finally {
      if (descriptor) Object.defineProperty(Document.prototype, 'visibilityState', descriptor)
    }
  }, 10_000)

  it('建卡时就判定看过的通知带「已看过」并免打扰，不再自动发请求', async () => {
    const { calls } = stubApi({
      cards: [
        card({
          id: 'c-seen',
          kind: 'info',
          source: 'agent',
          status: 'acknowledged',
          silent: true,
          title: '刚才已经看过的结果',
        }),
      ],
    })
    const { container } = render(<Panel t={translate} />)
    await screen.findByText('刚才已经看过的结果')
    expect(screen.getByText(zh.silentChip as string)).toBeTruthy()

    // 免打扰卡根本不参与「看到即已读」：连视口观察器都不挂。
    expect(() => intersectionObserverFor(container.querySelector('.dtc-card') as Element)).toThrow()
    await new Promise((resolve) => setTimeout(resolve, READ_DWELL_MS / 2))
    expect(calls.some((item) => item.url.endsWith('/api/action'))).toBe(false)
  }, 10_000)

  it('人手写的知晓卡保留「知道了」，不会自动已读', async () => {
    const { calls } = stubApi({
      cards: [card({ id: 'c-h', kind: 'info', source: 'human', title: '记得交房租' })],
    })
    render(<Panel t={translate} />)
    await screen.findByText('记得交房租')
    expect(screen.getByText(zh.know as string)).toBeTruthy()
    expect(screen.queryByText(zh.dismiss as string)).toBeNull()
    expect(calls.some((item) => item.url.endsWith('/api/action'))).toBe(false)
  })

  it('顶部是「卡片 / 观察者 / 决策」三个页签，能来回切', async () => {
    stubApi({ cards: [card()] })
    render(<Panel t={translate} />)
    for (const key of ['tabCards', 'tabObserver', 'tabDecision'] as const) {
      expect(screen.getByText(zh[key] as string)).toBeTruthy()
    }
    fireEvent.click(screen.getByText(zh.tabObserver as string))
    expect(await screen.findByText(zh.observerSection as string)).toBeTruthy()
    expect(await screen.findByDisplayValue('只输出 JSON')).toBeTruthy()
    expect(screen.getByText(zh.enabled as string)).toBeTruthy()
    fireEvent.click(screen.getByText(zh.tabDecision as string))
    expect(await screen.findByText(zh.decisionSection as string)).toBeTruthy()
    expect(await screen.findByPlaceholderText(zh.decisionPromptPlaceholder as string)).toBeTruthy()
    expect(screen.getByText(zh.decisionAutoApply as string)).toBeTruthy()
    // 观察者页的提示词框不在决策页
    expect(screen.queryByDisplayValue('只输出 JSON')).toBeNull()
    fireEvent.click(screen.getByText(zh.tabCards as string))
    expect(await screen.findByText('登录页空态要补')).toBeTruthy()
  })

  it('决策卡点「批准」发出 approve，并把「已推回原会话」说出来', async () => {
    const { calls } = stubApi({
      cards: [card({ id: 'c-9', kind: 'decision', title: '删掉旧表' })],
      action: { pushed: true },
    })
    render(<Panel t={translate} />)
    await screen.findByText('删掉旧表')
    fireEvent.click(screen.getByText(zh.approve as string))
    await waitFor(() => expect(calls.some((item) => item.url.endsWith('/api/action'))).toBe(true))
    const action = calls.find((item) => item.url.endsWith('/api/action'))
    expect(action?.body).toMatchObject({ id: 'c-9', action: 'approve' })
    expect(await screen.findByText(zh.approvePushed as string)).toBeTruthy()
  })

  it('批准时没有可回访会话：把宿主给的原因显示出来，卡仍然结束', async () => {
    const reason = '这张卡没有可回访的会话，已标记完成'
    stubApi({
      cards: [card({ id: 'c-9', kind: 'decision', title: '删掉旧表' })],
      action: { pushed: false, reason },
    })
    render(<Panel t={translate} />)
    await screen.findByText('删掉旧表')
    fireEvent.click(screen.getByText(zh.approve as string))
    expect(await screen.findByText(reason)).toBeTruthy()
    // 不静默：卡真的结束了，批准按钮不再出现。
    await waitFor(() => expect(screen.queryByText(zh.approve as string)).toBeNull())
  })

  it('手写一条卡：POST /cards 并清空输入', async () => {
    const { calls } = stubApi({ cards: [] })
    render(<Panel t={translate} />)
    const input = (await screen.findByPlaceholderText(zh.placeholder as string)) as HTMLInputElement
    fireEvent.change(input, { target: { value: '补空态' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(calls.some((item) => item.method === 'POST' && item.url.endsWith('/api/cards'))).toBe(
        true,
      ),
    )
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('观察者页会拉设置，保存时 POST /settings', async () => {
    const { calls } = stubApi({ settings: SETTINGS })
    render(<Panel t={translate} />)
    fireEvent.click(await screen.findByText(zh.tabObserver as string))
    const textarea = (await screen.findByDisplayValue('只输出 JSON')) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '新的观察者提示词' } })
    expect(screen.getByText(zh.minReplyChars as string)).toBeTruthy()
    fireEvent.click(screen.getByText(zh.save as string))
    await waitFor(() =>
      expect(
        calls.some((item) => item.method === 'POST' && item.url.endsWith('/api/settings')),
      ).toBe(true),
    )
    const saved = calls.find((item) => item.method === 'POST' && item.url.endsWith('/api/settings'))
    expect((saved?.body as { settings: Settings } | undefined)?.settings.systemPrompt).toBe(
      '新的观察者提示词',
    )
  })

  it('决策页能保存决策提示词与自动执行开关，判例列表把返工过的标红', async () => {
    const { calls } = stubApi({ settings: SETTINGS })
    const { container } = render(<Panel t={translate} />)
    fireEvent.click(await screen.findByText(zh.tabDecision as string))
    const autoApply = (await screen.findByText(zh.decisionAutoApply as string)).closest('label')
    const checkbox = autoApply?.querySelector('input')
    expect(checkbox).toBeTruthy()
    fireEvent.click(checkbox as HTMLElement)
    const prompt = (await screen.findByPlaceholderText(
      zh.decisionPromptPlaceholder as string,
    )) as HTMLTextAreaElement
    fireEvent.change(prompt, { target: { value: '我的决策画像' } })
    await waitFor(() => expect(container.querySelector('.dtc-precedent.is-reworked')).toBeTruthy())
    const reworked = container.querySelector('.dtc-precedent.is-reworked') as HTMLElement
    expect(reworked.textContent).toContain('旧表下线')
    fireEvent.click(screen.getByText(zh.save as string))
    await waitFor(() =>
      expect(
        calls.some((item) => item.method === 'POST' && item.url.endsWith('/api/settings')),
      ).toBe(true),
    )
    const saved = calls.find((item) => item.method === 'POST' && item.url.endsWith('/api/settings'))
    const body = saved?.body as { settings: Settings } | undefined
    expect(body?.settings.decisionPrompt).toBe('我的决策画像')
    expect(body?.settings.decisionAutoApply).toBe(false)
  })

  it('决策页显示最近执行记录：状态、模型、耗时、张数与错误', async () => {
    stubApi({ settings: SETTINGS, records: RECORDS })
    render(<Panel t={translate} />)
    fireEvent.click(await screen.findByText(zh.tabDecision as string))
    expect(await screen.findByText(zh.recordStatus_ok as string)).toBeTruthy()
    expect(screen.getByText(zh.recordStatus_error as string)).toBeTruthy()
    expect(screen.getAllByText(translate('recordModel', { model: 'deepseek-chat' })).length).toBe(2)
    expect(screen.getByText(translate('recordDuration', { duration: '2.4s' }))).toBeTruthy()
    expect(
      screen.getByText(translate('recordCounts', { created: 3, applied: 1, corrected: 2 })),
    ).toBeTruthy()
    expect(screen.getByText(translate('recordError', { error: '429 rate limited' }))).toBeTruthy()
  })

  it('决策页没跑过时显示「还没有跑过」', async () => {
    stubApi({ settings: SETTINGS, records: [] })
    render(<Panel t={translate} />)
    fireEvent.click(await screen.findByText(zh.tabDecision as string))
    expect(await screen.findByText(zh.recordEmpty as string)).toBeTruthy()
  })

  it('决策卡有票拟时，卡片行显示结论 + 摘要 + 把握', async () => {
    stubApi({ cards: [card({ id: 'c-dec', kind: 'decision', title: '删掉旧表', advice: ADVICE })] })
    render(<Panel t={translate} />)
    await screen.findByText('删掉旧表')
    expect(screen.getByText(zh.verdict_modify as string)).toBeTruthy()
    expect(screen.getByText(ADVICE.summary)).toBeTruthy()
    expect(screen.getByText(zh.confidence_high as string)).toBeTruthy()
  })

  it('决策卡没票拟时显示「待出票拟」，点重出票拟 POST /decisions', async () => {
    const { calls } = stubApi({
      cards: [card({ id: 'c-wait', kind: 'decision', title: '要不要迁移' })],
    })
    render(<Panel t={translate} />)
    await screen.findByText('要不要迁移')
    expect(screen.getByText(zh.advicePending as string)).toBeTruthy()
    fireEvent.click(screen.getByText(zh.adviceRedecide as string))
    await waitFor(() =>
      expect(
        calls.some((item) => item.method === 'POST' && item.url.endsWith('/api/decisions')),
      ).toBe(true),
    )
    const posted = calls.find(
      (item) => item.method === 'POST' && item.url.endsWith('/api/decisions'),
    )
    expect(posted?.body).toMatchObject({ action: 'redecide', id: 'c-wait' })
  })

  it('详情弹窗展开票拟：四栏对照，点「采纳」发出 adopt 与 0 起序号', async () => {
    const { calls } = stubApi({
      cards: [card({ id: 'c-dec', kind: 'decision', title: '删掉旧表', advice: ADVICE })],
    })
    render(<Panel t={translate} />)
    await screen.findByText('删掉旧表')
    fireEvent.click(screen.getByText(zh.detail as string))
    await screen.findByText('B: 完整重构')
    for (const key of ['adviceCost', 'adviceGain', 'adviceWorst'] as const) {
      expect(screen.getAllByText(zh[key] as string).length).toBe(2)
    }
    expect(screen.getByText(`依据：${ADVICE.basis}`)).toBeTruthy()
    const adoptButtons = screen.getAllByText(zh.adviceAdopt as string)
    expect(adoptButtons.length).toBe(2)
    fireEvent.click(adoptButtons[1] as HTMLElement)
    await waitFor(() =>
      expect(calls.some((item) => item.method === 'POST' && item.url.endsWith('/api/action'))).toBe(
        true,
      ),
    )
    const action = calls.find((item) => item.method === 'POST' && item.url.endsWith('/api/action'))
    expect(action?.body).toMatchObject({ id: 'c-dec', action: 'adopt', option: '1' })
  })

  it('票拟标出推荐方案与「系统可自动执行」，已执行时显示「已由系统自动执行」', async () => {
    stubApi({
      cards: [
        card({
          id: 'c-dec',
          kind: 'decision',
          title: '删掉旧表',
          advice: ADVICE,
          events: [{ at: Date.now(), type: 'advice-applied' }],
        }),
      ],
    })
    render(<Panel t={translate} />)
    await screen.findByText('删掉旧表')
    // 卡片行一眼能看到「已由系统自动执行」
    expect(screen.getByText(zh.adviceAutoApplied as string)).toBeTruthy()
    fireEvent.click(screen.getByText(zh.detail as string))
    await screen.findByText('B: 完整重构')
    expect(screen.getAllByText(zh.adviceChosen as string).length).toBe(1)
    expect(screen.getByText(zh.adviceAutoApply as string)).toBeTruthy()
    // 卡片行 + 详情票拟区块
    expect(screen.getAllByText(zh.adviceAutoApplied as string).length).toBe(2)
  })

  it('详情弹窗在卡片块下方显示观察者判定依据', async () => {
    stubApi({
      cards: [
        card({
          id: 'c-dec',
          kind: 'decision',
          title: '删掉旧表',
          origin: { reason: '模型在等你确认是否开始重构' },
        }),
      ],
    })
    render(<Panel t={translate} />)
    await screen.findByText('删掉旧表')
    fireEvent.click(screen.getByText(zh.detail as string))
    expect(
      await screen.findByText(translate('originReason', { reason: '模型在等你确认是否开始重构' })),
    ).toBeTruthy()
  })

  it('详情弹窗「这个决定后来返工了」发出 mark-reworked 和一句原因', async () => {
    const { calls } = stubApi({
      cards: [card({ id: 'c-dec', kind: 'decision', title: '删掉旧表', advice: ADVICE })],
    })
    render(<Panel t={translate} />)
    await screen.findByText('删掉旧表')
    fireEvent.click(screen.getByText(zh.detail as string))
    const note = (await screen.findByPlaceholderText(
      zh.reworkPlaceholder as string,
    )) as HTMLInputElement
    fireEvent.change(note, { target: { value: '验证没跑通就开工' } })
    fireEvent.click(screen.getByText(zh.reworkButton as string))
    await waitFor(() =>
      expect(calls.some((item) => item.method === 'POST' && item.url.endsWith('/api/action'))).toBe(
        true,
      ),
    )
    const action = calls.find((item) => item.method === 'POST' && item.url.endsWith('/api/action'))
    expect(action?.body).toMatchObject({
      id: 'c-dec',
      action: 'mark-reworked',
      option: '验证没跑通就开工',
    })
  })

  it('verdict=wait 时显示追问，点判例编号能看到判例原文', async () => {
    const waitAdvice: Advice = {
      ...ADVICE,
      verdict: 'wait',
      summary: '还差一条信息才能定',
      question: '这次改动能不能撤回？',
    }
    stubApi({
      cards: [card({ id: 'c-wait-2', kind: 'decision', title: '要不要迁移', advice: waitAdvice })],
    })
    render(<Panel t={translate} />)
    await screen.findByText('要不要迁移')
    fireEvent.click(screen.getByText(zh.detail as string))
    await screen.findByText(`需要你先补一句：${waitAdvice.question}`)
    fireEvent.click(await screen.findByText('P-002'))
    await screen.findByText('旧表下线')
  })
})
