import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  TASK_CARD_NODE_KIND,
  TaskCardAnswerNodeView,
  taskCardAnswerDefinition,
} from '../../src/client/chat/taskCardAnswer'
import { DICT } from '../../src/client/locale'
import { BASE_CSS as CSS } from '../../src/host/panel/css/base'

const zh = DICT.zh as Record<string, string>

function t(key: string, vars?: Record<string, string | number>): string {
  const template = zh[key] ?? key
  return vars
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match))
    : template
}

function event(source: Record<string, unknown>, text: string) {
  return {
    type: 'user/message',
    seq: 7,
    time: Date.now(),
    data: { id: 'm-1', source, content: [{ type: 'text', text }] },
  }
}

describe('任务卡答复 Chat 节点', () => {
  afterEach(cleanup)

  it('只认插件自己的 source / 旧版 card-answer 标记，不抢真人消息', () => {
    expect(
      taskCardAnswerDefinition.match(
        event({ kind: 'dsh-task-cards' }, '〔任务卡答复 c-1「测试」〕\n允许'),
      ),
    ).toEqual({ id: 'm-1', role: 'start', exclusive: true })
    expect(
      taskCardAnswerDefinition.match(
        event({ kind: 'user', rpcId: 'card-answer-1' }, '〔任务卡答复 c-2「旧卡」〕\n继续'),
      ),
    ).toEqual({ id: 'm-1', role: 'start', exclusive: true })
    expect(taskCardAnswerDefinition.match(event({ kind: 'user' }, '真人输入'))).toBeNull()
  })

  it('样式优先用 DSH 主题变量，并为深色主题留兜底', () => {
    expect(CSS).toContain('--dsw-alias-turn-trigger-bg')
    expect(CSS).toContain('body[data-ds-dark-theme] .dtc-trigger')
    expect(CSS).not.toContain('.dtc-trigger { color:')
  })

  it('渲染成可展开的通知块，而不是用户气泡', () => {
    const match = {
      event: event({ kind: 'dsh-task-cards' }, '〔任务卡答复 c-1「提交改动」〕\n允许一次'),
      role: 'start' as const,
    }
    const state = taskCardAnswerDefinition.start(undefined, match)
    const node = taskCardAnswerDefinition.buildViewNode({
      key: 'chat:m-1',
      id: 'm-1',
      start: match,
      matches: [match],
      state,
    }) as { kind: string; target: string; data: typeof state }
    expect(node.kind).toBe(TASK_CARD_NODE_KIND)
    expect(node.target).toBe('chat')

    render(<TaskCardAnswerNodeView node={node} t={t} />)
    expect(screen.getByText('任务卡答复')).toBeTruthy()
    expect(screen.queryByText('允许一次')).toBeNull()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('这张卡把答复发回了原会话，触发了本轮回复。')).toBeTruthy()
    expect(screen.getByText('来源卡片：提交改动')).toBeTruthy()
    expect(screen.getByText('允许一次')).toBeTruthy()
  })
})
