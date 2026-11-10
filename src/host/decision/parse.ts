// 解析决策会话的输出：容错成 advice 草稿。
//
// 和观察者一样，不信任「说了只输出 JSON 就会只输出 JSON」：代码块、前后废话、
// 单个对象、裸数组都救。未知 cardId 丢弃；options 最多留 3 条；缺字段补默认值。

import type {
  Advice,
  AdviceOption,
  AdviceVerdict,
  AskKind,
  CardKind,
  CardSeverity,
  Effect,
} from '../../shared/contract'
import { asRecord } from '../host-api'
import { extractJson } from '../observer/extract'

export interface AdviceDraft extends Omit<Advice, 'at'> {
  cardId: string
}

const VERDICTS = new Set<string>(['approve', 'reject', 'modify', 'wait'])
const LANES = new Set<string>(['decision', 'info', 'auto'])
const CONFIDENCES = new Set<string>(['high', 'normal', 'low'])
const ASKS = new Set<string>(['judgment', 'permission', 'clarification'])
const EFFECTS = new Set<string>(['read', 'write-code', 'destructive', 'external', 'spend'])
const MAX_OPTIONS = 3
const MAX_FIELD = 2000

function pickEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : fallback
}

function text(value: unknown, max: number = MAX_FIELD): string {
  return String(value ?? '')
    .trim()
    .slice(0, max)
}

function textList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return []
  const picked: string[] = []
  for (const item of value) {
    const entry = text(item, 120)
    if (entry && !picked.includes(entry)) picked.push(entry)
    if (picked.length >= cap) break
  }
  return picked
}

/** 一个方案：没有名字的丢掉（界面上没法点）；四栏缺了按空串补。 */
function toOption(value: unknown): AdviceOption | null {
  const raw = asRecord(value)
  const name = text(raw.name, 200)
  if (!name) return null
  return {
    name,
    cost: text(raw.cost),
    gain: text(raw.gain),
    worst: text(raw.worst),
    answer: text(raw.answer),
    verdict: pickEnum<AdviceVerdict>(raw.verdict, VERDICTS, 'modify'),
  }
}

function toOptions(value: unknown): AdviceOption[] {
  if (!Array.isArray(value)) return []
  const options: AdviceOption[] = []
  for (const item of value) {
    const option = toOption(item)
    if (option) options.push(option)
    if (options.length >= MAX_OPTIONS) break
  }
  return options
}

/** 推荐序号：整数、夹在 options 长度内；越界/非整数回 0（宁可指向第一条也不乱指）。 */
function toChosen(value: unknown, options: AdviceOption[]): number {
  const index = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(index) || index < 0 || index >= options.length) return 0
  return index
}

/** 严格布尔：只有 true 和字符串 'true' 算真；别让 'false'、1 这种把执行放出去。 */
function toAutoApply(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return false
}

function toDraft(value: unknown, knownIds: ReadonlySet<string>): AdviceDraft | null {
  const raw = asRecord(value)
  const cardId = text(raw.cardId ?? raw.id, 120)
  if (!cardId || !knownIds.has(cardId)) return null
  const options = toOptions(raw.options)
  return {
    cardId,
    verdict: pickEnum<AdviceVerdict>(raw.verdict, VERDICTS, 'wait'),
    summary: text(raw.summary, 400),
    options,
    basis: text(raw.basis, 600),
    precedentIds: textList(raw.precedentIds, 6),
    chosen: toChosen(raw.chosen, options),
    autoApply: toAutoApply(raw.autoApply),
    confidence: pickEnum<CardSeverity>(raw.confidence, CONFIDENCES, 'normal'),
    question: text(raw.question, 400),
    lane: pickEnum<CardKind>(raw.lane, LANES, 'decision'),
    ask: pickEnum<AskKind>(raw.ask, ASKS, 'judgment'),
    effect: pickEnum<Effect>(raw.effect, EFFECTS, 'write-code'),
    requires: textList(raw.requires, 8),
    dependsOn: textList(raw.dependsOn, 8),
    action: text(raw.action, 1000),
    scope: text(raw.scope, 400),
    reversible: raw.reversible === true,
    candidates: textList(raw.candidates, 8),
    blockedReasons: [],
    applied: false,
  }
}

/** 三种可接受的外壳：{decisions:[...]}、裸数组、单条对象。 */
function rowsOf(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  const raw = asRecord(value)
  if (Array.isArray(raw.decisions)) return raw.decisions
  if (typeof raw.cardId === 'string' || typeof raw.id === 'string') return [value]
  return null
}

/**
 * 解析成草稿列表。连 decisions 数组都找不到（或整段不是 JSON）返回 null；
 * 字段不合法/卡不认识时逐条丢弃，全部丢弃则返回空数组。
 */
export function parseAdvice(raw: unknown, knownIds: ReadonlySet<string>): AdviceDraft[] | null {
  const extracted = extractJson(raw)
  if (!extracted.ok) return null
  const rows = rowsOf(extracted.value)
  if (!rows) return null
  const drafts: AdviceDraft[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const draft = toDraft(row, knownIds)
    if (!draft || seen.has(draft.cardId)) continue
    seen.add(draft.cardId)
    drafts.push(draft)
  }
  return drafts
}
