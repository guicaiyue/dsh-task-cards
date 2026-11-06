// 面板状态装配：把卡片、设置、判例、详情、动作几件事合成一个对象，组件只读它。

import { useCallback, useEffect, useState } from 'react'
import type { Card, DetailApi, DetailState, ModelCatalogView, Precedent, Settings } from '../types'
import { useBusy } from './useBusy'
import { useCards } from './useCards'
import { useDetail } from './useDetail'
import { type PanelActions, usePanelActions } from './usePanelActions'
import { usePrecedents } from './usePrecedents'
import { usePresence } from './usePresence'
import { useSettings } from './useSettings'
import { useTitles } from './useTitles'

export type Tab = 'cards' | 'settings'

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
  detail: DetailState | null
  detailApi: DetailApi
  actions: PanelActions
  saveSettings: (next: Settings) => Promise<void>
  openSession: (sessionId: string) => void
}

export function usePanelState(uiWorkspace?: {
  openSession?: (sessionId: string) => void
}): PanelState {
  const [tab, setTab] = useState<Tab>('cards')
  const [draft, setDraft] = useState('')
  const { busy, run } = useBusy()
  const cardState = useCards(tab === 'cards')
  const titles = useTitles(cardState.cards)
  const settingsState = useSettings(cardState.setError)
  const precedentsState = usePrecedents(cardState.setError)
  const detailApi = useDetail()
  usePresence()
  usePanelLoads(tab, settingsState, precedentsState, detailApi.detail)

  const refresh = usePanelRefresh(tab, cardState, settingsState)
  const actions = usePanelActions({
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
  })

  const openSession = useOpenSession(uiWorkspace)
  const saveSettings = useSaveSettings(run, settingsState.save)

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
    precedents: precedentsState.precedents,
    detail: detailApi.detail,
    detailApi,
    actions,
    saveSettings,
    openSession,
  }
}

interface SettingsSource {
  loadSettings: () => Promise<void>
}

interface PrecedentSource {
  load: () => Promise<void>
}

/** 设置页要设置与判例；详情弹窗里带票拟的卡也要判例（点编号能看）。 */
function usePanelLoads(
  tab: Tab,
  settingsState: SettingsSource,
  precedentsState: PrecedentSource,
  detail: DetailState | null,
) {
  useEffect(() => {
    if (tab !== 'settings') return
    settingsState.loadSettings().catch(() => {})
    precedentsState.load().catch(() => {})
  }, [tab, settingsState.loadSettings, precedentsState.load])

  const adviceSession = detail?.card?.advice ? detail.sessionId || 'detail' : ''
  useEffect(() => {
    if (adviceSession) precedentsState.load().catch(() => {})
  }, [adviceSession, precedentsState.load])
}

/** 刷新当前页：卡片页重拉卡片，设置页重拉设置。 */
function usePanelRefresh(
  tab: Tab,
  cardState: { loadCards: () => Promise<void> },
  settingsState: SettingsSource,
) {
  return useCallback(() => {
    if (tab === 'cards') cardState.loadCards().catch(() => {})
    else settingsState.loadSettings().catch(() => {})
  }, [tab, cardState, settingsState])
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
