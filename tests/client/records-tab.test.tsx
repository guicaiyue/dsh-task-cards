// 记录屏：跨卡事件列表、阶段徽标、打开详情、空态。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RecordsTab } from '../../src/client/components/RecordsTab'
import { DICT } from '../../src/client/locale'
import type { Card, RecordRow } from '../../src/client/types'

const rows: RecordRow[] = [
  {
    id: 'e1',
    caseId: 'c-42',
    traceId: 'tr-9f2c41d8ae07',
    at: 1_700_000_000_000,
    phase: 'execute',
    from: 'leased',
    to: 'dispatched',
    actor: 'scheduler',
    reason: '通过准入，落租约',
  },
  {
    id: 'e2',
    caseId: 'c-43',
    traceId: 'tr-3b8e02f1c55a',
    at: 1_700_000_100_000,
    phase: 'decide',
    from: 'idle',
    to: 'waiting',
    actor: 'scheduler',
    reason: '用户批红，进入调度队列',
  },
]

vi.mock('../../src/client/api', () => ({
  fetchRecords: vi.fn(async () => ({ records: rows, truncated: false })),
}))

const zh = DICT.zh as Record<string, string>
function translate(key: string, vars?: Record<string, string | number>): string {
  const template = zh[key] ?? key
  return vars
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match))
    : template
}

function card(id: string, title: string): Card {
  return {
    id,
    title,
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
    origin: { sessionId: 's-7d31', turn: 1, reason: '' },
    advice: null,
    silent: false,
    createdAt: 1,
    updatedAt: 1,
    events: [],
  } as unknown as Card
}

afterEach(cleanup)

describe('记录屏', () => {
  it('展示跨卡记录：阶段、标题、原因、trace', async () => {
    render(
      <RecordsTab
        t={translate}
        active
        cards={[card('c-42', '跑测试并提交 feat/scheduler 分支')]}
        onDetail={() => {}}
      />,
    )
    await waitFor(() => expect(screen.getByText('跑测试并提交 feat/scheduler 分支')).toBeTruthy())
    expect(screen.getAllByText(zh.recordPhaseExecute as string).length).toBeGreaterThan(0)
    expect(screen.getByText('通过准入，落租约')).toBeTruthy()
    expect(screen.getByText('tr-9f2c41d8ae07')).toBeTruthy()
    // 没有对应卡时退化成显示 caseId
    expect(screen.getByText('c-43')).toBeTruthy()
  })

  it('点「打开」把卡交给详情', async () => {
    const opened: string[] = []
    render(
      <RecordsTab
        t={translate}
        active
        cards={[card('c-42', '跑测试并提交 feat/scheduler 分支')]}
        onDetail={(c) => opened.push(c.id)}
      />,
    )
    await waitFor(() => expect(screen.getByText(zh.recordOpen as string)).toBeTruthy())
    fireEvent.click(screen.getByText(zh.recordOpen as string))
    expect(opened).toEqual(['c-42'])
  })
})
