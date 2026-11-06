// 从模型输出里抠出 JSON —— 不信任「我说了只输出 JSON 它就会只输出 JSON」。
//
// 模型最常见的两种跑偏：包一层 markdown 代码块、前后加一句解释。
// 两种都得能救，救不回来才交给上层重试。

import type { CardAction, CardDraft, CardKind, CardSeverity } from '../../shared/contract'

type ParseResult = { ok: true; value: unknown } | { ok: false }

/**
 * 从一个字符串里截出第一个平衡的 JSON 对象/数组。
 * 扫描时跳过字符串内容与转义，避免把字符串里的花括号当结构。
 */
function scanBalanced(text: string): ParseResult | null {
  for (let start = 0; start < text.length; start += 1) {
    const open = text[start]
    if (open !== '{' && open !== '[') continue
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === open) depth += 1
      else if (ch === close) {
        depth -= 1
        if (depth === 0) {
          const candidate = text.slice(start, i + 1)
          const parsed = tryParse(candidate)
          if (parsed.ok) return parsed
        }
      }
    }
  }
  return null
}

function tryParse(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

export type ExtractedJson =
  | { ok: true; value: unknown; via: 'direct' | 'fence' | 'fence+bracket' | 'bracket' }
  | { ok: false; reason: string }

/**
 * 依次尝试：整段 JSON → 代码块里的 JSON → 正文里第一个平衡括号块。
 */
export function extractJson(raw: unknown): ExtractedJson {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, reason: '模型没有输出任何内容' }

  const direct = tryParse(text)
  if (direct.ok) return { ok: true, value: direct.value, via: 'direct' }

  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/g
  for (let match = fence.exec(text); match; match = fence.exec(text)) {
    const body = (match[1] ?? '').trim()
    const parsed = tryParse(body)
    if (parsed.ok) return { ok: true, value: parsed.value, via: 'fence' }
    const scanned = scanBalanced(body)
    if (scanned?.ok) return { ok: true, value: scanned.value, via: 'fence+bracket' }
  }

  const scanned = scanBalanced(text)
  if (scanned?.ok) return { ok: true, value: scanned.value, via: 'bracket' }

  return { ok: false, reason: '输出里没有可解析的 JSON' }
}

const KINDS = new Set<string>(['decision', 'info', 'auto'])
const SEVERITIES = new Set<string>(['high', 'normal', 'low'])
const MAX_DELAY_MS = 24 * 60 * 60 * 1000

/** 自动动作只支持「到点在原会话里补一句话」这一种，先把契约收窄。 */
function normalizeAction(action: unknown): CardAction | null {
  if (!action || typeof action !== 'object') return null
  const raw = action as Record<string, unknown>
  const type = raw.type === 'retry' || raw.type === 'prompt' ? raw.type : null
  if (!type) return null
  const delay = Number(raw.delayMs)
  const delayMs = Number.isFinite(delay)
    ? Math.min(MAX_DELAY_MS, Math.max(0, Math.trunc(delay)))
    : 600000
  const input = String(raw.input ?? raw.text ?? '')
    .trim()
    .slice(0, 2000)
  if (!input) return null
  const sessionId = typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId : undefined
  return { type, delayMs, input, ...(sessionId ? { sessionId } : {}) }
}

export type CoercedCards = { ok: true; cards: CardDraft[] } | { ok: false; reason: string }

/**
 * 把 JSON 值收敛成卡的草稿列表。
 * 接受 {cards:[...]}、单个 {...card}、[...]；其它形状视为格式错误。
 * 卡是 JSON 的展示面：kind 决定归入「要我决策 / 要我知晓 / 自动处理」。
 */
export function coerceCards(value: unknown): CoercedCards {
  let rows: unknown[]
  if (Array.isArray(value)) rows = value
  else if (
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { cards?: unknown }).cards)
  )
    rows = (value as { cards: unknown[] }).cards
  else if (
    value &&
    typeof value === 'object' &&
    typeof (value as { title?: unknown }).title === 'string'
  )
    rows = [value]
  else return { ok: false, reason: 'JSON 里没有 cards 数组' }

  const cards: CardDraft[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const raw = row as Record<string, unknown>
    const title = String(raw.title ?? raw.name ?? '').trim()
    if (!title) continue
    const action = normalizeAction(raw.action)
    let kind: CardKind = KINDS.has(String(raw.kind)) ? (raw.kind as CardKind) : 'info'
    // 说了「自动处理」却没给出可执行动作：降级成「要我知晓」，宁可提醒人，也不静默。
    if (kind === 'auto' && !action) kind = 'info'
    const severity: CardSeverity = SEVERITIES.has(String(raw.severity))
      ? (raw.severity as CardSeverity)
      : 'normal'
    cards.push({
      title: title.slice(0, 200),
      detail: String(raw.detail ?? raw.summary ?? raw.note ?? '')
        .trim()
        .slice(0, 1000),
      kind,
      severity,
      action,
      reason: String(raw.reason ?? '')
        .trim()
        .slice(0, 300),
    })
  }
  return { ok: true, cards }
}
