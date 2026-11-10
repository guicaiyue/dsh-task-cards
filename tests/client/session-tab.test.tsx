// 会话屏：会话清单与切换、时间线里的卡节点、空态与「其它卡」兜底。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SessionTab } from '../../src/client/components/SessionTab'
import { DICT } from '../../src/client/locale'
import type { Card } from '../../src/client/types'

const zh = DICT.zh as Record<string, string>

function translate(key: string, vars?: Record<string, string | number>): string {
  const template = zh[key] ?? key
  return vars
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match))
    : template
}

vi.mock('../../src/client/api', () => ({
  fetchTitles: vi.fn(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, `会话标题 ${id}`])),
  ),
  fetchTimeline: vi.fn(async (id: string) =>
    id === 's-1'
      ? {
          title: '调度器设计',
          turns: [{ user: '先发一版', assistant: '建了两张卡', at: 1_700_000_000_000 }],
        }
      : { title: '', turns: [] },
  ),
}))

function card(id: string, sessionId: string, over: Partial<Card> & { turn?: number } = {}): Card {
  const { turn, ...rest } = over
  return {
    id,
    title: `卡 ${id}`,
    detail: '',
    kind: 'decision',
    severity: 'normal',
    status: 'open',
    action: null,
    dueAt: null,
    source: 'agent',
    interaction: 'reply',
    question: null,
    ask: 'judgment',
    origin: { sessionId, turn, reason: '' },
    advice: null,
    silent: false,
    createdAt: 1_700_000_050_000,
    updatedAt: 1_700_000_050_000,
    events: [],
    ...rest,
  } as unknown as Card
}

function renderTab(cards: Card[], sessionId: string) {
  const picked: string[] = []
  const opened: Card[] = []
  render(
    <SessionTab
      t={translate}
      cards={cards}
      sessionId={sessionId}
      onSelectSession={(id) => picked.push(id)}
      onOpenDetail={(item) => opened.push(item)}
    />,
  )
  return { picked, opened }
}

afterEach(cleanup)

describe('会话屏', () => {
  it('没有选中会话时提示从哪里选', () => {
    renderTab([card('c-42', 's-1')], '')
    expect(screen.getByText(zh.sesPickEmpty as string)).toBeTruthy()
  })

  it('没有带会话的卡时说明原因', () => {
    renderTab([], '')
    expect(screen.getByText(zh.sesNoSessions as string)).toBeTruthy()
  })

  it('把该会话的卡按轮次渲染成节点：阶段、等待原因、trace 尾、轮次消息', async () => {
    renderTab(
      [
        card('c-42', 's-1', {
          title: '跑测试并提交 feat/scheduler 分支',
          turn: 1,
          deliveryState: 'failed',
          waitReason: 'awaiting-decision',
          traceId: 'tr-9f2c41d8ae07',
        }),
      ],
      's-1',
    )
    await screen.findByText('跑测试并提交 feat/scheduler 分支')
    expect(screen.getByText('先发一版')).toBeTruthy()
    expect(screen.getByText(zh.stageFailed as string)).toBeTruthy()
    expect(screen.getByText(zh['wait_awaiting-decision'] as string)).toBeTruthy()
    expect(screen.getByText(/41d8ae07/)).toBeTruthy()
    expect(screen.getByText(zh.sesCardCount.replace('{n}', '1'))).toBeTruthy()
  })

  it('点卡节点把卡交给详情', async () => {
    const { opened } = renderTab(
      [card('c-42', 's-1', { title: '跑测试并提交 feat/scheduler 分支', turn: 1 })],
      's-1',
    )
    await screen.findByText('先发一版')
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /跑测试并提交/ }))
      expect(opened.map((item) => item.id)).toEqual(['c-42'])
    })
  })

  it('切换下拉框把会话 id 交给上层', () => {
    const { picked } = renderTab([card('c-42', 's-1'), card('c-43', 's-2')], 's-1')
    fireEvent.change(screen.getByLabelText(zh.sesPickLabel as string), { target: { value: 's-2' } })
    expect(picked).toEqual(['s-2'])
  })

  it('会话没有可读对话时说明原因，没归到轮次的卡落到「其它卡」', async () => {
    renderTab([card('c-51', 's-3', { title: '重跑 lease 过期用例并核对' })], 's-3')
    await screen.findByText(zh.sesTimelineEmpty as string)
    expect(screen.getByText(zh.sesOtherCards as string)).toBeTruthy()
    await waitFor(() => expect(screen.getByText('重跑 lease 过期用例并核对')).toBeTruthy())
  })
})
