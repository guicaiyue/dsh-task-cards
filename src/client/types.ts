// 客户端侧的类型：只引用 shared 的类型，不把 zod 带进浏览器。

import type {
  Advice,
  AdviceOption,
  AdviceVerdict,
  Card,
  CardKind,
  CardSeverity,
  ObserverRecord,
  Precedent,
  PrecedentOutcome,
  Settings,
} from '../shared/contract'

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

/** 顶部页签：卡片 / 观察者 / 决策。 */
export type PanelTab = 'cards' | 'observer' | 'decision'

export type CardActionName =
  | 'complete'
  | 'acknowledge'
  | 'dismiss'
  | 'reopen'
  | 'delete'
  | 'run-now'
  | 'answer'
  /** 采纳票拟里的第 N 个方案（option 是 0 起序号）。 */
  | 'adopt'
  /** 决策卡批红：把话推回原会话并把卡标结束（pushed/reason 由宿主回）。 */
  | 'approve'
  /** 许可卡拒绝：把「不允许」推回原会话并把卡标结束。 */
  | 'deny'
  /** 这个决定后来返工了（option 是返工原因，可空）。 */
  | 'mark-reworked'

export interface ActionResult {
  action: CardActionName
  card: Card | null
  /** approve 专用：宿主是否真的把结论投回了原会话。 */
  pushed?: boolean
  /** approve 专用：pushed=false 时宿主给的一句原因。 */
  reason?: string
}

export type ActionOutcome = ActionResult | undefined

/** 批准后要告诉用户的结果：推回去了，还是只结束了卡（附原因）。 */
export interface ActionNotice {
  pushed: boolean
  reason: string
}

export type {
  Advice,
  AdviceOption,
  AdviceVerdict,
  Card,
  CardKind,
  CardSeverity,
  ObserverRecord,
  Precedent,
  PrecedentOutcome,
  Settings,
}
