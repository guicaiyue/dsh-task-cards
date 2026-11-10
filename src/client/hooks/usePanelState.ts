import { useCallback, useEffect, useState } from 'react'
import { reconcile } from '../api'
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
import type { PanelState } from './panel-state-types'
import { useBusy } from './useBusy'
import { type CardsState, useCards } from './useCards'
import { type DecisionsState, useDecisions } from './useDecisions'
import { useDetail } from './useDetail'
import { type PanelActions, usePanelActions } from './usePanelActions'
import { usePresence } from './usePresence'
import { type SettingsState, useSettings } from './useSettings'
import { useStats } from './useStats'
import { useTitles } from './useTitles'

export type Tab = PanelTab

export function usePanelState(uiWorkspace?: {
  openSession?: (sessionId: string) => void
}): PanelState {
  const core = usePanelCore(uiWorkspace)
  const wiring = usePanelWiring({
    tab: core.tab,
    draft: core.draft,
    setDraft: core.setDraft,
    cardState: core.cardState,
    settingsState: core.settingsState,
    decisionsState: core.decisionsState,
    detailApi: core.detailApi,
    run: core.run,
    workspace: uiWorkspace,
    notify: core.setNotice,
  })
  return toPanelState(core, wiring)
}

/** 面板的数据钩子：页签、卡片、设置、判例、详情、在线心跳，以及两个跳转。 */
function usePanelCore(uiWorkspace?: { openSession?: (sessionId: string) => void }) {
  const { tab, setTab } = useTabState()
  const [sessionId, setSessionId] = useState('')
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<ActionNotice | null>(null)
  const { busy, run } = useBusy()
  const cardState = useCards(tab !== 'settings' && tab !== 'policy')
  const titles = useTitles(cardState.cards)
  const settingsState = useSettings(cardState.setError)
  const decisionsState = useDecisions(cardState.setError)
  const detailApi = useDetail()
  const stats = useStats(tab !== 'settings' && tab !== 'policy')
  usePresence({
    tab,
    sessionId: detailApi.detail?.sessionId,
    openCardId: detailApi.detail?.card?.id,
  })
  usePanelLoads(tab, settingsState, decisionsState, detailApi.detail)
  const openCard = useCallback(
    (card: Card) => {
      setTab('detail')
      detailApi
        .openDetail({ sessionId: card.origin?.sessionId || '', card, title: card.title })
        .catch(() => {})
    },
    [detailApi, setTab],
  )
  const selectSession = useCallback(
    (id: string) => {
      setSessionId(id)
      setTab('session')
    },
    [setTab],
  )
  return {
    tab,
    setTab,
    sessionId,
    selectSession,
    openCard,
    draft,
    setDraft,
    notice,
    setNotice,
    busy,
    run,
    cardState,
    titles,
    settingsState,
    decisionsState,
    detailApi,
    stats,
    workspace: uiWorkspace,
  }
}

export type { PanelState } from './panel-state-types'

type PanelCore = ReturnType<typeof usePanelCore>

/** 把数据钩子与动作装配成一个只读对象，组件只认这一个形状。 */
function toPanelState(core: PanelCore, wiring: Wiring): PanelState {
  const { tab, setTab, draft, setDraft, cardState, settingsState, decisionsState } = core
  return {
    tab,
    setTab,
    sessionId: core.sessionId,
    selectSession: core.selectSession,
    openCard: core.openCard,
    draft,
    setDraft,
    cards: cardState.cards,
    titles: core.titles,
    progress: cardState.progress,
    loading: cardState.loading,
    error: cardState.error,
    warning: cardState.warning,
    busy: core.busy,
    paused: settingsState.settings?.decisionEnabled === false,
    settings: settingsState.settings,
    models: settingsState.models,
    precedents: decisionsState.precedents,
    records: decisionsState.records,
    notice: core.notice,
    dismissNotice: wiring.dismissNotice,
    detail: core.detailApi.detail,
    detailApi: core.detailApi,
    stats: core.stats,
    actions: wiring.panel,
    saveSettings: wiring.saveSettings,
    openSession: wiring.openSession,
    reconcile: wiring.reconcile,
  }
}

