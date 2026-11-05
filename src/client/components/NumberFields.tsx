// 两个数值项：最小回复长度、超时毫秒。

import type { Settings, Translate } from '../types'

interface Props {
  t: Translate
  value: Settings
  onChange: (patch: Partial<Settings>) => void
}

export function NumberFields({ t, value, onChange }: Props) {
  return (
    <div className="dtc-row">
      <div className="dtc-field" style={{ flex: 1 }}>
        <span>{t('minReplyChars')}</span>
        <input
          className="dtc-input"
          type="number"
          min={0}
          value={value.minReplyChars ?? 120}
          onChange={(event) => onChange({ minReplyChars: Number(event.target.value) })}
        />
      </div>
      <div className="dtc-field" style={{ flex: 1 }}>
        <span>{t('timeoutMs')}</span>
        <input
          className="dtc-input"
          type="number"
          min={1000}
          value={value.timeoutMs ?? 60000}
          onChange={(event) => onChange({ timeoutMs: Number(event.target.value) })}
        />
      </div>
    </div>
  )
}
