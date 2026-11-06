// 面板状态装配：把卡片、设置、判例/执行记录、详情、动作几件事合成一个对象，组件只读它。

import { useCallback, useEffect, useState } from 'react'
import type {
  ActionNotice,
  Card,
  DetailApi,
  DetailState,
  ModelCatalogView,
  ObserverRecord,
  PanelTab,
  Precedent,
  Settings,
} from '../types'
import { useBusy } from './useBusy'
import { type CardsState, useCards } from './useCards'
import { type DecisionsState, useDecisions } from './useDecisions'
import { useDetail } from './useDetail'
import { type PanelActions, usePanelActions } from './usePanelActions'
import { usePresence } from './usePresence'
import { type SettingsState, useSettings } from './useSettings'
import { useTitles } from './useTitles'

export type Tab = PanelTab

export interface PanelState {
  tab: Tab
  setTab: (tab: Tab) => void
  draft: string
  setDraft: (value: string) => void
  cards: Card[]
  titles: Record<string, string>
  loading: boolean
  error: string
  warning: string
  busy: boolean
  settings: Settings | null
  models: ModelCatalogView | null
  precedents: Precedent[]
  /** 决策代理人的最近执行记录（phase=decision）。 */
  records: ObserverRecord[]
  /** 批准后的一条结果提示；null 表示没有。 */
  notice: ActionNotice | null
  dismissNotice: () => void
  detail: DetailState | null
  detailApi: DetailApi
  actions: PanelActions
  saveSettings: (next: Settings) => Promise<void>
  openSession: (sessionId: string) => void
}

export function usePanelState(uiWorkspace?: {
  openSession?: (sessionId: string) => void
}): PanelState {
  const [tab, setTab] = useState<PanelTab>('cards')
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<ActionNotice | null>(null)
  const { busy, run } = useBusy()
  const cardState = useCards(tab === 'cards')
  const titles = useTitles(cardState.cards)
  const settingsState = useSettings(cardState.setError)
  const decisionsState = useDecisions(cardState.setError)
  const detailApi = useDetail()
  usePresence()
  usePanelLoads(tab, settingsState, decisionsState, detailApi.detail)

  const wiring = usePanelWiring({
    tab,
    draft,
    setDraft,
    cardState,
    settingsState,
    decisionsState,
    detailApi,
    run,
    workspace: uiWorkspace,
    notify: setNotice,
  })

  return {
    tab,
    setTab,
    draft,
    setDraft,
    cards: cardState.cards,
    titles,
    loading: cardState.loading,
    error: cardState.error,
    warning: cardState.warning,
    busy,
    settings: settingsState.settings,
    models: settingsState.models,
    precedents: decisionsState.precedents,
    records: decisionsState.records,
    notice,
    dismissNotice: wiring.dismissNotice,
    detail: detailApi.detail,
    detailApi,
    actions: wiring.panel,
    saveSettings: wiring.saveSettings,
    openSession: wiring.openSession,
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
  return { panel, dismissNotice, saveSettings, openSession }
}

interface DecisionsSource {
  load: () => Promise<void>
}

/** 观察者/决策页要设置；决策页与票拟详情还要判例与执行记录。 */
function usePanelLoads(
  tab: PanelTab,
  settingsState: SettingsState,
  decisionsState: DecisionsSource,
  detail: DetailState | null,
) {
  useEffect(() => {
    if (tab === 'cards') return
    settingsState.loadSettings().catch(() => {})
    if (tab === 'decision') decisionsState.load().catch(() => {})
  }, [tab, settingsState.loadSettings, decisionsState.load])

  const adviceSession = detail?.card?.advice ? detail.sessionId || 'detail' : ''
  useEffect(() => {
    if (adviceSession) decisionsState.load().catch(() => {})
  }, [adviceSession, decisionsState.load])
}

/** 刷新当前页：卡片页重拉卡片；观察者页重拉设置；决策页再拉执行记录。 */
function usePanelRefresh(
  tab: PanelTab,
  loadCards: () => Promise<void>,
  loadSettings: () => Promise<void>,
  loadDecisions: () => Promise<void>,
) {
  return useCallback(() => {
    if (tab === 'cards') {
      loadCards().catch(() => {})
      return
    }
    loadSettings().catch(() => {})
    if (tab === 'decision') loadDecisions().catch(() => {})
  }, [tab, loadCards, loadSettings, loadDecisions])
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
