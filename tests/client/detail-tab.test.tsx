// 详情屏：五段（决定/计划/执行清单/执行/验收）与空态。

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DetailTab } from '../../src/client/components/DetailTab'
import { DICT } from '../../src/client/locale'
import type { Card, CaseDetail, DetailState } from '../../src/client/types'

const zh = DICT.zh as Record<string, string>

function translate(key: string, vars?: Record<string, string | number>): string {
  const template = zh[key] ?? key
  return vars
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match))
    : template
}

function card(over: Partial<Card> = {}): Card {
  return {
    id: 'c-7',
    title: '补 scheduler 单元测试',
    detail: '覆盖 WIP=1 与租约过期',
    kind: 'decision',
    severity: 'normal',
    status: 'open',
    action: null,
    dueAt: null,
    source: 'agent',
    interaction: 'reply',
    question: null,
    ask: 'judgment',
    origin: { sessionId: 's-7d31', turn: 2 },
    advice: {
      verdict: 'approve',
      summary: '先补测试再重跑',
      options: [],
      basis: '无同类判例',
      precedentIds: [],
      confidence: 'normal',
      question: '',
      chosen: 0,
      autoApply: false,
      lane: 'decision',
      applied: false,
      at: 1_700_000_000_000,
    },
    silent: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    events: [],
    deliveryState: 'failed',
    waitReason: 'awaiting-user-escalation',
    authority: 'delegated',
    traceId: 'trace-1234567890abcdef',
    ...over,
  } as Card
}

function caseDetail(): CaseDetail {
  return {
    events: [
      {
        id: 'e-1',
        caseId: 'c-7',
        traceId: 'trace-1234567890abcdef',
        at: 1_700_000_000_000,
        phase: 'verify',
        from: 'verifying',
        to: 'failed',
        actor: 'verifier',
        authority: 'system',
        reason: 'exit 1，2 个测试失败',
        evidenceRefs: ['ev-1'],
        policyVersion: 1,
      },
    ],
    todo: {
      caseId: 'c-7',
      frozen: true,
      revision: 2,
      updatedAt: 1_700_000_000_000,
      baselineIds: ['t1', 't2'],
      items: [
        { id: 't1', text: '跑 pnpm test', status: 'done', updatedAt: 1_700_000_000_000 },
        { id: 't2', text: '补 WIP 用例', status: 'doing', updatedAt: 1_700_000_000_000 },
      ],
    },
    verdicts: [],
    evidence: [
      {
        id: 'ev-1',
        caseId: 'c-7',
        at: 1_700_000_000_000,
        spec: { kind: 'exit', cmd: 'pnpm test', expect: 0 },
        ok: false,
        detail: 'exit 1，2 个测试失败',
        durationMs: 1200,
      },
    ],
  }
}

function detail(over: Partial<DetailState> = {}): DetailState {
  return {
    sessionId: 's-7d31',
    card: card(),
    title: '调度器设计',
    loading: false,
    turns: [{ user: '跑测试', assistant: '失败了', at: 1_700_000_000_000 }],
    caseInfo: caseDetail(),
    ...over,
  }
}

const props = {
  t: translate,
  precedents: [],
  busy: false,
  onBack: vi.fn(),
  onOpenSession: vi.fn(),
  onOpenSessionTab: vi.fn(),
  onAction: vi.fn(),
  onAdopt: vi.fn(),
  onReworked: vi.fn(),
  onRedecide: vi.fn(),
}

afterEach(() => cleanup())

describe('DetailTab', () => {
  it('五段都在，清单与证据来自案卷', () => {
    render(<DetailTab {...props} detail={detail()} card={card()} />)
    for (const key of ['segDecide', 'segPlan', 'segTodo', 'segRun', 'segVerify']) {
      expect(screen.getByText(translate(key))).toBeTruthy()
    }
    expect(screen.getByText('跑 pnpm test')).toBeTruthy()
    expect(screen.getByText('补 WIP 用例')).toBeTruthy()
    expect(screen.getAllByText('exit 1，2 个测试失败').length).toBeGreaterThan(0)
    expect(screen.getAllByText(translate('caseVerifyFailed')).length).toBeGreaterThan(0)
  })

  it('计划段把等待原因与授权翻译成人话', () => {
    render(<DetailTab {...props} detail={detail()} card={card()} />)
    expect(screen.getByText(translate('planWait'))).toBeTruthy()
    expect(screen.getByText(translate('wait_awaiting-user-escalation'))).toBeTruthy()
    expect(screen.getByText(translate('authorityDelegated'))).toBeTruthy()
  })

  it('「看本会话」切会话屏，back 回工作台', () => {
    render(<DetailTab {...props} detail={detail()} card={card()} />)
    fireEvent.click(screen.getByText(translate('viewCaseSession')))
    expect(props.onOpenSessionTab).toHaveBeenCalledWith('s-7d31')
    fireEvent.click(screen.getByText(translate('backToWorkbench')))
    expect(props.onBack).toHaveBeenCalled()
  })

  it('没有选中卡时给空态', () => {
    render(<DetailTab {...props} detail={null} card={null} />)
    expect(screen.getByText(translate('detailEmpty'))).toBeTruthy()
  })
})