interface WiringOptions {
  tab: PanelTab
  draft: string
  setDraft: (value: string) => void
  cardState: CardsState
  settingsState: SettingsState
  decisionsState: DecisionsState
  detailApi: DetailApi
  run: <T>(job: () => Promise<T>) => Promise<T | undefined>
  workspace?: { openSession?: (sessionId: string) => void }
  notify: (notice: ActionNotice | null) => void
}

interface Wiring {
  panel: PanelActions
  dismissNotice: () => void
  saveSettings: (next: Settings) => Promise<void>
  openSession: (sessionId: string) => void
  reconcile: () => void
}

/** 把动作、刷新、保存、打开会话接起来；usePanelState 只负责把状态交出去。 */
function usePanelWiring(options: WiringOptions): Wiring {
  const { tab, draft, setDraft, cardState, settingsState, decisionsState, detailApi } = options
  const { run, notify, workspace } = options
  const refresh = usePanelRefresh(
    tab,
    cardState.loadCards,
    settingsState.loadSettings,
    decisionsState.load,
  )
  const panel = usePanelActions({
    submit: async () => {
      const ok = await cardState.add(draft)
      if (ok) setDraft('')
      return ok
    },
    act: cardState.act,
    refresh,
    detail: { replaceCard: detailApi.replaceCard, closeDetail: detailApi.closeDetail },
    run,
    reportError: cardState.setError,
    notify,
  })
  const openSession = useOpenSession(workspace)
  const saveSettings = useSaveSettings(run, settingsState.save)
  const dismissNotice = useCallback(() => notify(null), [notify])
  const onReconcile = useCallback(() => {
    run(async () => {
      await reconcile()
      refresh()
    }).catch((err: unknown) => cardState.setError((err as Error)?.message || String(err)))
  }, [run, refresh, cardState])
  return { panel, dismissNotice, saveSettings, openSession, reconcile: onReconcile }
}

interface DecisionsSource {
  load: () => Promise<void>
}

/** 设置/策略屏要设置；详情屏要判例（票拟里会引用编号）。 */
function usePanelLoads(
  tab: PanelTab,
  settingsState: SettingsState,
  decisionsState: DecisionsSource,
  detail: DetailState | null,
) {
  useEffect(() => {
    // 工作台也要设置：顶部横幅要知道决策者是不是被暂停了。
    if (tab === 'settings' || tab === 'policy' || tab === 'workbench') {
      settingsState.loadSettings().catch(() => {})
    }
    if (tab === 'detail') decisionsState.load().catch(() => {})
  }, [tab, settingsState.loadSettings, decisionsState.load])

  const adviceSession = detail?.card?.advice ? detail.sessionId || 'detail' : ''
  useEffect(() => {
    if (adviceSession) decisionsState.load().catch(() => {})
  }, [adviceSession, decisionsState.load])
}

/** 刷新当前页：卡片相关的屏重拉卡片，设置相关的屏重拉设置。 */
function usePanelRefresh(
  tab: PanelTab,
  loadCards: () => Promise<void>,
  loadSettings: () => Promise<void>,
  loadDecisions: () => Promise<void>,
) {
  return useCallback(() => {
    if (tab !== 'settings' && tab !== 'policy') loadCards().catch(() => {})
    if (tab === 'settings' || tab === 'policy') loadSettings().catch(() => {})
    if (tab === 'detail') loadDecisions().catch(() => {})
  }, [tab, loadCards, loadSettings, loadDecisions])
}

/** 页签状态：默认落在工作台；详情屏是「点开一张卡」的结果，不是默认入口。 */
function useTabState(): { tab: PanelTab; setTab: (tab: PanelTab) => void } {
  const [tab, setTab] = useState<PanelTab>('workbench')
  return { tab, setTab }
}

/** 点「打开会话」：宿主没装工作区视图时就什么都不做。 */
function useOpenSession(uiWorkspace?: { openSession?: (sessionId: string) => void }) {
  return useCallback(
    (sessionId: string) => {
      try {
        uiWorkspace?.openSession?.(sessionId)
      } catch {
        /* 会话已经没了 */
      }
    },
    [uiWorkspace],
  )
}

/** 保存设置：包一层 busy，避免连点。 */
function useSaveSettings(
  run: <T>(job: () => Promise<T>) => Promise<T | undefined>,
  save: (next: Settings) => Promise<void>,
) {
  return useCallback(
    async (next: Settings) => {
      await run(async () => save(next))
    },
    [run, save],
  )
}
