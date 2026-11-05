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

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
export const DATA_DIR = path.join(DSH_HOME, 'dsh-task-cards')
export const DATA_FILE = path.join(DATA_DIR, 'cards.json')
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
export const RECORDS_FILE = path.join(DATA_DIR, 'records.json')

export const MAX_TITLE = 200
const STATES = new Set(['todo', 'done'])

/** 带稳定 code 的业务错误：路由层据此回 400 而不是 500。 */
export class StoreError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** 一个 JSON 文档：懒加载、原子写、写失败抛出去。 */
class JsonDoc {
  #value
  #chain = Promise.resolve()
  #warning = null

  constructor(file, fallback) {
    this.file = file
    this.fallback = fallback
  }

  get warning() {
    return this.#warning
  }

  read() {
    if (this.#value !== undefined) return this.#value
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      this.#value = this.normalize(JSON.parse(raw))
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        this.#value = this.fallback()
      } else {
        // 坏文件不静默丢：挪到旁边，界面能看到 warning。
        this.#warning = `数据文件无法解析，已挪到旁边：${(err && err.message) || String(err)}`
        this.#value = this.fallback()
        try {
          fs.renameSync(this.file, `${this.file}.bad-${Date.now()}`)
        } catch (e) {
          /* 挪不动也不挡开工 */
        }
      }
    }
    return this.#value
  }

  normalize(value) {
    return value
  }

  write(value) {
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
function nextId(prefix) {
  counter = (counter + 1) % 1e6
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

// ------------------------------------------------------------------ 卡

export class Store {
  #doc

  /** @param {string} [file] 测试可换路径；默认 $DSH_HOME/dsh-task-cards/cards.json */
  constructor(file = DATA_FILE) {
    this.#doc = new JsonDoc(file, () => [])
  }

  get file() {
    return this.#doc.file
  }

  get warning() {
    return this.#doc.warning
  }

  #cards() {
    const value = this.#doc.read()
    return Array.isArray(value) ? value : value.cards
  }

  open() {
    return this.#cards()
  }

  list() {
    return this.#cards().map((card) => ({ ...card }))
  }

  async create(title, extra = {}) {
    const text = String(title ?? '').trim()
    if (!text) throw new StoreError('EMPTY_TITLE', '标题不能为空')
    if (text.length > MAX_TITLE) throw new StoreError('TITLE_TOO_LONG', `标题最多 ${MAX_TITLE} 个字`)
    const now = Date.now()
    const kind = extra.kind === 'decision' || extra.kind === 'auto' ? extra.kind : 'info'
    const action = extra.action || null
    const dueAt = action ? now + (Number.isFinite(action.delayMs) ? action.delayMs : 600000) : null
    const card = {
      id: nextId('c'),
      title: text,
      detail: typeof extra.detail === 'string' ? extra.detail.slice(0, 1000) : '',
      kind,
      severity: extra.severity === 'high' || extra.severity === 'low' ? extra.severity : 'normal',
      // open 未处理 / acknowledged 已读 / scheduled 已排自动动作 / done 已完成 / dismissed 忽略
      status: action ? 'scheduled' : 'open',
      action,
      dueAt,
      source: extra.source || 'human',
      // 两种交互：question = 模型提问把对话卡住了；reply = 一轮回复结束后的记录。
      interaction: extra.interaction === 'question' ? 'question' : 'reply',
      question: extra.question || null,
      origin: extra.origin || null,
      createdAt: now,
      updatedAt: now,
      events: [{ at: now, type: 'created', via: extra.source || 'human' }],
    }
    this.#cards().unshift(card)
    await this.#doc.write(this.#cards())
    return { ...card }
  }

  find(id) {
    return this.#cards().find((item) => item.id === id)
  }

  /** 到点该跑自动动作的卡。 */
  due(now = Date.now()) {
    return this.#cards().filter(
      (card) => card.status === 'scheduled' && card.action && typeof card.dueAt === 'number' && card.dueAt <= now,
    )
  }

  /** 统一的改状态入口：所有变更都留一条事件。 */
  async patch(id, changes, event) {
    const card = this.#cards().find((item) => item.id === id)
    if (!card) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')
    Object.assign(card, changes, { updatedAt: Date.now() })
    card.events.push({ at: Date.now(), type: event || 'updated' })
    await this.#doc.write(this.#cards())
    return { ...card }
  }

  async setState(id, state) {
    if (!STATES.has(state)) throw new StoreError('BAD_STATE', '未知状态')
    return this.patch(id, { status: state === 'done' ? 'done' : 'open' }, state === 'done' ? 'completed' : 'reopened')
  }

  async remove(id) {
    const cards = this.#cards()
    const index = cards.findIndex((item) => item.id === id)
    if (index < 0) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')
    cards.splice(index, 1)
    await this.#doc.write(cards)
    return { id }
  }
}

