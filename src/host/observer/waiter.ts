// 待完成的观察者会话：由事件驱动完成，不轮询。

import type { SessionEventLike } from '../host-api'
import { asRecord } from '../host-api'
import { messageText } from './payload'

export interface WaitResult {
  ok: boolean
  reason?: string
  text: string
  usage: { inputTokens?: number; outputTokens?: number } | null
  toolCalls: number
}

interface Pending {
  timer: NodeJS.Timeout
  text: string
  usage: WaitResult['usage']
  toolCalls: number
  resolve: (result: WaitResult) => void
}

export class Waiter {
  readonly pending = new Map<string, Pending>()

  expect(sessionId: string, timeoutMs: number): Promise<WaitResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const entry = this.pending.get(sessionId)
        if (!entry) return
        this.pending.delete(sessionId)
        resolve({
          ok: false,
          reason: '观察者会话超时未完成',
          text: entry.text || '',
          usage: entry.usage || null,
          toolCalls: entry.toolCalls || 0,
        })
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(sessionId, { timer, text: '', usage: null, toolCalls: 0, resolve })
    })
  }

  /** 每次会话事件都送进来：累计文本、usage、工具调用次数。 */
  acceptEvent(sessionId: string, event: SessionEventLike): void {
    const entry = this.pending.get(sessionId)
    if (!entry) return
    const data = asRecord(event.data)
    if (event.type === 'assistant/message') {
      const text = messageText(data.message)
      if (text) entry.text = text
      const usage = asRecord(data.usage)
      if (Object.keys(usage).length) entry.usage = usage as WaitResult['usage']
    } else if (event.type === 'tool/call') {
      entry.toolCalls += 1
    }
  }

  /** 回合结束：有最终文本才算完成。 */
  finish(sessionId: string): void {
    const entry = this.pending.get(sessionId)
    if (!entry || !entry.text) return
    this.pending.delete(sessionId)
    clearTimeout(entry.timer)
    entry.resolve({ ok: true, text: entry.text, usage: entry.usage, toolCalls: entry.toolCalls })
  }

  cancel(sessionId: string, reason: string): void {
    const entry = this.pending.get(sessionId)
    if (!entry) return
    this.pending.delete(sessionId)
    clearTimeout(entry.timer)
    entry.resolve({
      ok: false,
      reason,
      text: entry.text || '',
      usage: entry.usage || null,
      toolCalls: entry.toolCalls || 0,
    })
  }
}
