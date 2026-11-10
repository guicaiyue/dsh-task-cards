// PanelState 形状（从 usePanelState 拆出，控制单文件行数）。

import type {
  ActionNotice,
  Card,
  CardProgress,
  DetailApi,
  DetailState,
  ModelCatalogView,
  ObserverRecord,
  PanelTab,
  Precedent,
  Settings,
  StatsView,
} from '../types'
import type { PanelActions } from './usePanelActions'

export interface PanelState {
  tab: PanelTab
  setTab: (tab: PanelTab) => void
  draft: string
  setDraft: (value: string) => void
  cards: Card[]
  titles: Record<string, string>
  progress: Record<string, CardProgress>
  loading: boolean
  error: string
  warning: string
  busy: boolean
  settings: Settings | null
  models: ModelCatalogView | null
  precedents: Precedent[]
  records: ObserverRecord[]
  notice: ActionNotice | null
  dismissNotice: () => void
  paused: boolean
  /** 会话屏当前选中的会话 id；'' = 没选。 */
  sessionId: string
  selectSession: (sessionId: string) => void
  /** 在工作台/记录里点一张卡：切到详情屏并拉它的案卷。 */
  openCard: (card: Card) => void
  detail: DetailState | null
  detailApi: DetailApi
  /** /stats 的服务端口径（真实回合分母）；还没拉到时为 null。 */
  stats: StatsView | null
  actions: PanelActions
  saveSettings: (next: Settings) => Promise<void>
  openSession: (sessionId: string) => void
  /** 跑一次对账：失效「已被同会话更新卡取代」的旧卡。 */
  reconcile: () => void
}
