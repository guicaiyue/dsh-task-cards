// 策略与验收模板：左边是只读的内置模板与三层判定，右边是当前生效阈值表单。
//
// 策略回答「怎么判」，所以模板只读、阈值可改；字段只取 Settings 已存在的那些，
// 保存时把改动并进 settings 交给 onSave，不新增契约。

import { useState } from 'react'

import type { Settings, Translate } from '../types'

export interface PolicyTabProps {
  t: Translate
  settings: Settings | null
  busy: boolean
  onSave: (next: Settings) => Promise<void>
}

interface TemplateView {
  id: string
  nameKey: string
  whenKey: string
  passKey: string
}

/** M1 的三种确定性检查器：命令退出码 / 文件存在性 / HTTP 状态码。 */
const TEMPLATES: readonly TemplateView[] = [
  {
    id: 'exit',
    nameKey: 'policyTplExitName',
    whenKey: 'policyTplExitWhen',
    passKey: 'policyTplExitPass',
  },
  {
    id: 'file',
    nameKey: 'policyTplFileName',
    whenKey: 'policyTplFileWhen',
    passKey: 'policyTplFilePass',
  },
  {
    id: 'http',
    nameKey: 'policyTplHttpName',
    whenKey: 'policyTplHttpWhen',
    passKey: 'policyTplHttpPass',
  },
]

/** 三层判定：与 case-contract 的 confirmed / failed / unknown 一一对应。 */
const LAYERS: ReadonlyArray<{ id: string; tone: string; textKey: string }> = [
  { id: 'confirmed', tone: 'is-ok', textKey: 'policyLayerConfirmedText' },
  { id: 'failed', tone: 'is-fail', textKey: 'policyLayerFailedText' },
  { id: 'unknown', tone: 'is-unknown', textKey: 'policyLayerUnknownText' },
]

const NUM_FIELDS = [
  { key: 'minReplyChars', labelKey: 'policyFieldMinReply' },
  { key: 'timeoutMs', labelKey: 'policyFieldTimeout' },
  { key: 'maxInputBytes', labelKey: 'policyFieldMaxInput' },
  { key: 'decisionPrecedentLimit', labelKey: 'policyFieldPrecedent' },
] as const

type NumKey = (typeof NUM_FIELDS)[number]['key']

const TOGGLES = [
  {
    key: 'decisionAutoApply',
    labelKey: 'policyFieldAutoApply',
    hintKey: 'policyFieldAutoApplyHint',
  },
  {
    key: 'autoApproveDiagnostics',
    labelKey: 'policyFieldDiagnostics',
    hintKey: 'policyFieldDiagnosticsHint',
  },
] as const

type ToggleKey = (typeof TOGGLES)[number]['key']

/** 数字字段的补丁：显式构造，避免用计算键把类型放宽。 */
function numberPatch(key: NumKey, value: number): Partial<Settings> {
  if (key === 'minReplyChars') return { minReplyChars: value }
  if (key === 'timeoutMs') return { timeoutMs: value }
  if (key === 'maxInputBytes') return { maxInputBytes: value }
  return { decisionPrecedentLimit: value }
}

/** 开关字段的补丁：同上，保持字段级类型。 */
function togglePatch(key: ToggleKey, value: boolean): Partial<Settings> {
  if (key === 'decisionAutoApply') return { decisionAutoApply: value }
  return { autoApproveDiagnostics: value }
}

export function PolicyTab({ t, settings, busy, onSave }: PolicyTabProps): JSX.Element {
  return (
    <div className="dtc-pol">
      <div className="dtc-pol-col">
        <TemplateLibrary t={t} />
      </div>
      <div className="dtc-pol-col">
        <ThresholdForm t={t} settings={settings} busy={busy} onSave={onSave} />
      </div>
    </div>
  )
}

