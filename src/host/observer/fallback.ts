// 观察者兜底：回合结束事件漏了 / 坏了 / 被跳过时，定时补一次观察。
//
// 为什么需要：触发只有 `agent/status → idle` 一条路，HMR 重载、长回合、坏回合、
// 连发回合都可能让这条事件失真，而缺一次观察就是永久缺（真实事故：70 分钟回合
// 零卡、turn 15/16/17 无记录、首轮被跳过）。这里做两件事：
//   1. 定时扫「有素材但没被消费」的会话，补一次观察（同一轮按指纹只补一次）；
//   2. 跳过不再静默：写一条 records.status='skipped'，面板记录页能看到为什么没观察。

import type { ObserverRecord, Settings } from '../../shared/contract'
import type { RecordStore } from '../cards/store'
import type { Log, SessionEventLike } from '../host-api'
import { asNumber, asRecord, asString } from '../host-api'
import { createTurnState, rememberAssistantTurn, rememberIncoming, type TurnState } from './turns'

/** 多久没新事件才认为「这一轮真的结束了」（兜底扫描用）。 */
export const FALLBACK_IDLE_MS = 120_000
const INTERVAL_MS = 30_000
/** 跳过之后等这么久再尝试补观察（给事件落盘留时间）。 */
const PENDING_SETTLE_MS = 2_000
const MAX_ATTEMPTS = 2

/** 跨热重载保留：已观察指纹与待补观察的会话。 */
const SEEN_KEY = Symbol.for('dsh-task-cards.observer-fallback-seen')
const PENDING_KEY = Symbol.for('dsh-task-cards.observer-fallback-pending')

interface Pending {
  at: number
  attempts: number
  why: string
}

export interface FallbackDeps {
  settings: () => Settings
  tracker: () => Map<string, TurnState>
  records: RecordStore
  log: Log
  now?: () => number
  /** 从会话日志重建素材；拿不到返回 null。 */
  readSession?: (sessionId: string) => Promise<SessionEventLike[] | null>
  /** 复用正常路径的构造器跑一次观察者；返回是否真的跑过。 */
  observe: (sessionId: string, state: TurnState, why: string) => Promise<boolean>
  idleMs?: number
}

function sharedMap<V>(key: symbol): Map<string, V> {
  const bag = globalThis as unknown as Record<symbol, Map<string, V> | undefined>
  const existing = bag[key]
  if (existing) return existing
  const created = new Map<string, V>()
  bag[key] = created
  return created
}

/** 同一轮的身份：turn + 最后回复的尾巴。换一轮就换指纹。 */
export function stateFingerprint(state: TurnState): string {
  const tail = state.lastReply.slice(-24)
  return `${state.turn}|${state.lastReply.length}|${tail}`
}

/** 有素材、且超过 idleMs 没新事件才算「可以补观察」。 */
export function shouldSweep(state: TurnState | undefined, now: number, idleMs: number): boolean {
  if (!state) return false
  if (!state.hasTurnTrigger || !state.lastReply) return false
  return state.lastEventAt > 0 && now - state.lastEventAt >= idleMs
}

/** 从会话事件流重建一轮素材（漏事件 / 热重载 / 坏回合的兜底）。 */
export function rebuildTurnState(
  events: readonly SessionEventLike[],
  now: number = Date.now(),
): TurnState | null {
  const state = createTurnState()
  for (const event of events) {
    const data = asRecord(event.data)
    const at = asNumber(event.time) ?? undefined
    if (at !== undefined) state.lastEventAt = at
    if (event.type === 'user/message') rememberIncoming(state, data, '', at)
    else if (event.type === 'assistant/message') rememberAssistantTurn(state, data)
  }
  if (!state.lastEventAt) state.lastEventAt = now
  if (!state.hasTurnTrigger || !state.lastReply) return null
  return state
}

export class FallbackSweeper {
  readonly #deps: FallbackDeps
  readonly #seen = sharedMap<string>(SEEN_KEY)
  readonly #pending = sharedMap<Pending>(PENDING_KEY)
  #timer: ReturnType<typeof setInterval> | null = null
  #busy = false

  constructor(deps: FallbackDeps) {
    this.#deps = deps
  }

  get pendingCount(): number {
    return this.#pending.size
  }

  #now(): number {
    return (this.#deps.now ?? Date.now)()
  }

