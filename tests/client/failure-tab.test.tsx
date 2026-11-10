// 失败排查屏：空态、列表、选中后三栏（要求 / 实际 / 判定）与两个本地跳转。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FailureTab } from '../../src/client/components/FailureTab'
import { DICT } from '../../src/client/locale'
import type { Advice, Card, CaseDetail } from '../../src/client/types'
import type { CaseEvent } from '../../src/shared/case'

vi.mock('../../src/client/api', () => ({ fetchCase: vi.fn() }))

import { fetchCase } from '../../src/client/api'

const zh = DICT.zh as Record<string, string>

/** 取实际渲染的文案：键还没进词典时组件会退回键名。 */
function label(key: string): string {
  return zh[key] ?? key
}

function translate(key: string, vars?: Record<string, string | number>): string {
  const template = zh[key] ?? key
  return vars
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match))
    : template
}

const advice: Advice = {
  verdict: 'wait',
  summary: '',
  options: [],
  basis: '',
  precedentIds: [],
  confidence: 'normal',
  question: '',
  chosen: 0,
  autoApply: false,
  lane: 'decision',
  applied: false,
  at: 1,
  action: 'pnpm test',
  scope: 'scheduler/**',
  effect: 'write-code',
}

function card(over: Partial<Card>): Card {
  return {
    id: 'c-42',
    title: '跑测试并提交 feat/scheduler 分支',
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
    origin: { sessionId: 's-7d31', turn: 2, reason: '' },
    advice: null,
    silent: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    events: [],
    ...over,
  } as unknown as Card
}

const failed = card({
  id: 'c-42',
  traceId: 'tr-9f2c41d8ae07',
  deliveryState: 'failed',
  advice,
  detail: '跑完测试再提交，别跳步。',
})

const unknown = card({
  id: 'c-51',
  title: '重跑 lease 过期用例并核对',
  traceId: 'tr-3b8e02f1c55a',
  deliveryState: 'unknown',
  waitReason: 'lease-expired',
})

const confirmed = card({
  id: 'c-99',
  title: '已经通过的卡',
  deliveryState: 'confirmed',
})

const verifyEvent: CaseEvent = {
  id: 'ev-1',
  caseId: 'c-42',
  traceId: 'tr-9f2c41d8ae07',
  at: 1_700_000_500_000,
  phase: 'verify',
  from: 'verifying',
  to: 'failed',
  actor: 'verifier',
  authority: 'system',
  reason: 'pnpm test 退出码 == 0 未通过',
  evidenceRefs: ['e1'],
  policyVersion: 3,
}

const executeEvent: CaseEvent = {
  ...verifyEvent,
  id: 'ev-0',
  phase: 'execute',
  from: 'leased',
  to: 'dispatched',
  actor: 'scheduler',
  reason: '通过准入，落租约',
}

const caseOf = (id: string): CaseDetail => ({
  events: id === 'c-42' ? [executeEvent, verifyEvent] : [],
  todo: null,
  verdicts: [],
  evidence:
    id === 'c-42'
      ? [
          {
            id: 'e1',
            caseId: 'c-42',
            at: 1_700_000_400_000,
            spec: { kind: 'exit', cmd: 'pnpm test', expect: 0 },
            ok: false,
            detail: 'exit 1 · Tests 2 failed',
            durationMs: 842,
          },
          {
            id: 'e2',
            caseId: 'c-42',
            at: 1_700_000_400_100,
            spec: { kind: 'file', path: '/repo/.env', expect: 'absent' },
            ok: true,
            detail: '文件不存在',
            durationMs: 3,
          },
        ]
      : [],
})

beforeEach(() => {
  vi.mocked(fetchCase).mockReset()
  vi.mocked(fetchCase).mockImplementation(async (id: string) => caseOf(id))
})

afterEach(cleanup)

