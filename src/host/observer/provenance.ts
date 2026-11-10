// 一条 user/message 到底是谁发的。
//
// 同一个事件类型下混着三种东西：真人输入、任务卡系统代发的答复、运行时上下文
// （time-context 心跳）。观察者过去一律当「用户」，于是 17:35:32 那条自动投递的
// 卡片答案被记成了用户原话。这里把来源拆开，后面的窗口和卡片只认 human。

import type { OrderSource } from '../../shared/contract'
import { asRecord, asString } from '../host-api'

export const CARD_ANSWER_MARK = '〔任务卡答复'

export interface Provenance {
  kind: OrderSource
  /** 系统代发时来自哪张卡；解析不到为空串。 */
  cardId: string
}

/** 文本兜底：即使宿主不保留 rpcId，投递时加的标记也能认出来。 */
const CARD_MARK = /〔任务卡答复\s*[:：]?\s*(c-[A-Za-z0-9_-]+)?/

export function provenanceOf(data: Record<string, unknown> | undefined): Provenance {
  const value = asRecord(data)
  const source = asRecord(value.source)
  const kind = asString(source.kind)
  const rpcId = asString(source.rpcId)
  const text = asString(value.text) || messageTextOf(value)
  // 任务卡插件自己注入的 user-role 消息：kind 是我们自己的，卡 id 在 source 上。
  if (kind === 'dsh-task-cards' || kind === 'card-answer') {
    return { kind: 'card-answer', cardId: asString(source.cardId) || cardIdFromText(text) }
  }
  if (kind === 'time-context') return { kind: 'system', cardId: '' }
  if (kind && kind !== 'user') return { kind: 'system', cardId: '' }
  if (rpcId.startsWith('card-answer-')) return { kind: 'card-answer', cardId: cardIdFromText(text) }
  if (text.startsWith(CARD_ANSWER_MARK))
    return { kind: 'card-answer', cardId: cardIdFromText(text) }
  return { kind: 'human', cardId: '' }
}

/**
 * 一次 user/message 算不算「一轮」的触发器。
 *
 * 只有 time-context / runtime-context 这类纯心跳不算轮次；`tool-jobs`、`card-answer`、
 * `compact-checkpoint` 都会让模型真的继续干一轮，过去的判据只看 kind==='user'，
 * 把这些回合全丢了（真实事故：`tool-jobs` 触发的回合被判「没有用户输入」）。
 */
export type TurnTrigger = 'human' | 'card-answer' | 'tool-jobs' | 'compact-checkpoint' | 'system'

const HEARTBEAT_KINDS = new Set(['time-context', 'runtime-context'])
const TOOL_JOB_KINDS = new Set(['tool-jobs', 'tool-job', 'jobs', 'background-job'])
const CHECKPOINT_KINDS = new Set(['compact-checkpoint', 'compaction', 'checkpoint'])

export function turnTriggerOf(data: Record<string, unknown> | undefined): TurnTrigger {
  const source = asRecord(asRecord(data).source)
  const kind = asString(source.kind)
  const provenance = provenanceOf(data)
  if (provenance.kind === 'card-answer') return 'card-answer'
  if (provenance.kind === 'human') return 'human'
  if (HEARTBEAT_KINDS.has(kind)) return 'system'
  if (TOOL_JOB_KINDS.has(kind)) return 'tool-jobs'
  if (CHECKPOINT_KINDS.has(kind)) return 'compact-checkpoint'
  // 其它系统注入（skill 注入、续跑提示等）也会换来一轮模型回复，算触发。
  return 'system'
}

/** 心跳不算轮次：这一类事件既不占回合，也不改变「用户最后说了什么」。 */
export function isHeartbeat(data: Record<string, unknown> | undefined): boolean {
  const source = asRecord(asRecord(data).source)
  return HEARTBEAT_KINDS.has(asString(source.kind))
}

/** 从 `〔任务卡答复 c-xxx「标题」〕` 里取卡片 id。 */
export function cardIdFromText(text: string): string {
  const match = CARD_MARK.exec(text)
  return match && match[1] ? match[1] : ''
}

function messageTextOf(value: Record<string, unknown>): string {
  const content = Array.isArray(value.content)
    ? value.content
    : Array.isArray(asRecord(value.message).content)
      ? (asRecord(value.message).content as unknown[])
      : []
  return content
    .map((block) => asString(asRecord(block).text))
    .filter(Boolean)
    .join('\n')
}
