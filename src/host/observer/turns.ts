// 一轮会话的素材状态：来源、窗口、最后一条回复。
//
// 只在这里决定「什么算用户轮次」：time-context 心跳直接丢，card-answer 单独标。

import type { OrderSource } from '../../shared/contract'
import { asNumber, asRecord } from '../host-api'
import { textOf } from '../question/record'
import type { TurnLike } from './payload'
import { isHeartbeat, provenanceOf, type TurnTrigger, turnTriggerOf } from './provenance'

export interface TurnState {
  /** 这一轮有没有「轮次触发器」（真人 / 卡片答复 / 后台任务 / 压缩检查点），心跳不算。 */
  hasTurnTrigger: boolean
  /** 最近一次轮次触发器的类型，给兜底与记录用。 */
  lastTrigger: TurnTrigger
  /** 最近一个会话事件的时间：兜底判断「多久没动」。 */
  lastEventAt: number
  lastReply: string
  usage: Record<string, number> | null
  toolCalls: number
  turn: number
  cwd: string
  turns: TurnLike[]
  lastHumanQuote: string
  lastHumanAt?: number
  lastIncomingKind: OrderSource
  lastIncomingCardId: string
  lastIncomingText: string
}

/** 一轮会话素材的空状态（兜底重建 reconcile 也用这个）。 */
export function createTurnState(): TurnState {
  return {
    hasTurnTrigger: false,
    lastTrigger: 'human',
    lastEventAt: 0,
    lastReply: '',
    usage: null,
    toolCalls: 0,
    turn: 0,
    cwd: '',
    turns: [],
    lastHumanQuote: '',
    lastIncomingKind: 'human',
    lastIncomingCardId: '',
    lastIncomingText: '',
  }
}

export function stateOfTracker(tracker: Map<string, TurnState>, sessionId: string): TurnState {
  let state = tracker.get(sessionId)
  if (!state) {
    state = createTurnState()
    tracker.set(sessionId, state)
    if (tracker.size > 500) {
      const oldest = tracker.keys().next().value
      if (oldest !== undefined) tracker.delete(oldest)
    }
  }
  return state
}

export function rememberIncoming(
  state: TurnState,
  data: Record<string, unknown>,
  cwd: string,
  at?: number,
): void {
  const source = provenanceOf(data)
  // 纯心跳（time-context / runtime-context）：不占轮次，也不改变「用户最后说了什么」。
  if (isHeartbeat(data)) return
  // 其余都算一轮：真人、卡片答复、后台任务、压缩检查点、其它系统注入都会换来模型回复。
  state.hasTurnTrigger = true
  state.lastTrigger = turnTriggerOf(data)
  state.lastReply = ''
  state.usage = null
  state.toolCalls = 0
  if (cwd) state.cwd = cwd
  const text = textOf(data)
  if (!text) return
  const turn: TurnLike = {
    provenance: source.kind,
    user: text,
    at,
    ...(source.cardId ? { cardId: source.cardId } : {}),
  }
  state.turns.push(turn)
  // 最近 3 轮人类 + 最近 2 条系统代发；心跳已在上面被丢掉。
  const humans = state.turns.filter((item) => item.provenance !== 'card-answer').slice(-3)
  const answers = state.turns.filter((item) => item.provenance === 'card-answer').slice(-2)
  state.turns = [...humans, ...answers].sort((left, right) => (left.at ?? 0) - (right.at ?? 0))
  state.lastIncomingKind = source.kind
  state.lastIncomingCardId = source.cardId
  state.lastIncomingText = text
  if (source.kind === 'human') {
    state.lastHumanQuote = text
    state.lastHumanAt = at
  }
}

export function rememberAssistantTurn(state: TurnState, data: Record<string, unknown>): void {
  const text = messageTextOf(data.message)
  if (text) {
    state.lastReply = text
    const latest = state.turns[state.turns.length - 1]
    if (latest) latest.assistant = text
  }
  const usage = asRecord(data.usage)
  if (Object.keys(usage).length) state.usage = usage as Record<string, number>
  const turn = asNumber(data.turn)
  if (turn !== null) state.turn = turn
}

function messageTextOf(message: unknown): string {
  const value = asRecord(message)
  if (!Array.isArray(value.content)) return ''
  return value.content
    .map((block) => {
      const entry = asRecord(block)
      return entry.type === 'text' && typeof entry.text === 'string' ? entry.text : ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}
