// 观察者模型选择：空值 = 跟随当前默认模型；否则 provider::model。

import type { ModelCatalogView, Settings, Translate } from '../types'

interface Props {
  t: Translate
  value: Settings
  models: ModelCatalogView | null
  onChange: (patch: Partial<Settings>) => void
}

export function ModelPicker({ t, value, models, onChange }: Props) {
  const groups = models?.groups || []
  const selected = value.provider && value.model ? `${value.provider}::${value.model}` : ''
  return (
    <div className="dtc-row">
      <div className="dtc-field" style={{ flex: 1, minWidth: '260px' }}>
        <span>{t('model')}</span>
        <select
          className="dtc-select"
          value={selected}
          onChange={(event) => {
            const raw = event.target.value
            if (!raw) {
              onChange({ provider: '', model: '' })
              return
            }
            const [provider, model] = raw.split('::')
            onChange({ provider, model })
          }}
        >
          <option value="">{t('modelDefault')}</option>
          {groups.map((group) => (
            <optgroup key={group.provider} label={group.provider}>
              {(group.models || []).map((model) => (
                <option
                  key={`${group.provider}::${model.id}`}
                  value={`${group.provider}::${model.id}`}
                >
                  {model.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  )
}
