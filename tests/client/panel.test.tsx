// 面板组件测试：真实渲染 Panel，fetch 换成受控的假后端。
// 这里验的是「用户看到什么 / 点了发什么」，不是实现细节。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Panel } from '../../src/client/components/Panel'
import { DICT } from '../../src/client/locale'
import type { Card, Settings } from '../../src/client/types'

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
}

interface Calls {
  method: string
  url: string
  body: unknown
}

/** 一个够用的假后端：只认面板会打的几个端点。 */
function stubApi(options: { cards?: Card[]; settings?: Settings } = {}) {
  const calls: Calls[] = []
  const cards = options.cards ?? []
  const settings = options.settings ?? SETTINGS
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
        action === 'complete' ? 'done' : action === 'acknowledge' ? 'acknowledged' : 'open'
      return json({ ok: true, card: card({ id, status }) })
    }
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
          origin: { sessionId: 's-new' },
        }),
        card({
          id: 'c-open',
          kind: 'decision',
          status: 'open',
          title: '等我拍板的决策',
          createdAt: now - 60_000,
          origin: { sessionId: 's-old' },
        }),
        card({
          id: 'c-info',
          kind: 'info',
          status: 'open',
          title: '等我知晓的事',
          createdAt: now - 120_000,
          origin: { sessionId: 's-old' },
        }),
      ],
    })
    const { container } = render(<Panel t={translate} />)
    await screen.findByText('等我拍板的决策')
    const texts = [...container.querySelectorAll('.dtc-text')].map((node) => node.textContent)
    expect(texts[0]).toBe('等我拍板的决策')
    expect(texts[texts.length - 1]).toBe('已经处理完的决策')
  })

  it('点「批准」发出 complete 动作', async () => {
    const { calls } = stubApi({ cards: [card({ id: 'c-9', kind: 'decision', title: '删掉旧表' })] })
    render(<Panel t={translate} />)
    await screen.findByText('删掉旧表')
    fireEvent.click(screen.getByText(zh.approve as string))
    await waitFor(() => expect(calls.some((item) => item.url.endsWith('/api/action'))).toBe(true))
    const action = calls.find((item) => item.url.endsWith('/api/action'))
    expect(action?.body).toMatchObject({ id: 'c-9', action: 'complete' })
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

  it('提示词页会拉设置，保存时 POST /settings', async () => {
    const { calls } = stubApi({ settings: SETTINGS })
    render(<Panel t={translate} />)
    fireEvent.click(await screen.findByText(zh.tabSettings as string))
    const textarea = (await screen.findByDisplayValue('只输出 JSON')) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '新的提示词' } })
    fireEvent.click(screen.getByText(zh.save as string))
    await waitFor(() =>
      expect(
        calls.some((item) => item.method === 'POST' && item.url.endsWith('/api/settings')),
      ).toBe(true),
    )
    const saved = calls.find((item) => item.method === 'POST' && item.url.endsWith('/api/settings'))
    expect((saved?.body as { settings: Settings } | undefined)?.settings.systemPrompt).toBe(
      '新的提示词',
    )
  })
})
