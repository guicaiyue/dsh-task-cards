// 客户端侧的类型：只引用 shared 的类型，不把 zod 带进浏览器。

import type { CaseEvent } from '../shared/case'
import type {
  Advice,
  AdviceOption,
  AdviceVerdict,
  AnswerSelection,
  Card,
  CardKind,
  CardSeverity,
  ObserverRecord,
  Precedent,
  PrecedentOutcome,
  Settings,
} from '../shared/contract'
import type { EvidenceRecord } from '../shared/evidence'
import type { TodoList } from '../shared/todo'

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

/** 工作台行内进度：该卡清单完成了多少。 */
export interface CardProgress {
  done: number
  total: number
  frozen: boolean
}

/** 记录屏的一行：跨卡最近事件。GET /records 的回包。 */
export interface RecordRow {
  id: string
  caseId: string
  traceId: string
  at: number
  phase: string
  from: string
  to: string
  actor: string
  reason: string
}

/** 一张卡的案卷：事件、清单、证据。GET /case 的回包。 */
export interface VerdictRow {
  id: string
  cardId: string
  decisionSeq: number
  actor: string
  actorType: string
  authority: string
  channel: string
  decision: string
  policyVersion: number
  rationale?: string
  confidence?: number
  evidenceRefs: string[]
  at: number
}

export interface StatsGroup {
  cards: number
  decision: number
  notices: number
  interventions: number
  delegated: number
  escalated: number
  waits: number
  overridden: number
  delegatedRate: number | null
  overrideRate: number | null
  escalationRate: number | null
  waitRate: number | null
  cardsPerTurn: number | null
  interventionsPerTurn: number | null
  noticePerTurn: number | null
  unknown: number
  unknownToHuman: number
  unknownToHumanRate: number | null
  acceptanceCards: number
  acceptanceCoverage: number | null
}

export interface StatsView {
  ok: boolean
  generatedAt: number
  turns: number
  dataSource: { cardsFile: string; cardsSha256: string; cards: number; syntheticCards: number }
  groups: { all: StatsGroup; real: StatsGroup }
}

export interface CaseDetail {
  events: CaseEvent[]
  todo: TodoList | null
  evidence: EvidenceRecord[]
  verdicts: VerdictRow[]
}

export interface DetailState {
  sessionId: string
  card: Card | null
  title: string
  loading: boolean
  turns: Turn[]
  error?: string
  /** 案卷（可能还没加载完）：清单与证据都在这里。 */
  caseInfo?: CaseDetail
}

/** 面板文案函数：键 + 可选占位符。 */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

/** 顶部页签：与 OpenDesign 原型一致的工作台七屏。 */
export type PanelTab =
  | 'workbench'
  | 'detail'
  | 'failure'
  | 'policy'
  | 'records'
  | 'settings'
  | 'session'

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
  AnswerSelection,
  Card,
  CardKind,
  CardSeverity,
  ObserverRecord,
  Precedent,
  PrecedentOutcome,
  Settings,
}
