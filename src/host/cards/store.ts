// 三份本机数据：卡、观察者设置、调用记录。
//
// 都用「一个 JSON 文件 + 原子写」。不接 storageDomain：那要 domain spec、
// zod schema 和 backend route 三样东西，现阶段换来的是零收益的复杂度。
//
// 落点与其它插件一致：$DSH_HOME/dsh-task-cards/*.json

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  Card,
  CardAction,
  CardKind,
  CardSeverity,
  ObserverRecord,
  Settings,
} from '../../shared/contract'
import { DEFAULT_SETTINGS } from './defaults'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
export const DATA_DIR = path.join(DSH_HOME, 'dsh-task-cards')
export const DATA_FILE = path.join(DATA_DIR, 'cards.json')
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
export const RECORDS_FILE = path.join(DATA_DIR, 'records.json')

export const MAX_TITLE = 200
const STATES = new Set(['todo', 'done'])

/** 带稳定 code 的业务错误：路由层据此回 400 而不是 500。 */
export class StoreError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** 一个 JSON 文档：懒加载、原子写、写失败抛出去。 */
class JsonDoc<T> {
  readonly file: string
  #value: T | undefined
  #chain: Promise<void> = Promise.resolve()
  #warning: string | null = null
  #fallback: () => T

  constructor(file: string, fallback: () => T) {
    this.file = file
    this.#fallback = fallback
  }

  get warning(): string | null {
    return this.#warning
  }

  read(): T {
    if (this.#value !== undefined) return this.#value
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      this.#value = JSON.parse(raw) as T
    } catch (err) {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.#value = this.#fallback()
      } else {
        // 坏文件不静默丢：挪到旁边，界面能看到 warning。
        this.#warning = `数据文件无法解析，已挪到旁边：${(err as Error)?.message || String(err)}`
        this.#value = this.#fallback()
        try {
          fs.renameSync(this.file, `${this.file}.bad-${Date.now()}`)
        } catch {
          /* 挪不动也不挡开工 */
        }
      }
    }
    return this.#value as T
  }

  write(value: T): Promise<void> {
    this.#value = value
    const run = async () => {
      await fsp.mkdir(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
      await fsp.rename(tmp, this.file)
    }
    const next = this.#chain.then(run, run)
    this.#chain = next.catch(() => {})
    return next
  }
}

let counter = 0
function nextId(prefix: string): string {
  counter = (counter + 1) % 1e6
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

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
