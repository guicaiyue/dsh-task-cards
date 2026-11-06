// 设置视图：观察者页与决策页共用一份表单与一个保存按钮，页签切换不丢未保存的改动。

import { useEffect, useState } from 'react'

import type {
  ModelCatalogView,
  ObserverRecord,
  PanelTab,
  Precedent,
  Settings,
  Translate,
} from '../types'
import { DecisionSettings } from './DecisionSettings'
import { ModelPicker } from './ModelPicker'
import { NumberFields } from './NumberFields'

type SettingsTabId = Exclude<PanelTab, 'cards'>

interface Props {
  t: Translate
  tab: SettingsTabId
  settings: Settings | null
  models: ModelCatalogView | null
  precedents: Precedent[]
  records: ObserverRecord[]
  busy: boolean
  onSave: (next: Settings) => Promise<void>
}

export function SettingsTab({
  t,
  tab,
  settings,
  models,
  precedents,
  records,
  busy,
  onSave,
}: Props) {
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
      {tab === 'observer' ? (
        <ObserverFields t={t} form={form} models={models} onPatch={patch} />
      ) : (
        <DecisionSettings
          t={t}
          value={form}
          models={models}
          precedents={precedents}
          records={records}
          onChange={patch}
        />
      )}
      <SaveRow
        t={t}
        busy={busy}
        saved={saved}
        onSave={async () => {
          await onSave(form)
          setSaved(true)
        }}
      />
    </>
  )
}

interface ObserverProps {
  t: Translate
  form: Settings
  models: ModelCatalogView | null
  onPatch: (changes: Partial<Settings>) => void
}

function ObserverFields({ t, form, models, onPatch }: ObserverProps) {
  return (
    <div className="dtc-section">
      <div className="dtc-section-head">
        <span className="dtc-section-title">{t('observerSection')}</span>
      </div>
      <div className="dtc-hint">{t('settingsHint')}</div>
      <label className="dtc-row" style={{ cursor: 'pointer', fontSize: '12px' }}>
        <input
          type="checkbox"
          checked={!!form.enabled}
          onChange={(event) => onPatch({ enabled: event.target.checked })}
        />
        <span>{t('enabled')}</span>
      </label>
      <ModelPicker
        t={t}
        provider={form.provider || ''}
        model={form.model || ''}
        models={models}
        onChange={onPatch}
      />
      <NumberFields t={t} value={form} onChange={onPatch} />
      <div className="dtc-field">
        <span>{t('systemPrompt')}</span>
      </div>
      <textarea
        className="dtc-textarea"
        value={form.systemPrompt || ''}
        onChange={(event) => onPatch({ systemPrompt: event.target.value })}
      />
    </div>
  )
}

interface SaveProps {
  t: Translate
  busy: boolean
  saved: boolean
  onSave: () => Promise<void>
}

function SaveRow({ t, busy, saved, onSave }: SaveProps) {
  return (
    <div className="dtc-row">
      <button
        type="button"
        className="dtc-save"
        disabled={busy}
        onClick={() => {
          onSave().catch(() => {})
        }}
      >
        {busy ? t('saving') : t('save')}
      </button>
      {saved ? <span className="dtc-hint">{t('saved')}</span> : null}
    </div>
  )
}
