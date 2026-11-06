// 模型选择：空值 = 跟随当前默认模型；否则 provider::model。
//
// 观察者与决策代理人共用，字段名由调用方映射（provider/model 各传各的）。

import type { ModelCatalogView, Translate } from '../types'

interface Props {
  t: Translate
  /** 不传就用通用标签「分析用的模型」。 */
  label?: string
  provider: string
  model: string
  models: ModelCatalogView | null
  onChange: (value: { provider: string; model: string }) => void
}

export function ModelPicker({ t, label, provider, model, models, onChange }: Props) {
  const groups = models?.groups || []
  const selected = provider && model ? `${provider}::${model}` : ''
  return (
    <div className="dtc-row">
      <div className="dtc-field" style={{ flex: 1, minWidth: '260px' }}>
        <span>{label || t('model')}</span>
        <select
          className="dtc-select"
          value={selected}
          onChange={(event) => {
            const raw = event.target.value
            if (!raw) {
              onChange({ provider: '', model: '' })
              return
            }
            const [nextProvider, nextModel] = raw.split('::')
            onChange({ provider: nextProvider || '', model: nextModel || '' })
          }}
        >
          <option value="">{t('modelDefault')}</option>
          {groups.map((group) => (
            <optgroup key={group.provider} label={group.provider}>
              {(group.models || []).map((item) => (
                <option
                  key={`${group.provider}::${item.id}`}
                  value={`${group.provider}::${item.id}`}
                >
                  {item.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  )
}
