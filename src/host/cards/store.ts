// 四份本机数据：卡、观察者设置、调用记录、判例。
//
// 落盘底座（路径 / JsonDoc / 短 id / 业务错误）在 ./doc.ts；这里只放领域读写。
// 落点与其它插件一致：$DSH_HOME/dsh-task-cards/*.json

import type {
  Card,
  CardAction,
  CardKind,
  CardSeverity,
  ObserverRecord,
  Settings,
} from '../../shared/contract'
import { DEFAULT_SETTINGS } from './defaults'
import { DATA_FILE, JsonDoc, nextId, RECORDS_FILE, SETTINGS_FILE, StoreError } from './doc'

export {
  DATA_DIR,
  DATA_FILE,
  JsonDoc,
  PRECEDENTS_FILE,
  RECORDS_FILE,
  SETTINGS_FILE,
  StoreError,
} from './doc'

export const MAX_TITLE = 200
const STATES = new Set(['todo', 'done'])

/** 磁盘上是数组（新）或 {cards: [...]}（旧）：两种都认。 */
type StoredCards = Card[] | { cards: Card[] }

export interface CreateCardOptions {
  detail?: unknown
  kind?: unknown
  severity?: unknown
  action?: unknown
  source?: unknown
  interaction?: unknown
  question?: unknown
  origin?: unknown
}

function normalizeKind(value: unknown): CardKind {
  return value === 'decision' || value === 'auto' ? value : 'info'
}

function normalizeSeverity(value: unknown): CardSeverity {
  return value === 'high' || value === 'low' ? value : 'normal'
}

function normalizeAction(value: unknown): CardAction | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const type = raw.type === 'retry' ? 'retry' : 'prompt'
  const delay = Number(raw.delayMs)
  const delayMs = Number.isFinite(delay) ? Math.max(0, Math.trunc(delay)) : 600000
  const input = typeof raw.input === 'string' ? raw.input : ''
  if (!input) return null
  const sessionId = typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId : undefined
  return { type, delayMs, input, ...(sessionId ? { sessionId } : {}) }
}

export class Store {
  #doc: JsonDoc<StoredCards>

  /** @param file 测试可换路径；默认 $DSH_HOME/dsh-task-cards/cards.json */
  constructor(file: string = DATA_FILE) {
    this.#doc = new JsonDoc<StoredCards>(file, () => [])
  }

  get file(): string {
    return this.#doc.file
  }

  get warning(): string | null {
    return this.#doc.warning
  }

  #cards(): Card[] {
    const value = this.#doc.read()
    return Array.isArray(value) ? value : value.cards
  }

  list(): Card[] {
    return this.#cards().map((card) => ({ ...card }))
  }

  async create(title: unknown, extra: CreateCardOptions = {}): Promise<Card> {
    const text = String(title ?? '').trim()
    if (!text) throw new StoreError('EMPTY_TITLE', '标题不能为空')
    if (text.length > MAX_TITLE)
      throw new StoreError('TITLE_TOO_LONG', `标题最多 ${MAX_TITLE} 个字`)
    const now = Date.now()
    const action = normalizeAction(extra.action)
    const dueAt = action ? now + (Number.isFinite(action.delayMs) ? action.delayMs : 600000) : null
    const card: Card = {
      id: nextId('c'),
      title: text,
      detail: typeof extra.detail === 'string' ? extra.detail.slice(0, 1000) : '',
      kind: normalizeKind(extra.kind),
      severity: normalizeSeverity(extra.severity),
      // open 未处理 / acknowledged 已读 / scheduled 已排自动动作 / done 已完成 / dismissed 忽略
      status: action ? 'scheduled' : 'open',
      action,
      dueAt,
      source: extra.source === 'agent' ? 'agent' : 'human',
      // 两种交互：question = 模型提问把对话卡住了；reply = 一轮回复结束后的记录。
      interaction: extra.interaction === 'question' ? 'question' : 'reply',
      question: (extra.question as Card['question']) ?? null,
      origin: (extra.origin as Card['origin']) ?? null,
      advice: null,
      createdAt: now,
      updatedAt: now,
      events: [{ at: now, type: 'created', via: extra.source === 'agent' ? 'agent' : 'human' }],
    }
    this.#cards().unshift(card)
    await this.#doc.write(this.#cards())
    return { ...card }
  }

  find(id: string): Card | undefined {
    return this.#cards().find((item) => item.id === id)
  }

  /** 到点该跑自动动作的卡。 */
  due(now: number = Date.now()): Card[] {
    return this.#cards().filter(
      (card) =>
        card.status === 'scheduled' &&
        card.action &&
        typeof card.dueAt === 'number' &&
        card.dueAt <= now,
    )
  }

  /** 统一的改状态入口：所有变更都留一条事件。 */
  async patch(id: string, changes: Partial<Card>, event?: string): Promise<Card> {
    const card = this.#cards().find((item) => item.id === id)
    if (!card) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')
    Object.assign(card, changes, { updatedAt: Date.now() })
    card.events.push({ at: Date.now(), type: event || 'updated' })
    await this.#doc.write(this.#cards())
    return { ...card }
  }

  async setState(id: string, state: string): Promise<Card> {
    if (!STATES.has(state)) throw new StoreError('BAD_STATE', '未知状态')
    return this.patch(
      id,
      { status: state === 'done' ? 'done' : 'open' },
      state === 'done' ? 'completed' : 'reopened',
    )
  }

  async remove(id: string): Promise<{ id: string }> {
    const cards = this.#cards()
    const index = cards.findIndex((item) => item.id === id)
    if (index < 0) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')
    cards.splice(index, 1)
    await this.#doc.write(cards)
    return { id }
  }
}

