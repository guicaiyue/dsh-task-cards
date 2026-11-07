// 观察者的输入构造：纯函数，方便单测。
//
// 关键变化：不再把每条 user/message 都叫「用户」。真人、系统代发（卡片答复）、
// time-context 心跳分开标注；触发本轮的真人原话单独放 <trigger>，即使窗口被
// 心跳占满、即使宿主热重载清空了内存，也一定带得上。

import type { OrderSource } from '../../shared/contract'
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

/** 一轮观察素材：来源 + 用户/系统说了什么 + 模型最后说了什么。 */
export interface TurnLike {
  provenance?: OrderSource
  user?: string
  assistant?: string
  at?: number
  /** 系统代发时来自哪张卡。 */
  cardId?: string
}

export interface RecentCard {
  id: string
  title: string
  kind: string
  status: string
}

export interface PayloadContext {
  /** 触发本轮观察的最近一条真人原话。 */
  triggerUserMessage?: string
  triggerUserAt?: number
  /** 面板当前打开的卡 / 页签。 */
  ui?: { tab?: string; openCardId?: string }
  /** 同会话最近几张卡，供观察者解析「这张卡」。 */
  recentCards?: RecentCard[]
}

function timeText(at?: number): string {
  if (!at) return ''
  try {
    return new Date(at).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return ''
  }
}

function turnHead(turn: TurnLike, index: number): string {
  if (turn.provenance === 'card-answer') {
    return `【第 ${index + 1} 轮 · 系统代发${turn.cardId ? `（来源：任务卡 ${turn.cardId}）` : ''}】`
  }
  if (turn.provenance === 'system') return `【第 ${index + 1} 轮 · 系统注入】`
  return `【第 ${index + 1} 轮 · 用户原话】`
}

/**
 * 观察者的输入：最近几轮人类输入 + 系统代发 + 模型最终输出。
 * `context` 是可选的新字段，旧调用（只传三轮）仍能工作。
 */
export function buildPayload(
  turns: TurnLike[] | undefined,
  lastReply: string,
  maxBytes: number,
  context: PayloadContext = {},
): string {
  const list = Array.isArray(turns)
    ? turns.filter((turn) => turn && (turn.user || turn.assistant))
    : []
  const parts: string[] = []
  if (context.triggerUserMessage) {
    const at = timeText(context.triggerUserAt)
    parts.push('<trigger>')
    parts.push(`用户在${at ? ` ${at}` : ''} 说过：`)
    parts.push(truncateBytes(context.triggerUserMessage, 4000))
    parts.push('</trigger>')
    parts.push('')
  }
  parts.push('<conversation>')
  list.forEach((turn, index) => {
    parts.push(turnHead(turn, index))
    if (turn.user) {
      const label = turn.provenance === 'card-answer' ? '系统' : '用户'
      parts.push(`${label}：${truncateBytes(turn.user, 6000)}`)
    }
    if (turn.assistant) parts.push(`模型：${truncateBytes(turn.assistant, 12000)}`)
  })
  if (!list.length && lastReply)
    parts.push(`【本轮 · 模型最终输出】\n模型：${truncateBytes(lastReply, 12000)}`)
  parts.push('</conversation>')
  if (context.ui?.tab || context.ui?.openCardId) {
    parts.push('')
    parts.push('<ui_context>')
    if (context.ui.tab) parts.push(`页签：${context.ui.tab}`)
    if (context.ui.openCardId) parts.push(`当前打开的卡片：${context.ui.openCardId}`)
    parts.push('</ui_context>')
  }
  if (context.recentCards?.length) {
    parts.push('')
    parts.push('<recent_cards>')
    for (const card of context.recentCards.slice(0, 8)) {
      parts.push(`${card.id} | ${card.kind} | ${card.status} | ${card.title}`)
    }
    parts.push('</recent_cards>')
  }
  return truncateBytes(parts.join('\n'), maxBytes)
}
