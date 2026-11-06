// 决策页：开关、自动执行许可、模型、提示词（空 = 用默认画像）、判例库、最近执行记录。

import type { ModelCatalogView, ObserverRecord, Precedent, Settings, Translate } from '../types'
import { ModelPicker } from './ModelPicker'
import { PrecedentList } from './PrecedentList'
import { RecordList } from './RecordList'

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
      <label className="dtc-row" style={{ cursor: 'pointer', fontSize: '12px' }}>
        <input
          type="checkbox"
          checked={value.decisionEnabled !== false}
          onChange={(event) => onChange({ decisionEnabled: event.target.checked })}
        />
        <span>{t('decisionEnabled')}</span>
      </label>
      <label className="dtc-row" style={{ cursor: 'pointer', fontSize: '12px' }}>
        <input
          type="checkbox"
          checked={value.decisionAutoApply !== false}
          onChange={(event) => onChange({ decisionAutoApply: event.target.checked })}
        />
        <span>{t('decisionAutoApply')}</span>
      </label>
      <div className="dtc-hint">{t('decisionAutoApplyHint')}</div>
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
