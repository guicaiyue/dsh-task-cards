// 通用 source-kind 文案映射：替换内置 turn-trigger 的渲染。
//
// DSH 内置只给 goal/subagent/schedule 等几个 kind 配了英文 key，插件自己的
// dsh-task-cards、card-answer 以及未来的 source 都会落成「请求」。这里收口成
// 一张可维护的映射表：kind（webhook 再看 provider）→ 中文/英文标签 + 图标族。

import type React from 'react'
import { useState } from 'react'

import type { Translate } from '../types'

interface TriggerData {
  time?: number
  content?: unknown
  source?: Record<string, unknown>
}

interface NodeProps {
  node?: { data?: TriggerData }
  t?: Translate
}

type IconFamily =
  | 'agent'
  | 'goal'
  | 'team'
  | 'subagent'
  | 'webhook'
  | 'schedule'
  | 'job'
  | 'plugin'
  | 'request'

const FAMILY: Record<string, { key: string; icon: IconFamily }> = {
  user: { key: 'sourceKindUser', icon: 'agent' },
  goal: { key: 'sourceKindGoal', icon: 'goal' },
  'agent-message': { key: 'sourceKindAgent', icon: 'agent' },
  'team-message': { key: 'sourceKindTeam', icon: 'team' },
  'subagent-settled': { key: 'sourceKindSubagent', icon: 'subagent' },
  webhook: { key: 'sourceKindWebhook', icon: 'webhook' },
  schedule: { key: 'sourceKindSchedule', icon: 'schedule' },
  'tool-jobs': { key: 'sourceKindJob', icon: 'job' },
  'cordis-host-runner': { key: 'sourceKindPlugin', icon: 'plugin' },
  'dsh-task-cards': { key: 'sourceKindTaskCards', icon: 'plugin' },
  'card-answer': { key: 'sourceKindCardAnswer', icon: 'plugin' },
  'agent-instructions': { key: 'sourceKindAgentInstructions', icon: 'agent' },
  'skill-catalog': { key: 'sourceKindSkill', icon: 'request' },
  'compact-checkpoint': { key: 'sourceKindCompaction', icon: 'request' },
  'time-context': { key: 'sourceKindTime', icon: 'request' },
}

/** 纯映射，测试和排错直接看它；没有登记的 kind 明确显示「其他来源」。 */
export function sourceKindKey(kind: string, provider?: string): string {
  if (kind === 'webhook' && provider === 'github') return 'sourceKindGithub'
  return FAMILY[kind]?.key || 'sourceKindOther'
}

function sourceIcon(kind: string, provider?: string): IconFamily {
  if (kind === 'webhook' && provider === 'github') return 'webhook'
  return FAMILY[kind]?.icon || 'request'
}

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

const GLYPHS: Record<IconFamily, React.ReactNode> = {
  schedule: (
    <>
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" />
      <path d="M8 5v3.2l2 1.3" stroke="currentColor" strokeLinecap="round" />
    </>
  ),
  webhook: (
    <>
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" />
      <path d="M2.8 8h10.4M8 2.5c2.4 2 2.4 9 0 11M8 2.5c-2.4 2-2.4 9 0 11" stroke="currentColor" />
    </>
  ),
  goal: (
    <>
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" />
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" />
    </>
  ),
  team: (
    <>
      <circle cx="5.5" cy="6" r="2" stroke="currentColor" />
      <circle cx="10.5" cy="6" r="2" stroke="currentColor" />
      <path
        d="M2.8 12c.4-2 1.5-3 2.7-3s2.3 1 2.7 3M10.5 9c1.2 0 2.3 1 2.7 3"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </>
  ),
  job: <path d="M3 4.5h10M3 8h10M3 11.5h6" stroke="currentColor" strokeLinecap="round" />,
  plugin: (
    <>
      <rect x="3" y="3.5" width="10" height="9" rx="2" stroke="currentColor" />
      <path d="M6 7h4M6 9.5h2.5" stroke="currentColor" strokeLinecap="round" />
    </>
  ),
  subagent: (
    <>
      <rect x="3" y="3.5" width="10" height="9" rx="2" stroke="currentColor" />
      <path d="M6 7h4M6 9.5h2.5" stroke="currentColor" strokeLinecap="round" />
    </>
  ),
  agent: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="3" stroke="currentColor" />
      <path d="M5 6h6M5 8.5h6M5 11h3.5" stroke="currentColor" strokeLinecap="round" />
    </>
  ),
  request: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="3" stroke="currentColor" />
      <path d="M5 6h6M5 8.5h6M5 11h3.5" stroke="currentColor" strokeLinecap="round" />
    </>
  ),
}

function Glyph({ family }: { family: IconFamily }) {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {GLYPHS[family]}
    </svg>
  )
}

/** 替换内置 turn-trigger：按 source.kind 显示可读标签，不再一律「请求」。 */
export function GenericTurnTriggerNodeView({ node, t }: NodeProps) {
  const [open, setOpen] = useState(false)
  const data = node?.data
  if (!data) return null
  const source = record(data.source)
  const kind = typeof source.kind === 'string' ? source.kind : ''
  const provider = typeof source.provider === 'string' ? source.provider : ''
  const label = (key: string, vars?: Record<string, string | number>) => (t ? t(key, vars) : key)
  const time = new Date(data.time ?? 0).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  const body = textOf(data.content)
  const extra = [source.cardTitle, source.cardId, source.goalId, source.scheduleId]
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .join(' · ')
  return (
    <section className="dtc-trigger" data-turn-trigger>
      <button
        type="button"
        className="dtc-trigger-header"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="dtc-trigger-icon">
          <Glyph family={sourceIcon(kind, provider)} />
        </span>
        <span className="dtc-trigger-title">{label(sourceKindKey(kind, provider))}</span>
        <time className="dtc-trigger-time" dateTime={new Date(data.time ?? 0).toISOString()}>
          {time}
        </time>
        <span className={open ? 'dtc-trigger-chevron is-open' : 'dtc-trigger-chevron'}>
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
          <p className="dtc-trigger-explanation">
            {label('sourceNoticeExplanation', { label: label(sourceKindKey(kind, provider)) })}
          </p>
          {extra ? <div className="dtc-trigger-source">{extra}</div> : null}
          {body ? <div className="dtc-trigger-content">{body}</div> : null}
        </div>
      ) : null}
    </section>
  )
}