function TemplateLibrary({ t }: { t: Translate }) {
  return (
    <>
      <section className="dtc-pol-card">
        <h4 className="dtc-pol-h">{t('policyTemplatesTitle')}</h4>
        <p className="dtc-pol-sub">{t('policyTemplatesHint')}</p>
        <div className="dtc-pol-tpl-grid">
          {TEMPLATES.map((tpl) => (
            <TemplateCard key={tpl.id} t={t} tpl={tpl} />
          ))}
        </div>
      </section>
      <section className="dtc-pol-card">
        <h4 className="dtc-pol-h">{t('gateScopeTitle')}</h4>
        <p className="dtc-pol-sub">{t('gateScopeBody')}</p>
      </section>
      <section className="dtc-pol-card">
        <h4 className="dtc-pol-h">{t('policyLayersTitle')}</h4>
        <ul className="dtc-pol-layers">
          {LAYERS.map((layer) => (
            <li key={layer.id} className={`dtc-pol-layer ${layer.tone}`}>
              <span className="dtc-pol-layer-name">{layer.id}</span>
              <span>{t(layer.textKey)}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

function TemplateCard({ t, tpl }: { t: Translate; tpl: TemplateView }) {
  return (
    <div className="dtc-pol-tpl">
      <div className="dtc-pol-tpl-head">
        <span className="dtc-pol-kind">{tpl.id}</span>
        <span className="dtc-pol-tpl-name">{t(tpl.nameKey)}</span>
      </div>
      <p className="dtc-pol-tpl-field">
        <span className="dtc-pol-tpl-label">{t('policyTplWhen')}：</span>
        {t(tpl.whenKey)}
      </p>
      <p className="dtc-pol-tpl-field">
        <span className="dtc-pol-tpl-label">{t('policyTplPass')}：</span>
        {t(tpl.passKey)}
      </p>
      <span className="dtc-pol-timeout">{t('policyTplTimeout')}</span>
    </div>
  )
}

function ThresholdForm({
  t,
  settings,
  busy,
  onSave,
}: {
  t: Translate
  settings: Settings | null
  busy: boolean
  onSave: (next: Settings) => Promise<void>
}) {
  const [draft, setDraft] = useState<Partial<Settings>>({})
  const [seen, setSeen] = useState<Settings | null>(settings)
  // 父层保存或刷新后 settings 换新对象：丢掉草稿，避免旧值盖住新值。
  if (seen !== settings) {
    setSeen(settings)
    setDraft({})
  }
  if (!settings) return <p className="dtc-pol-loading">{t('loading')}</p>
  const merged: Settings = { ...settings, ...draft }
  const patch = (changes: Partial<Settings>) => setDraft((prev) => ({ ...prev, ...changes }))
  return (
    <section className="dtc-pol-card">
      <h4 className="dtc-pol-h">{t('policyThresholdTitle')}</h4>
      <p className="dtc-pol-sub">{t('policyThresholdHint')}</p>
      <NumberGrid t={t} form={merged} onPatch={patch} />
      <ToggleFields t={t} form={merged} onPatch={patch} />
      <div className="dtc-pol-save-row">
        <button
          type="button"
          className="dtc-pol-save"
          disabled={busy}
          onClick={() => {
            onSave(merged).catch(() => {})
          }}
        >
          {busy ? t('saving') : t('save')}
        </button>
      </div>
    </section>
  )
}

function NumberGrid({
  t,
  form,
  onPatch,
}: {
  t: Translate
  form: Settings
  onPatch: (changes: Partial<Settings>) => void
}) {
  return (
    <div className="dtc-pol-fields">
      {NUM_FIELDS.map((field) => (
        <label key={field.key} className="dtc-pol-field">
          <span className="dtc-pol-label">{t(field.labelKey)}</span>
          <input
            className="dtc-pol-input"
            type="number"
            min={0}
            value={form[field.key]}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10)
              if (Number.isFinite(next)) onPatch(numberPatch(field.key, next))
            }}
          />
        </label>
      ))}
    </div>
  )
}

function ToggleFields({
  t,
  form,
  onPatch,
}: {
  t: Translate
  form: Settings
  onPatch: (changes: Partial<Settings>) => void
}) {
  return (
    <div className="dtc-pol-checks">
      {TOGGLES.map((toggle) => (
        <label key={toggle.key} className="dtc-pol-check">
          <input
            type="checkbox"
            checked={form[toggle.key]}
            onChange={(event) => onPatch(togglePatch(toggle.key, event.target.checked))}
          />
          <span>
            {t(toggle.labelKey)}
            <span className="dtc-pol-check-hint">{t(toggle.hintKey)}</span>
          </span>
        </label>
      ))}
    </div>
  )
}
