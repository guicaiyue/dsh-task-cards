// 决策页：开关、自动执行许可、模型、提示词（空 = 用默认画像）、判例库、最近执行记录。

import type { ModelCatalogView, ObserverRecord, Precedent, Settings, Translate } from '../types'
import { ModelPicker } from './ModelPicker'
import { PrecedentList } from './PrecedentList'
import { RecordList } from './RecordList'

function ToggleRow({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <label className="dtc-row" style={{ cursor: 'pointer', fontSize: '12px' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

interface Props {
  t: Translate
  value: Settings
  models: ModelCatalogView | null
  precedents: Precedent[]
  records: ObserverRecord[]
  onChange: (patch: Partial<Settings>) => void
}

export function DecisionSettings({ t, value, models, precedents, records, onChange }: Props) {
  return (
    <div className="dtc-section">
      <div className="dtc-section-head">
        <span className="dtc-section-title">{t('decisionSection')}</span>
        <span className="dtc-section-count">{t('precedentCount', { n: precedents.length })}</span>
      </div>
      <div className="dtc-hint">{t('decisionHint')}</div>
      <ToggleRow
        checked={value.decisionEnabled !== false}
        label={t('decisionEnabled')}
        onChange={(next) => onChange({ decisionEnabled: next })}
      />
      <ToggleRow
        checked={value.decisionAutoApply !== false}
        label={t('decisionAutoApply')}
        onChange={(next) => onChange({ decisionAutoApply: next })}
      />
      <div className="dtc-hint">{t('decisionAutoApplyHint')}</div>
      <ToggleRow
        checked={value.autoApproveDiagnostics === true}
        label={t('autoApproveDiagnostics')}
        onChange={(next) => onChange({ autoApproveDiagnostics: next })}
      />
      <div className="dtc-hint">{t('autoApproveDiagnosticsHint')}</div>
      <ModelPicker
        t={t}
        label={t('decisionModel')}
        provider={value.decisionProvider || ''}
        model={value.decisionModel || ''}
        models={models}
        onChange={(next) =>
          onChange({ decisionProvider: next.provider, decisionModel: next.model })
        }
      />
      <div className="dtc-field">
        <span>{t('decisionPrompt')}</span>
      </div>
      <textarea
        className="dtc-textarea is-short"
        placeholder={t('decisionPromptPlaceholder')}
        value={value.decisionPrompt || ''}
        onChange={(event) => onChange({ decisionPrompt: event.target.value })}
      />
      <div className="dtc-section-head">
        <span className="dtc-section-title">{t('precedentTitle')}</span>
      </div>
      <PrecedentList t={t} precedents={precedents} limit={12} />
      <div className="dtc-section-head">
        <span className="dtc-section-title">{t('recordTitle')}</span>
        <span className="dtc-section-count">{t('recordCount', { n: records.length })}</span>
      </div>
      <RecordList t={t} records={records} limit={10} />
    </div>
  )
}
