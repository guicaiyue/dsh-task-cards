// 提示词页：观察者开关、模型、阈值、系统提示词。

import { useEffect, useState } from 'react'

import type { ModelCatalogView, Settings, Translate } from '../types'
import { ModelPicker } from './ModelPicker'
import { NumberFields } from './NumberFields'

interface Props {
  t: Translate
  settings: Settings | null
  models: ModelCatalogView | null
  busy: boolean
  onSave: (next: Settings) => Promise<void>
}

export function SettingsTab({ t, settings, models, busy, onSave }: Props) {
  const [form, setForm] = useState<Settings | null>(settings)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setForm(settings)
  }, [settings])

  if (!form) return <div className="dtc-empty">{t('loading')}</div>

  const patch = (changes: Partial<Settings>) => {
    setForm((prev) => ({ ...(prev as Settings), ...changes }))
    setSaved(false)
  }

  return (
    <>
      <div className="dtc-hint">{t('settingsHint')}</div>
      <label className="dtc-row" style={{ cursor: 'pointer', fontSize: '12px' }}>
        <input
          type="checkbox"
          checked={!!form.enabled}
          onChange={(event) => patch({ enabled: event.target.checked })}
        />
        <span>{t('enabled')}</span>
      </label>
      <ModelPicker t={t} value={form} models={models} onChange={patch} />
      <NumberFields t={t} value={form} onChange={patch} />
      <div className="dtc-field">
        <span>{t('systemPrompt')}</span>
      </div>
      <textarea
        className="dtc-textarea"
        value={form.systemPrompt || ''}
        onChange={(event) => patch({ systemPrompt: event.target.value })}
      />
      <div className="dtc-row">
        <button
          type="button"
          className="dtc-save"
          disabled={busy}
          onClick={async () => {
            await onSave(form)
            setSaved(true)
          }}
        >
          {busy ? t('saving') : t('save')}
        </button>
        {saved ? <span className="dtc-hint">{t('saved')}</span> : null}
      </div>
    </>
  )
}
