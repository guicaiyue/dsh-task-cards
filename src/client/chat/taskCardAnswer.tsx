// 任务卡答复的 Chat 节点：只认插件自己注入的 user-role 消息，不抢别的非人工触发。
//
// DSH 的内置 input-message 会把 source.kind !== 'user' 的消息渲染成 turn-trigger；
// 我们在这里注册一个更窄的 Definition，用自己的节点 kind 和文案，保留内置对其他
// 来源（子代理、定时任务、webhook…）的处理。

import { useState } from 'react'

import type { Translate } from '../types'

export const TASK_CARD_NODE_KIND = 'dsh-task-card-answer'

interface ChatEvent {
  type: string
  seq: number
  time: number
  data?: Record<string, unknown>
}

interface ChatMatch {
  event: ChatEvent
  role: 'start'
  location?: unknown
}

interface ChatContext {
  key: string
  id: string
  start?: ChatMatch
  matches: ChatMatch[]
  state?: TaskCardAnswerState
}

export interface TaskCardAnswerState {
  kind: typeof TASK_CARD_NODE_KIND
  seq: number
  time: number
  content: Array<Record<string, unknown>>
  source: Record<string, unknown>
  body: string
  cardId: string
  cardTitle: string
}

const MARK = /^〔任务卡答复\s*(c-[^「\n]*)?「([^」\n]*)」〕\n?/

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const item = record(block)
      return item.type === 'text' && typeof item.text === 'string' ? item.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function stateOf(event: ChatEvent): TaskCardAnswerState {
  const content = Array.isArray(event.data?.content)
    ? (event.data.content as Array<Record<string, unknown>>)
    : []
  const source = record(event.data?.source)
  const raw = textOf(content)
  const match = MARK.exec(raw)
  return {
    kind: TASK_CARD_NODE_KIND,
    seq: event.seq,
    time: event.time,
    content,
    source,
    body: raw.replace(MARK, ''),
    cardId: match?.[1] || String(source.cardId || ''),
    cardTitle: match?.[2] || String(source.cardTitle || ''),
  }
}

/** 只认插件自己的 source kind；旧版 card-answer rpcId / 文本标记也收进来。 */
export const taskCardAnswerDefinition = {
  kind: TASK_CARD_NODE_KIND,
  target: 'chat',
  match(event: ChatEvent): { id: string; role: 'start'; exclusive: true } | null {
    if (event.type !== 'user/message') return null
    const data = record(event.data)
    const source = record(data.source)
    const id = typeof data.id === 'string' ? data.id : ''
    if (!id) return null
    const rpcId = typeof source.rpcId === 'string' ? source.rpcId : ''
    const marked = textOf(data.content).startsWith('〔任务卡答复')
    if (source.kind !== 'dsh-task-cards' && !rpcId.startsWith('card-answer-') && !marked)
      return null
    return { id, role: 'start', exclusive: true }
  },
  start(_context: unknown, match: ChatMatch): TaskCardAnswerState {
    return stateOf(match.event)
  },
  update(context: ChatContext): TaskCardAnswerState {
    return (
      context.state ?? stateOf(context.start?.event ?? { type: 'user/message', seq: 0, time: 0 })
    )
  },
  buildViewNode(context: ChatContext): Record<string, unknown> {
    const state = context.state
    if (!state)
      return {
        key: context.key,
        kind: 'unknown',
        id: context.id,
        target: 'chat',
        anchorSeq: 0,
        visibility: 'hidden',
        data: {},
      }
    return {
      key: context.key,
      kind: TASK_CARD_NODE_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: state.seq,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      groupTree: 'input',
      data: state,
    }
  },
}

interface NodeProps {
  node?: { data?: TaskCardAnswerState }
  t?: Translate
}

export function TaskCardAnswerNodeView({ node, t }: NodeProps) {
  const [open, setOpen] = useState(false)
  const data = node?.data
  if (!data) return null
  const label = (key: string, vars?: Record<string, string | number>) => (t ? t(key, vars) : key)
  const time = new Date(data.time).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <section className="dtc-trigger" data-turn-trigger>
      <button
        type="button"
        className="dtc-trigger-header"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="dtc-trigger-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" stroke="currentColor" />
            <path d="M5 6h6M5 8.5h6M5 11h3.5" stroke="currentColor" strokeLinecap="round" />
          </svg>
        </span>
        <span className="dtc-trigger-title">{label('cardAnswerTitle')}</span>
        <time className="dtc-trigger-time" dateTime={new Date(data.time).toISOString()}>
          {time}
        </time>
        <span
          className={open ? 'dtc-trigger-chevron is-open' : 'dtc-trigger-chevron'}
          aria-hidden="true"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M2.5 4.5 6 8l3.5-3.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open ? (
        <div className="dtc-trigger-body">
          <p className="dtc-trigger-explanation">{label('cardAnswerExplanation')}</p>
          {data.cardTitle ? (
            <div className="dtc-trigger-source">
              {label('cardAnswerSource', { card: data.cardTitle })}
            </div>
          ) : null}
          <div className="dtc-trigger-content">{data.body}</div>
        </div>
      ) : null}
    </section>
  )
}
