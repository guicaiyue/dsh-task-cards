// 设置屏：六组（总开关 / 决策者 / 执行者与观察者 / 预算与超时 / 保留与隐私 / 通知）+ 危险区。
// 字段全部来自 Settings 契约；只改本地表单，点「保存」才提交改过的键。
// 「暂停决策者」用 decisionEnabled=false 表达：卡继续建、票不再出；停用走危险区二次确认。
import { type ChangeEvent, type ReactNode, useEffect, useState } from 'react'

import type { ModelCatalogView, Settings, Translate } from '../types'
import { ModelPicker } from './ModelPicker'

export interface SettingsTabProps {
  t: Translate
  settings: Settings | null
  models: ModelCatalogView | null
  busy: boolean
  onSave: (next: Settings) => Promise<void>
}

type DangerField = 'enabled' | 'decisionEnabled'
type ModelValue = { provider: string; model: string }
type Patch = (next: Partial<Settings>) => void
type GroupFields = { t: Translate; form: Settings; models: ModelCatalogView | null; onPatch: Patch }
const NUM = 'dtc-set-input dtc-set-num'
const PROMPT = 'dtc-set-prompt'
const DANGER_BTN = 'dtc-set-danger-btn'
const DANGER_CONFIRM = 'dtc-set-danger-btn is-confirm'
const PRIVACY_KEYS = [
  'setPrivacyRecords',
  'setPrivacyEvents',
  'setPrivacyEvidence',
  'setPrivacyBaseline',
]
const NOTIFY_KEYS = ['setNotifyMajor', 'setNotifySeen', 'setNotifySilent']
/** 只挑出真的改过的键：保存不会把别组没动过的旧值一起写回去。 */
function changedOnly(form: Settings, base: Settings): Partial<Settings> {
  const out: Partial<Settings> = {}
  for (const key of Object.keys(form) as Array<keyof Settings>) {
    if (form[key] !== base[key]) Object.assign(out, { [key]: form[key] })
  }
  return out
}

export function SettingsTab({ t, settings, models, busy, onSave }: SettingsTabProps) {
  const [form, setForm] = useState<Settings | null>(settings)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setForm(settings)
    setSaved(false)
  }, [settings])
  if (!form) return <div className="dtc-empty">{t('loading')}</div>
  const patch: Patch = (next) => {
    setForm((prev) => (prev ? { ...prev, ...next } : prev))
    setSaved(false)
  }
  const base = settings ?? form
  const commit = (next: Settings) => {
    onSave({ ...base, ...changedOnly(next, base) })
      .then(() => setSaved(true))
      .catch(() => {})
  }
  const disable = (field: DangerField) => {
    const next: Settings = { ...form, [field]: false }
    setForm(next)
    commit(next)
  }
  const setEnabled = (v: boolean) => patch({ enabled: v })
  const dirty = Object.keys(changedOnly(form, base)).length > 0
  const save = () => commit(form)
  return (
    <div className="dtc-set">
      <Group title={t('setGroupMaster')} hint={t('setMasterHint')}>
        <Toggle label={t('enabled')} checked={form.enabled} onChange={setEnabled} />
        <p className="dtc-set-note">{t('setEnabledHint')}</p>
      </Group>
      <DecisionGroup t={t} form={form} models={models} onPatch={patch} />
      <ExecGroup t={t} form={form} models={models} onPatch={patch} />
      <BudgetGroup t={t} form={form} onPatch={patch} />
      <ReadonlyGroups t={t} />
      <DangerZone t={t} busy={busy} onDisable={disable} />
      <div className="dtc-set-savebar">
        <span className="dtc-set-state">{dirty ? t('setDirty') : saved ? t('saved') : ''}</span>
        <button type="button" className="dtc-save" disabled={busy || !dirty} onClick={save}>
          {busy ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  )
}

type GroupProps = { title: string; hint?: string; danger?: boolean; children: ReactNode }
function Group({ title, hint, danger, children }: GroupProps) {
  return (
    <section className={danger ? 'dtc-set-group is-danger' : 'dtc-set-group'}>
      <h2 className="dtc-set-title">{title}</h2>
      {hint ? <p className="dtc-set-note">{hint}</p> : null}
      {children}
    </section>
  )
}
type NumberProps = { label: string; value: number; min: number; onChange: (v: number) => void }
type TextProps = {
  label: string
  placeholder?: string
  value: string
  onChange: (v: string) => void
}
type ToggleProps = { label: string; checked: boolean; onChange: (v: boolean) => void }
function NumberField({ label, value, min, onChange }: NumberProps) {
  const onInput = (event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))
  return (
    <label className="dtc-set-field">
      <span className="dtc-set-label">{label}</span>
      <input className={NUM} type="number" min={min} value={value} onChange={onInput} />
    </label>
  )
}
function PromptField({ label, placeholder, value, onChange }: TextProps) {
  const onInput = (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)
  return (
    <label className="dtc-set-field">
      <span className="dtc-set-label">{label}</span>
      <textarea className={PROMPT} placeholder={placeholder} value={value} onChange={onInput} />
    </label>
  )
}
function Toggle({ label, checked, onChange }: ToggleProps) {
  const onInput = (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)
  return (
    <label className="dtc-set-check">
      <input type="checkbox" checked={checked} onChange={onInput} />
      <span className="dtc-set-label">{label}</span>
    </label>
  )
}
function StaticList({ items }: { items: string[] }) {
  return (
    <ul className="dtc-set-static">
      {items.map((item) => (
        <li key={item} className="dtc-set-static-item">
          {item}
        </li>
      ))}
    </ul>
  )
}