// ------------------------------------------------------------------ 观察者设置

export const DEFAULT_PROMPT = `你是任务卡的观察者：只读别人会话的最后一段回复，判断里面有什么值得留下的事，输出 JSON。

只输出 JSON，不要解释，不要用 markdown 代码块。

格式：
{"cards":[{"title":"一句话，动词开头，不超过 40 字","detail":"一到两句关键信息","kind":"decision|info|auto","severity":"high|normal|low","action":{"type":"prompt","delayMs":600000,"input":"到点时替用户发回原会话的那句话"}}]}

kind 三选一：
- decision：必须由人拍板，且影响大（删数据、花钱、对外发消息、改方向、不可逆操作）。不拍不能继续。
- info：用户需要知道，但不需要动作（跑完了、发布了、某处有了变化）。
- auto：已知的、可自动处理的重复情形，必须给出 action。例如模型 400 参数错误 → 立即重试；429 限流 → 10 分钟后重试；网络超时 → 1 分钟后重试。没有把握给出 action 时不要选 auto，改选 info。

action.delayMs 是毫秒：立即用 0，10 分钟用 600000。action.input 是到点时替用户发回原会话的那句话，要能独立成立。

规则：
- 一条卡只装一件事。
- title 写人话，不要写"根据回复…"这类元话语。
- 拿不准就不成卡；没有值得留下的事只输出 {"cards":[]}。
- 观察者不评论模型能力，只记录这件事本身的状态与下一步。`

export const DEFAULT_SETTINGS = {
  enabled: true,
  /** 观察者会话的系统提示词，可在面板里编辑。 */
  systemPrompt: DEFAULT_PROMPT,
  /** 空 = 用当前默认模型。 */
  provider: '',
  model: '',
  /** 只分析不短于这个长度的回复，避免为一句「好的」建卡。 */
  minReplyChars: 120,
  // 子代理会话要不要也观察：默认不要，它们不是用户的一轮。
  includeSubagents: false,
  /** 送进观察者的最大输入字节。 */
  maxInputBytes: 16000,
  /** 单次观察者调用超时。 */
  timeoutMs: 60000,
}

export class SettingsStore {
  #doc

  constructor(file = SETTINGS_FILE) {
    this.#doc = new JsonDoc(file, () => ({ ...DEFAULT_SETTINGS }))
  }

  get file() {
    return this.#doc.file
  }

  get() {
    return { ...DEFAULT_SETTINGS, ...this.#doc.read() }
  }

  async set(patch) {
    const current = this.get()
    const next = { ...current }
    if (typeof patch.systemPrompt === 'string') next.systemPrompt = patch.systemPrompt
    if (typeof patch.provider === 'string') next.provider = patch.provider
    if (typeof patch.model === 'string') next.model = patch.model
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
    if (Number.isFinite(patch.minReplyChars)) next.minReplyChars = Math.max(0, Math.trunc(patch.minReplyChars))
    if (Number.isFinite(patch.maxInputBytes)) next.maxInputBytes = Math.max(200, Math.trunc(patch.maxInputBytes))
    if (Number.isFinite(patch.timeoutMs)) next.timeoutMs = Math.max(1000, Math.trunc(patch.timeoutMs))
    await this.#doc.write(next)
    return next
  }
}

// ------------------------------------------------------------------ 调用记录

const RECORD_LIMIT = 200

export class RecordStore {
  #doc

  constructor(file = RECORDS_FILE) {
    this.#doc = new JsonDoc(file, () => [])
  }

  get file() {
    return this.#doc.file
  }

  list(limit = RECORD_LIMIT) {
    const all = this.#doc.read()
    return (Array.isArray(all) ? all : []).slice(0, Math.max(1, limit))
  }

  async add(record) {
    const all = this.#doc.read()
    const list = Array.isArray(all) ? all : []
    const entry = { id: nextId('r'), at: Date.now(), ...record }
    list.unshift(entry)
    if (list.length > RECORD_LIMIT) list.length = RECORD_LIMIT
    await this.#doc.write(list)
    return entry
  }
}