export class SettingsStore {
  #doc: JsonDoc<Partial<Settings>>

  constructor(file: string = SETTINGS_FILE) {
    this.#doc = new JsonDoc<Partial<Settings>>(file, () => ({ ...DEFAULT_SETTINGS }))
  }

  get file(): string {
    return this.#doc.file
  }

  get(): Settings {
    return { ...DEFAULT_SETTINGS, ...this.#doc.read() }
  }

  async set(patch: Partial<Settings>): Promise<Settings> {
    const current = this.get()
    const next: Settings = { ...current }
    if (typeof patch.systemPrompt === 'string') next.systemPrompt = patch.systemPrompt
    if (typeof patch.provider === 'string') next.provider = patch.provider
    if (typeof patch.model === 'string') next.model = patch.model
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
    if (typeof patch.minReplyChars === 'number' && Number.isFinite(patch.minReplyChars))
      next.minReplyChars = Math.max(0, Math.trunc(patch.minReplyChars))
    if (typeof patch.maxInputBytes === 'number' && Number.isFinite(patch.maxInputBytes))
      next.maxInputBytes = Math.max(200, Math.trunc(patch.maxInputBytes))
    if (typeof patch.timeoutMs === 'number' && Number.isFinite(patch.timeoutMs))
      next.timeoutMs = Math.max(1000, Math.trunc(patch.timeoutMs))
    // 决策代理人：面板里可改开关、提示词、模型与判例条数。
    if (typeof patch.decisionEnabled === 'boolean') next.decisionEnabled = patch.decisionEnabled
    if (typeof patch.decisionPrompt === 'string') next.decisionPrompt = patch.decisionPrompt
    if (typeof patch.decisionProvider === 'string') next.decisionProvider = patch.decisionProvider
    if (typeof patch.decisionModel === 'string') next.decisionModel = patch.decisionModel
    if (
      typeof patch.decisionPrecedentLimit === 'number' &&
      Number.isFinite(patch.decisionPrecedentLimit)
    )
      next.decisionPrecedentLimit = Math.max(0, Math.trunc(patch.decisionPrecedentLimit))
    // 自动执行开关：面板关掉以后，任何票拟都不许代跑。
    if (typeof patch.decisionAutoApply === 'boolean')
      next.decisionAutoApply = patch.decisionAutoApply
    await this.#doc.write(next)
    return next
  }
}

const RECORD_LIMIT = 200

export class RecordStore {
  #doc: JsonDoc<ObserverRecord[]>

  constructor(file: string = RECORDS_FILE) {
    this.#doc = new JsonDoc<ObserverRecord[]>(file, () => [])
  }

  get file(): string {
    return this.#doc.file
  }

  list(limit: number = RECORD_LIMIT): ObserverRecord[] {
    const all = this.#doc.read()
    return (Array.isArray(all) ? all : []).slice(0, Math.max(1, limit))
  }

  /** 按 phase 过滤（面板的决策记录只看 decision）：倒序，最多 limit 条。 */
  listByPhase(phase: ObserverRecord['phase'], limit: number = RECORD_LIMIT): ObserverRecord[] {
    const all = this.#doc.read()
    return (Array.isArray(all) ? all : [])
      .filter((record) => (record.phase || 'observer') === phase)
      .slice(0, Math.max(1, limit))
      .map((record) => ({ ...record }))
  }

  async add(
    record: Omit<ObserverRecord, 'id' | 'at'> & Record<string, unknown>,
  ): Promise<ObserverRecord> {
    const all = this.#doc.read()
    const list = Array.isArray(all) ? all : []
    const entry = { id: nextId('r'), at: Date.now(), ...record } as ObserverRecord
    list.unshift(entry)
    if (list.length > RECORD_LIMIT) list.length = RECORD_LIMIT
    await this.#doc.write(list)
    return entry
  }
}

/** 判例库在 ./precedents.ts（JsonDoc 复用）；调用方仍然从 store 取。 */
export { type PrecedentInput, PrecedentStore } from './precedents'
