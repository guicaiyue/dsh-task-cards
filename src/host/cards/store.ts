// 四份本机数据：卡、观察者设置、调用记录、判例。
//
// 落盘底座（路径 / JsonDoc / 短 id / 业务错误）在 ./doc.ts；这里只放领域读写。
// 落点与其它插件一致：$DSH_HOME/dsh-task-cards/*.json

import type { Card, CardAction, CardKind, CardSeverity, Settings } from '../../shared/contract'
import { decisionAfter, fillDecision } from '../../shared/decision-state'
import { DEFAULT_SETTINGS } from './defaults'
import { DATA_FILE, JsonDoc, nextId, SETTINGS_FILE, StoreError } from './doc'

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
  ask?: unknown
  origin?: unknown
  /** 用户在原会话里已经看过了：落盘即 acknowledged，并留一条 `via: silent` 事件。 */
  silent?: unknown
  /** 可核验的产物路径（失败类卡的过期对账用）。 */
  artifacts?: string[]
  /** 批准时冻结的验收检查（创建时可由观察者草稿带入，批准时冻结 planId）。 */
  acceptance?: Card['acceptance']
  planId?: string
  /** 阶段 D：三级验收语义票据。 */
  semantic?: Card['semantic']
  /** 阶段 E/G2：卡片级依赖（卡 id）。 */
  blockedBy?: string[]
}

function normalizeKind(value: unknown): CardKind {
  return value === 'decision' || value === 'auto' ? value : 'info'
}

function normalizeSeverity(value: unknown): CardSeverity {
  return value === 'high' || value === 'low' ? value : 'normal'
}

function normalizeAsk(value: unknown): Card['ask'] {
  return value === 'permission' || value === 'clarification' ? value : 'judgment'
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

function cardsOf(current: StoredCards): Card[] {
  return Array.isArray(current) ? current : current.cards
}

/** 写回时保持原文件的形状（数组 or {cards}），别把旧格式悄悄换掉。 */
function keepShape(current: StoredCards, cards: Card[]): StoredCards {
  return Array.isArray(current) ? cards : { cards }
}

function requireCard(current: StoredCards, id: string): Card {
  const card = cardsOf(current).find((item) => item.id === id)
  if (!card) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')
  return card
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

  /**
   * 读卡列表。每次都从磁盘重读：插件热重载会同时存在新旧两个实例，
   * 读缓存会让旧实例看到新实例写入之前的旧内容（与 records 事故同一形状）。
   */
  #cards(): Card[] {
    return cardsOf(this.#doc.readFresh())
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
    // 免打扰只对「不需要动作」的卡成立：带 action 的卡还要到点执行，状态得是 scheduled。
    const silent = !action && extra.silent === true
    const source = extra.source === 'agent' ? 'agent' : 'human'
    const card: Card = {
      id: nextId('c'),
      title: text,
      detail: typeof extra.detail === 'string' ? extra.detail.slice(0, 1000) : '',
      kind: normalizeKind(extra.kind),
      severity: normalizeSeverity(extra.severity),
      // open 未处理 / acknowledged 已读 / scheduled 已排自动动作 / done 已完成 / dismissed 忽略
      status: action ? 'scheduled' : silent ? 'acknowledged' : 'open',
      action,
      dueAt,
      source,
      // 两种交互：question = 模型提问把对话卡住了；reply = 一轮回复结束后的记录。
      interaction: extra.interaction === 'question' ? 'question' : 'reply',
      question: (extra.question as Card['question']) ?? null,
      ask: normalizeAsk(extra.ask),
      origin: (extra.origin as Card['origin']) ?? null,
      ...(extra.artifacts?.length ? { artifacts: extra.artifacts.slice(0, 20) } : {}),
      ...(extra.acceptance?.length ? { acceptance: extra.acceptance } : {}),
      ...(extra.semantic ? { semantic: extra.semantic } : {}),
      ...(extra.blockedBy?.length ? { blockedBy: extra.blockedBy } : {}),
      ...(extra.planId ? { planId: extra.planId } : {}),
      advice: null,
      silent,
      createdAt: now,
      updatedAt: now,
      events: [
        { at: now, type: 'created', via: source },
        ...(silent ? [{ at: now, type: 'acknowledged', via: 'silent' }] : []),
      ],
    }
    fillDecision(card)
    return this.#doc.mutate((current) => {
      const cards = cardsOf(current)
      cards.unshift(card)
      return { value: keepShape(current, cards), result: { ...card } }
    })
  }

  find(id: string): Card | undefined {
    return this.#cards().find((item) => item.id === id)
  }

  /** 到点该跑自动动作的卡。 */
  due(now: number = Date.now()): Card[] {
    return this.#cards().filter(
      (card) =>
        card.kind === 'auto' &&
        card.status === 'scheduled' &&
        card.action &&
        typeof card.dueAt === 'number' &&
        card.dueAt <= now,
    )
  }

  /** 用户后来才回到会话：把已经落盘的近期通知补标成「已看过」，不再亮未读。 */
  async markSeen(id: string, at: number = Date.now()): Promise<Card> {
    return this.#doc.mutate((current) => {
      const card = requireCard(current, id)
      Object.assign(card, { silent: true, status: 'acknowledged', updatedAt: at })
      card.events.push({ at, type: 'acknowledged', via: 'silent' })
      return { value: current, result: { ...card } }
    })
  }

  /** 统一的改状态入口：所有变更都留一条事件，且永远基于磁盘最新内容改。 */
  async patch(id: string, changes: Partial<Card>, event?: string): Promise<Card> {
    return this.#doc.mutate((current) => {
      const card = requireCard(current, id)
      Object.assign(card, changes, { updatedAt: Date.now() })
      // 阶段 A：写入路径同步落 decision（权威字段）；没有显式值时按快照推导。
      if (changes.decision) card.decision = changes.decision
      else if (!card.decision) fillDecision(card)
      else if (changes.deliveryState || changes.status) card.decision = decisionAfter(card)
      card.events.push({ at: Date.now(), type: event || 'updated' })
      return { value: current, result: { ...card } }
    })
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
    return this.#doc.mutate((current) => {
      const cards = cardsOf(current)
      const index = cards.findIndex((item) => item.id === id)
      if (index < 0) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')
      cards.splice(index, 1)
      return { value: keepShape(current, cards), result: { id } }
    })
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
    if (typeof patch.autoApproveDiagnostics === 'boolean')
      next.autoApproveDiagnostics = patch.autoApproveDiagnostics
    if (typeof patch.fallbackObserve === 'boolean') next.fallbackObserve = patch.fallbackObserve
    if (typeof patch.receiptTimeoutMs === 'number' && Number.isFinite(patch.receiptTimeoutMs))
      next.receiptTimeoutMs = Math.max(10_000, Math.trunc(patch.receiptTimeoutMs))
    if (patch.turnGate === 'off' || patch.turnGate === 'high-risk' || patch.turnGate === 'all')
      next.turnGate = patch.turnGate
    await this.#doc.write(next)
    return next
  }
}

export { type PrecedentInput, PrecedentStore } from './precedents'
/** 调用记录在 ./records.ts（JsonDoc 复用），判例库在 ./precedents.ts。 */
export { RecordStore } from './records'