function DecisionGroup({ t, form, models, onPatch }: GroupFields) {
  const paused = form.decisionEnabled === false
  const setDecision = (v: boolean) => onPatch({ decisionEnabled: v })
  const setPause = (v: boolean) => onPatch({ decisionEnabled: !v })
  const setDiag = (v: boolean) => onPatch({ autoApproveDiagnostics: v })
  const setModel = (v: ModelValue) =>
    onPatch({ decisionProvider: v.provider, decisionModel: v.model })
  return (
    <Group title={t('setGroupDecision')} hint={t('setDecisionHint')}>
      <Toggle label={t('decisionEnabled')} checked={!paused} onChange={setDecision} />
      <Toggle label={t('setPauseDecision')} checked={paused} onChange={setPause} />
      <p className="dtc-set-note">{t('setPauseHint')}</p>
      <Toggle
        label={t('autoApproveDiagnostics')}
        checked={form.autoApproveDiagnostics === true}
        onChange={setDiag}
      />
      <p className="dtc-set-note">{t('autoApproveDiagnosticsHint')}</p>
      <ModelPicker
        t={t}
        label={t('decisionModel')}
        provider={form.decisionProvider || ''}
        model={form.decisionModel || ''}
        models={models}
        onChange={setModel}
      />
      <PromptField
        label={t('decisionPrompt')}
        placeholder={t('decisionPromptPlaceholder')}
        value={form.decisionPrompt || ''}
        onChange={(v) => onPatch({ decisionPrompt: v })}
      />
      <NumberField
        label={t('setPrecedentLimit')}
        value={form.decisionPrecedentLimit}
        min={0}
        onChange={(v) => onPatch({ decisionPrecedentLimit: v })}
      />
      <p className="dtc-set-note">{t('setPrecedentLimitHint')}</p>
    </Group>
  )
}

function ExecGroup({ t, form, models, onPatch }: GroupFields) {
  const setModel = (v: ModelValue) => onPatch({ provider: v.provider, model: v.model })
  return (
    <Group title={t('setGroupExec')} hint={t('setExecHint')}>
      <ModelPicker
        t={t}
        label={t('model')}
        provider={form.provider || ''}
        model={form.model || ''}
        models={models}
        onChange={setModel}
      />
      <p className="dtc-set-note">{t('setModelHint')}</p>
      <PromptField
        label={t('systemPrompt')}
        value={form.systemPrompt || ''}
        onChange={(v) => onPatch({ systemPrompt: v })}
      />
      <p className="dtc-set-note">{t('setPromptHint')}</p>
      <NumberField
        label={t('minReplyChars')}
        value={form.minReplyChars}
        min={0}
        onChange={(v) => onPatch({ minReplyChars: v })}
      />
      <Toggle
        label={t('setIncludeSubagents')}
        checked={form.includeSubagents === true}
        onChange={(v) => onPatch({ includeSubagents: v })}
      />
      <p className="dtc-set-note">{t('setIncludeSubagentsHint')}</p>
    </Group>
  )
}

function BudgetGroup({ t, form, onPatch }: { t: Translate; form: Settings; onPatch: Patch }) {
  return (
    <Group title={t('setGroupBudget')} hint={t('setBudgetHint')}>
      <NumberField
        label={t('setMaxInputBytes')}
        value={form.maxInputBytes}
        min={1}
        onChange={(v) => onPatch({ maxInputBytes: v })}
      />
      <p className="dtc-set-note">{t('setMaxInputBytesHint')}</p>
      <NumberField
        label={t('timeoutMs')}
        value={form.timeoutMs}
        min={1000}
        onChange={(v) => onPatch({ timeoutMs: v })}
      />
      <p className="dtc-set-note">{t('setTimeoutHint')}</p>
    </Group>
  )
}

function ReadonlyGroups({ t }: { t: Translate }) {
  return (
    <>
      <Group title={t('setGroupPrivacy')} hint={t('setPrivacyHint')}>
        <StaticList items={PRIVACY_KEYS.map((key) => t(key))} />
      </Group>
      <Group title={t('setGroupNotify')}>
        <StaticList items={NOTIFY_KEYS.map((key) => t(key))} />
      </Group>
    </>
  )
}

type DangerProps = { t: Translate; busy: boolean; onDisable: (field: DangerField) => void }
function DangerZone({ t, busy, onDisable }: DangerProps) {
  const [pending, setPending] = useState<DangerField | ''>('')
  const cancel = () => setPending('')
  const rows = [
    { field: 'enabled', label: t('setDisableObserver'), hint: t('setDisableObserverHint') },
    { field: 'decisionEnabled', label: t('setDisableDecision'), hint: t('setDisableDecisionHint') },
  ] as const
  return (
    <Group title={t('setDanger')} hint={t('setDangerHint')} danger>
      {rows.map((row) => {
        const armed = pending === row.field
        return (
          <div key={row.field} className="dtc-set-danger-row">
            <span className="dtc-set-danger-main">
              <span className="dtc-set-label">{row.label}</span>
              <span className="dtc-set-note">{row.hint}</span>
            </span>
            <button
              type="button"
              className={armed ? DANGER_CONFIRM : DANGER_BTN}
              disabled={busy}
              onClick={() => {
                setPending(armed ? '' : row.field)
                if (armed) onDisable(row.field)
              }}
            >
              {armed ? t('setConfirmDisable') : row.label}
            </button>
            {armed ? (
              <button type="button" className="dtc-set-cancel" onClick={cancel}>
                {t('setCancel')}
              </button>
            ) : null}
          </div>
        )
      })}
    </Group>
  )
}