describe('失败排查屏', () => {
  it('没有 failed / unknown 的卡时给出空态', () => {
    render(
      <FailureTab
        t={translate}
        cards={[confirmed]}
        onOpenDetail={() => {}}
        onOpenSession={() => {}}
      />,
    )
    expect(screen.getByText(zh.failEmpty as string)).toBeTruthy()
    expect(screen.queryByText('已经通过的卡')).toBeNull()
  })

  it('只列失败与未知卡：徽标、标题、等待原因、trace、时间', () => {
    render(
      <FailureTab
        t={translate}
        cards={[confirmed, failed, unknown]}
        onOpenDetail={() => {}}
        onOpenSession={() => {}}
      />,
    )
    expect(screen.getAllByText('跑测试并提交 feat/scheduler 分支').length).toBeGreaterThan(0)
    expect(screen.getAllByText('重跑 lease 过期用例并核对').length).toBeGreaterThan(0)
    expect(screen.queryByText('已经通过的卡')).toBeNull()
    expect(screen.getAllByText(label('stageFailed')).length).toBeGreaterThan(0)
    expect(screen.getByText(label('stageUnknown'))).toBeTruthy()
    expect(screen.getAllByText('tr-41d8ae07').length).toBeGreaterThan(0)
    expect(screen.getByText('tr-02f1c55a')).toBeTruthy()
    expect(screen.getByText(/等待原因：/)).toBeTruthy()
    expect(screen.getByText(zh.failListTitle as string)).toBeTruthy()
    expect(vi.mocked(fetchCase)).toHaveBeenCalledWith('c-42')
  })

  it('选中后给结论条 + 三栏：要求、证据、verify 判定', async () => {
    render(
      <FailureTab
        t={translate}
        cards={[failed, unknown]}
        onOpenDetail={() => {}}
        onOpenSession={() => {}}
      />,
    )
    await waitFor(() => expect(screen.getByText('exit 1 · Tests 2 failed')).toBeTruthy())
    // ① 卡片要求
    expect(screen.getByText(zh.failColRequirement as string)).toBeTruthy()
    expect(screen.getByText('跑完测试再提交，别跳步。')).toBeTruthy()
    expect(screen.getByText('pnpm test')).toBeTruthy()
    expect(screen.getByText('scheduler/**')).toBeTruthy()
    // ② 实际结果：checker 人读描述 + ok + detail + 耗时
    expect(screen.getByText(zh.failColActual as string)).toBeTruthy()
    expect(screen.getByText('pnpm test 退出码 == 0')).toBeTruthy()
    expect(screen.getByText('/repo/.env 不存在')).toBeTruthy()
    expect(screen.getByText('exit 1 · Tests 2 failed')).toBeTruthy()
    expect(screen.getByText(zh.failNotOk as string)).toBeTruthy()
    expect(screen.getByText(zh.failOk as string)).toBeTruthy()
    expect(screen.getByText('耗时 842ms')).toBeTruthy()
    // ③ 验收判定：actor / authority / reason / 时间
    expect(screen.getByText(zh.failColVerdict as string)).toBeTruthy()
    expect(
      screen.getByText(translate('failVerdictActor', { actor: translate('failActorVerifier') })),
    ).toBeTruthy()
    expect(
      screen.getByText(
        translate('failVerdictAuthority', { authority: translate('failAuthoritySystem') }),
      ),
    ).toBeTruthy()
    expect(screen.getByText('原因：pnpm test 退出码 == 0 未通过')).toBeTruthy()
    // 结论条：判成什么、谁判的、一句话原因
    expect(screen.getAllByText(label('caseVerifyFailed')).length).toBeGreaterThan(0)
    expect(screen.getByText('判定者：系统')).toBeTruthy()
    expect(screen.getAllByText('pnpm test 退出码 == 0 未通过').length).toBeGreaterThan(0)
  })

  it('切卡会按新卡 id 重新拉案卷；没有 verify 事件时给空态', async () => {
    render(
      <FailureTab
        t={translate}
        cards={[failed, unknown]}
        onOpenDetail={() => {}}
        onOpenSession={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('重跑 lease 过期用例并核对'))
    await waitFor(() => expect(vi.mocked(fetchCase)).toHaveBeenCalledWith('c-51'))
    await waitFor(() => expect(screen.getByText(zh.failVerdictEmpty as string)).toBeTruthy())
    expect(
      screen.getByText(translate('failJudge', { judge: translate('failJudgeNone') })),
    ).toBeTruthy()
  })

  it('两个本地跳转：查看详情、打开会话', async () => {
    const openedDetail: string[] = []
    const openedSession: string[] = []
    render(
      <FailureTab
        t={translate}
        cards={[failed]}
        onOpenDetail={(c) => openedDetail.push(c.id)}
        onOpenSession={(id) => openedSession.push(id)}
      />,
    )
    await waitFor(() => expect(screen.getByText(zh.failOpenDetail as string)).toBeTruthy())
    fireEvent.click(screen.getByText(zh.failOpenDetail as string))
    fireEvent.click(screen.getByText(zh.failOpenSession as string))
    expect(openedDetail).toEqual(['c-42'])
    expect(openedSession).toEqual(['s-7d31'])
  })
})
