import { describe, expect, it } from 'vitest'

import type { AgentMessageLike, HostRuntime } from '../../src/host/host-api'
import { answerQuestion } from '../../src/host/question/answer'
import type { Card } from '../../src/shared/contract'

function card(): Card {
  return {
    id: 'c-1',
    title: '提交改动',
    detail: '',
    kind: 'decision',
    severity: 'normal',
    status: 'open',
    action: null,
    dueAt: null,
    source: 'agent',
    interaction: 'reply',
    question: null,
    ask: 'permission',
    origin: { sessionId: 's-1', reason: '' },
    advice: null,
    silent: false,
    createdAt: 1,
    updatedAt: 1,
    events: [],
  }
}

describe('任务卡答复投递', () => {
  it('实时 agent 存在：走 followup，source 标明是插件注入的通知', async () => {
    let captured: AgentMessageLike | undefined
    const ctx = {
      agents: {
        get: () => ({
          followup: (message: AgentMessageLike) => {
            captured = message
          },
        }),
      },
      sessionController: {
        prompt: () => {
          throw new Error('不该走 prompt')
        },
      },
    } as unknown as HostRuntime

    const result = await answerQuestion(card(), '允许一次', ctx)
    expect(result.via).toBe('agent')
    expect(captured?.source).toMatchObject({
      kind: 'dsh-task-cards',
      form: 'notice',
      cardId: 'c-1',
    })
    expect(captured?.content[0]?.text).toContain('〔任务卡答复 c-1')
    expect(captured?.content[0]?.text).toContain('允许一次')
  })

  it('冷会话：先 resolveAgent 恢复，再 followup，source 仍是插件通知', async () => {
    let captured: AgentMessageLike | undefined
    const ctx = {
      agents: { get: () => undefined },
      sessionController: {
        prompt: () => {
          throw new Error('恢复成功就不该走 prompt')
        },
        agents: {
          resolveAgent: async () => ({
            agent: {
              followup: (message: AgentMessageLike) => {
                captured = message
              },
            },
          }),
        },
      },
    } as unknown as HostRuntime

    const result = await answerQuestion(card(), '允许一次', ctx)
    expect(result.via).toBe('agent')
    expect(captured?.source).toMatchObject({ kind: 'dsh-task-cards', cardId: 'c-1' })
    expect(captured?.content[0]?.text).toContain('允许一次')
  })

  it('实时 agent 刚关掉且无法恢复：拒绝投递，不伪装成用户输入', async () => {
    const prompts: Array<{ text: string; source?: unknown }> = []
    const ctx = {
      agents: {
        get: () => ({
          followup: () => {
            throw new Error('agent closed')
          },
        }),
      },
      sessionController: {
        async prompt(request: { content: Array<{ text: string }>; source?: unknown }) {
          prompts.push({ text: request.content[0]?.text || '', source: request.source })
          return {}
        },
        agents: {
          async resolveAgent() {
            throw new Error('会话已经结束')
          },
        },
      },
    } as unknown as HostRuntime

    await expect(answerQuestion(card(), '允许一次', ctx)).rejects.toMatchObject({
      code: 'NO_AGENT',
    })
    expect(prompts).toHaveLength(0)
  })
})
