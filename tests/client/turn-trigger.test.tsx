import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { GenericTurnTriggerNodeView, sourceKindKey } from '../../src/client/chat/turnTrigger'
import { DICT } from '../../src/client/locale'

const zh = DICT.zh as Record<string, string>

function t(key: string, vars?: Record<string, string | number>): string {
  const template = zh[key] ?? key
  return vars
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match))
    : template
}

describe('通用 source-kind 文案映射', () => {
  afterEach(cleanup)

  it('按 kind 和 provider 选标签；未知 kind 明确显示其他来源', () => {
    expect(sourceKindKey('schedule')).toBe('sourceKindSchedule')
    expect(sourceKindKey('webhook', 'github')).toBe('sourceKindGithub')
    expect(sourceKindKey('webhook')).toBe('sourceKindWebhook')
    expect(sourceKindKey('dsh-task-cards')).toBe('sourceKindTaskCards')
    expect(sourceKindKey('never-seen')).toBe('sourceKindOther')
  })

  it('渲染成通用通知，不再一律显示「请求」', () => {
    render(
      <GenericTurnTriggerNodeView
        t={t}
        node={{
          data: {
            time: Date.now(),
            source: { kind: 'schedule', scheduleId: 'sch-1' },
            content: [{ type: 'text', text: '每天 09:00 提醒' }],
          },
        }}
      />,
    )
    expect(screen.getByText('定时任务')).toBeTruthy()
    expect(screen.queryByText('请求')).toBeNull()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('定时任务注入了这条消息，不是用户直接输入。')).toBeTruthy()
    expect(screen.getByText('每天 09:00 提醒')).toBeTruthy()
  })
})
