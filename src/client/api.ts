// 面板后端调用：所有请求经宿主路由，错误统一成一句人话。

import { API } from './constants'
import type { Card, ModelCatalogView, ObserverRecord, Precedent, Settings, Turn } from './types'

interface Envelope {
  ok?: boolean
  error?: string
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  let body: (T & Envelope) | null = null
  try {
    body = (await res.json()) as T & Envelope
  } catch {
    /* 非 JSON 响应走下面兜底 */
  }
  if (!res.ok || !body || body.ok === false) {
    throw new Error(body?.error || `请求失败（HTTP ${res.status}）`)
  }
  return body
}

function post(path: string, payload: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function fetchCards(): Promise<{ cards: Card[]; warning: string }> {
  const body = await call<{ cards?: Card[]; warning?: string | null }>(`${API}/cards`)
  return { cards: body.cards || [], warning: body.warning || '' }
}

export async function createCard(title: string): Promise<Card | null> {
  const body = await call<{ card: Card }>(`${API}/cards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  return body.card || null
}

/** 卡片动作的宿主回包：approve 会额外说明有没有把话推回原会话。 */
export interface ActionReply {
  card: Card | null
  pushed?: boolean
  reason?: string
}

export async function actOnCard(id: string, action: string, option?: string): Promise<ActionReply> {
  const body = await call<{ card: Card | null; pushed?: boolean; reason?: string }>(
    `${API}/action`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, action, ...(option ? { option } : {}) }),
    },
  )
  return { card: body.card || null, pushed: body.pushed, reason: body.reason }
}

export async function fetchSettings(): Promise<Settings> {
  const body = await call<{ settings: Settings }>(`${API}/settings`)
  return body.settings
}

/** 判例库 + 决策执行记录：用户过去同类决定，返工过的（outcome=reworked）不再当准绳。 */
export async function fetchDecisions(): Promise<{
  precedents: Precedent[]
  records: ObserverRecord[]
}> {
  const body = await call<{ precedents?: Precedent[]; records?: ObserverRecord[] }>(
    `${API}/decisions`,
  )
  return { precedents: body.precedents || [], records: body.records || [] }
}

/** 让决策代理人给这张卡重出一张票拟；结果异步写回卡上，前端刷新就能看到。 */
export async function redecide(id: string): Promise<void> {
  await call<{ ok?: boolean }>(`${API}/decisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'redecide', id }),
  })
}

/** 采纳第 index 个方案（0 起）：宿主把该方案的 answer 回给原会话。 */
export function adopt(id: string, index: number): Promise<{ card: Card | null }> {
  const safe = Number.isInteger(index) && index >= 0 ? index : 0
  return actOnCard(id, 'adopt', String(safe))
}

/** 标记这个决定后来返工了；note 是一句原因（可空）。 */
export function markReworked(id: string, note?: string): Promise<{ card: Card | null }> {
  return actOnCard(id, 'mark-reworked', note?.trim() || undefined)
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const body = await call<{ settings: Settings }>(`${API}/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings }),
  })
  return body.settings
}

export async function fetchModels(): Promise<ModelCatalogView> {
  const body = await call<ModelCatalogView>(`${API}/models`)
  return { groups: body.groups || [], default: body.default }
}

export async function fetchTimeline(sessionId: string): Promise<{ title: string; turns: Turn[] }> {
  const body = await call<{ title?: string; turns?: Turn[] }>(
    `${API}/timeline?id=${encodeURIComponent(sessionId)}`,
  )
  return { title: body.title || '', turns: body.turns || [] }
}

export async function fetchTitles(ids: string[]): Promise<Record<string, string>> {
  const body = await call<{ titles?: Record<string, string> }>(
    `${API}/titles?ids=${encodeURIComponent(ids.join(','))}`,
  )
  return body.titles || {}
}

/** 心跳：宿主据此判断面板在不在线（在就允许卡片作答）。 */
export function pingPresence(
  active = true,
  context?: { sessionId?: string; tab?: string; openCardId?: string },
): void {
  post(`${API}/presence`, { active, ...context }).catch(() => {})
}
