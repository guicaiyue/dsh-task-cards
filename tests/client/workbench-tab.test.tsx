// 工作台屏：KPI、过滤、会话分组、平铺视图。验「用户看到什么、点了剩什么」。

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { groupBySession, WorkbenchTab } from '../../src/client/components/WorkbenchTab'
import { DICT } from '../../src/client/locale'
import type { Card } from '../../src/client/types'

const zh = DICT.zh as Record<string, string>

function translate(key: string, vars?: Record<string, string | number>): string {
  const template = zh[key] ?? key
  return vars
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match))
    : template
}

function card(over: Partial<Card> = {}): Card {
  return {
    id: 'c-1',
    title: '卡一',
    detail: '',
    kind: 'decision',
    severity: 'normal',
    status: 'open',
    action: null,
    dueAt: null,
    source: 'agent',
    interaction: 'reply',
    question: null,
    origin: { sessionId: 'sess-aaaa1111', turn: 1, reason: '用户结束了这一轮' },
    advice: null,
    silent: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    events: [],
    ...over,
  } as Card
}

const baseProps = {
  stats: null,
  busy: false,
  loading: false,
  draft: '',
  titles: { 'sess-aaaa1111': '调度器设计' } as Record<string, string>,
  progress: {},
  onDraftChange: vi.fn(),
  onAdd: vi.fn(),
  onAction: vi.fn(),
  onAnswer: vi.fn(),
  onRedecide: vi.fn(),
  onOpenDetail: vi.fn(),
  onOpenSession: vi.fn(),
  onSelectSession: vi.fn(),
  onReconcile: vi.fn(),
}

afterEach(() => cleanup())

/** 过滤按钮里还带着计数，按可访问名开头匹配。 */
function clickFilter(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))
}

describe('groupBySession', () => {
  it('同一会话归一组，没有会话的归到空 id', () => {
    const groups = groupBySession([
      card({ id: 'a' }),
      card({ id: 'b', origin: null }),
      card({ id: 'c' }),
    ])
    expect(groups.map((group) => group.sessionId)).toEqual(['sess-aaaa1111', ''])
    expect(groups[0]?.cards).toHaveLength(2)
  })
})

describe('WorkbenchTab', () => {
  const cards = [
    // 待决 = 还没进执行链路（idle）；waiting 是已批准排队，归「执行中」车道。
    card({ id: 'a', title: '待决的卡', deliveryState: 'idle' }),
    card({
      id: 'b',
      title: '执行中的卡',
      deliveryState: 'dispatched',
      origin: { sessionId: 'sess-bbbb2222', turn: 3, reason: '会话结束' },
    }),
    card({ id: 'c', title: '失败的卡', deliveryState: 'failed', status: 'done' }),
  ]

  it('五个 KPI 与卡数一致', () => {
    const { container } = render(<WorkbenchTab t={translate} cards={cards} {...baseProps} />)
    const kpis = container.querySelector('.dtc-kpis')
    expect(kpis).toBeTruthy()
    const scope = within(kpis as HTMLElement)
    expect(scope.getByText(translate('kpiPending'))).toBeTruthy()
    expect(scope.getByText(translate('kpiDelegated'))).toBeTruthy()
    expect(scope.getByText(translate('kpiAttention'))).toBeTruthy()
    expect(within(kpis as HTMLElement).getAllByText('1').length).toBeGreaterThan(0)
  })

  it('点「执行中」只剩在执行的那张', () => {
    render(<WorkbenchTab t={translate} cards={cards} {...baseProps} />)
    clickFilter(translate('filter_running'))
    expect(screen.getByText('执行中的卡')).toBeTruthy()
    expect(screen.queryByText('待决的卡')).toBeNull()
  })

  it('分组头的「待处理」与 KPI 同源：只数待决定 + 需关注', () => {
    render(<WorkbenchTab t={translate} cards={cards} {...baseProps} />)
    // 会话 sess-aaaa1111 有 待决(idle) + 失败(failed) → 待处理 = 2；执行中那张在另一个会话
    expect(screen.getByText(translate('groupCards', { n: 2, p: 2 }))).toBeTruthy()
  })

  it('会话分组显示组头，点组标题进会话屏', () => {
    render(<WorkbenchTab t={translate} cards={cards} {...baseProps} />)
    fireEvent.click(screen.getByText('调度器设计'))
    expect(baseProps.onSelectSession).toHaveBeenCalledWith('sess-aaaa1111')
  })

  it('平铺视图按卡渲染，不显示组头', () => {
    render(<WorkbenchTab t={translate} cards={cards} {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: translate('viewFlat') }))
    expect(screen.queryByText('调度器设计')).toBeNull()
    expect(screen.getByText('待决的卡')).toBeTruthy()
  })

  it('决策者暂停时顶部出现横幅，数字是待决策张数', () => {
    render(<WorkbenchTab t={translate} cards={cards} paused {...baseProps} />)
    expect(screen.getByText(translate('pausedBanner', { n: 1 }))).toBeTruthy()
  })

  it('空过滤结果给一句空态', () => {
    render(<WorkbenchTab t={translate} cards={[cards[0] as Card]} {...baseProps} />)
    clickFilter(translate('filter_attention'))
    expect(screen.getByText(translate('emptyFilter'))).toBeTruthy()
  })
})
