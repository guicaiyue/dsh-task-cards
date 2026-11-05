// 面板状态装配：把卡片、设置、详情、动作四件事合成一个对象，组件只读它。

import { useCallback, useEffect, useState } from 'react'
import type { Card, DetailApi, DetailState, ModelCatalogView, Settings } from '../types'
import { useBusy } from './useBusy'
import { useCards } from './useCards'
import { useDetail } from './useDetail'
import { type PanelActions, usePanelActions } from './usePanelActions'
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
  const detailApi = useDetail()
  usePresence()

  // 切到设置页才拉设置与模型目录：卡片页用不到。
  useEffect(() => {
    if (tab === 'settings') settingsState.loadSettings().catch(() => {})
  }, [tab, settingsState.loadSettings])

  const refresh = useCallback(() => {
    if (tab === 'cards') cardState.loadCards().catch(() => {})
    else settingsState.loadSettings().catch(() => {})
  }, [tab, cardState, settingsState])

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
    detail: detailApi.detail,
    detailApi,
    actions,
    saveSettings,
    openSession,
  }
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