  #enabled(): boolean {
    const settings = this.#deps.settings()
    return settings.enabled && settings.fallbackObserve
  }

  /** 正常路径观察成功：登记指纹，兜底不再重复看同一轮。 */
  markObserved(sessionId: string, state: TurnState): void {
    this.#seen.set(sessionId, stateFingerprint(state))
    this.#pending.delete(sessionId)
  }

  /**
   * 正常路径跳过了某一轮：写一条 skipped 记录（面板可见），并登记待补观察。
   * 这一轮已经在别处观察过（同指纹）就不再记，避免噪声。
   */
  async noteSkip(sessionId: string, state: TurnState | undefined, reason: string): Promise<void> {
    if (state && this.#seen.get(sessionId) === stateFingerprint(state)) {
      this.#pending.delete(sessionId)
      return
    }
    this.#pending.set(sessionId, { at: this.#now(), attempts: 0, why: reason })
    if (!this.#enabled()) return
    try {
      await this.#deps.records.add({
        phase: 'observer',
        status: 'skipped',
        originSessionId: sessionId,
        ...(state?.turn ? { turn: state.turn } : {}),
        error: reason,
        skipReason: reason,
        attempts: 0,
      } as Omit<ObserverRecord, 'id' | 'at'> & Record<string, unknown>)
    } catch (err) {
      this.#deps.log(`跳过记录写入失败：${sessionId} — ${messageOf(err)}`)
    }
  }

  start(): void {
    if (this.#timer) return
    const timer = setInterval(() => {
      this.sweep().catch((err: unknown) => this.#deps.log(`兜底扫描失败：${messageOf(err)}`))
    }, INTERVAL_MS)
    timer.unref?.()
    this.#timer = timer
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
  }

  /** 扫一遍：先补「有素材但没人消费」的会话，再补被跳过的会话。 */
  async sweep(): Promise<string[]> {
    if (this.#busy || !this.#enabled()) return []
    this.#busy = true
    try {
      const observed: string[] = []
      const now = this.#now()
      const idleMs = this.#deps.idleMs ?? FALLBACK_IDLE_MS
      for (const [sessionId, state] of this.#deps.tracker()) {
        if (!shouldSweep(state, now, idleMs)) continue
        if (this.#seen.get(sessionId) === stateFingerprint(state)) continue
        if (await this.#observe(sessionId, state, 'stale-turn')) observed.push(sessionId)
      }
      for (const [sessionId, pending] of [...this.#pending]) {
        if (now - pending.at < PENDING_SETTLE_MS) continue
        const state = this.#deps.tracker().get(sessionId) ?? (await this.#rebuild(sessionId))
        if (!state) {
          this.#expire(sessionId, pending, '没有可重建的素材')
          continue
        }
        if (this.#seen.get(sessionId) === stateFingerprint(state)) {
          this.#pending.delete(sessionId)
          continue
        }
        pending.attempts += 1
        if (pending.attempts > MAX_ATTEMPTS) {
          this.#expire(sessionId, pending, '补观察次数用尽')
          continue
        }
        if (await this.#observe(sessionId, state, `recover:${pending.why}`))
          observed.push(sessionId)
      }
      return observed
    } finally {
      this.#busy = false
    }
  }

  async #rebuild(sessionId: string): Promise<TurnState | null> {
    if (!this.#deps.readSession) return null
    try {
      const events = await this.#deps.readSession(sessionId)
      return events ? rebuildTurnState(events, this.#now()) : null
    } catch (err) {
      this.#deps.log(`兜底重建失败：${sessionId} — ${messageOf(err)}`)
      return null
    }
  }

  async #observe(sessionId: string, state: TurnState, why: string): Promise<boolean> {
    try {
      const ok = await this.#deps.observe(sessionId, state, why)
      this.#seen.set(sessionId, stateFingerprint(state))
      this.#pending.delete(sessionId)
      this.#deps.tracker().delete(sessionId)
      this.#deps.log(`兜底观察（${why}）：${sessionId} 回合 ${state.turn}`)
      return ok
    } catch (err) {
      this.#deps.log(`兜底观察失败：${sessionId} — ${messageOf(err)}`)
      return false
    }
  }

  #expire(sessionId: string, pending: Pending, why: string): void {
    this.#pending.delete(sessionId)
    this.#deps.log(`兜底放弃：${sessionId}（${pending.why} → ${why}）`)
  }
}

function messageOf(err: unknown): string {
  return (err as Error)?.message || String(err)
}

/** 会话日志里最后一个 assistant 文本（兜底判「有没有可观察的回复」用）。 */
export function lastReplyOf(events: readonly SessionEventLike[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event || event.type !== 'assistant/message') continue
    const content = asRecord(event.data).message
    const blocks = asRecord(content).content
    const text = Array.isArray(blocks)
      ? blocks
          .map((block) => asString(asRecord(block).text))
          .filter(Boolean)
          .join('\n')
      : ''
    if (text) return text
  }
  return ''
}
