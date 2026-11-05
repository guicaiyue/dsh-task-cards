// 设置页数据：观察者设置 + 可用模型。切到设置页时按需加载。

import { useCallback, useState } from 'react'

import { fetchModels, fetchSettings, saveSettings } from '../api'
import type { ModelCatalogView, Settings } from '../types'

export interface SettingsState {
  settings: Settings | null
  models: ModelCatalogView | null
  loadSettings: () => Promise<void>
  save: (next: Settings) => Promise<void>
}

export function useSettings(setError: (message: string) => void): SettingsState {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [models, setModels] = useState<ModelCatalogView | null>(null)

  const loadSettings = useCallback(async () => {
    setError('')
    try {
      const [nextSettings, nextModels] = await Promise.all([
        fetchSettings(),
        // 模型目录拿不到不算错：面板里还能「跟随默认模型」
        fetchModels().catch(() => ({ groups: [] })),
      ])
      setSettings(nextSettings)
      setModels(nextModels)
    } catch (err) {
      setError((err as Error).message || String(err))
    }
  }, [setError])

  const save = useCallback(
    async (next: Settings) => {
      setError('')
      try {
        setSettings(await saveSettings(next))
      } catch (err) {
        setError((err as Error).message || String(err))
      }
    },
    [setError],
  )

  return { settings, models, loadSettings, save }
}
