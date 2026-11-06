// 提示词页：观察者设置 + 决策代理人设置，共用底部一个保存按钮。

import { useEffect, useState } from 'react'

import type { ModelCatalogView, Precedent, Settings, Translate } from '../types'
import { DecisionSettings } from './DecisionSettings'
import { ModelPicker } from './ModelPicker'
import { NumberFields } from './NumberFields'

interface Props {
  t: Translate
  settings: Settings | null
  models: ModelCatalogView | null
  precedents: Precedent[]
  busy: boolean
  onSave: (next: Settings) => Promise<void>
}

export function SettingsTab({ t, settings, models, precedents, busy, onSave }: Props) {
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
      <ObserverFields t={t} form={form} models={models} onPatch={patch} />
      <DecisionSettings
        t={t}
        value={form}
        models={models}
        precedents={precedents}
        onChange={patch}
      />
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
    <>
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
    </>
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
