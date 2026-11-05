// 客户端侧的类型：只引用 shared 的类型，不把 zod 带进浏览器。

import type { Card, Settings } from '../shared/contract'

export interface Turn {
  user: string
  assistant: string
  at: number | null
}

export interface ModelGroup {
  provider: string
  models: Array<{ id: string; name: string }>
}

export interface ModelCatalogView {
  groups: ModelGroup[]
  default?: unknown
}

export interface DetailApi {
  detail: DetailState | null
  openDetail: (target: { sessionId: string; card?: Card | null; title?: string }) => Promise<void>
  closeDetail: () => void
  replaceCard: (card: Card) => void
}

export interface DetailState {
  sessionId: string
  card: Card | null
  title: string
  loading: boolean
  turns: Turn[]
  error?: string
}

/** 面板文案函数：键 + 可选占位符。 */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

export type CardActionName =
  | 'complete'
  | 'acknowledge'
  | 'dismiss'
  | 'reopen'
  | 'delete'
  | 'run-now'
  | 'answer'

export type ActionResult = { action: CardActionName; card: Card | null } | undefined

export type { Card, Settings }
