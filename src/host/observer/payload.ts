// 观察者的输入构造：纯函数，方便单测。

import type { MessageLike } from '../host-api'
import { asRecord } from '../host-api'

/** 取 assistant/message 里的纯文本块。 */
export function messageText(message: unknown): string {
  const value = message as MessageLike | null | undefined
  if (!value || !Array.isArray(value.content)) return ''
  return value.content
    .filter((block: unknown): block is { type: string; text: string } => {
      const entry = asRecord(block)
      return entry.type === 'text' && typeof entry.text === 'string'
    })
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/** 按字节截断，避免把大段输出整个塞进观察者。 */
export function truncateBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= maxBytes) return text
  const sliced = buffer.subarray(0, maxBytes).toString('utf8')
  // 末尾可能切在多字节字符中间，退回一个字符
  return sliced.replace(/\uFFFD$/, '')
}

/** 一轮观察素材：用户说了什么 + 模型最后说了什么。 */
export interface TurnLike {
  user?: string
  assistant?: string
}

/**
 * 观察者的输入：最近三轮「用户输入 + 模型最终输出」。
 * 只给最后一轮回复会让分类丢掉上下文（比如这轮在做的事是什么）。
 */
export function buildPayload(
  turns: TurnLike[] | undefined,
  lastReply: string,
  maxBytes: number,
): string {
  const list = Array.isArray(turns)
    ? turns.filter((turn) => turn && (turn.user || turn.assistant))
    : []
  const parts: string[] = []
  list.forEach((turn, index) => {
    parts.push(`【第 ${index + 1} 轮】`)
    if (turn.user) parts.push(`用户：${truncateBytes(turn.user, 6000)}`)
    if (turn.assistant) parts.push(`模型：${truncateBytes(turn.assistant, 12000)}`)
  })
  if (!parts.length && lastReply)
    parts.push(`【最后一轮】\n模型：${truncateBytes(lastReply, 12000)}`)
  return truncateBytes(parts.join('\n'), maxBytes)
}
