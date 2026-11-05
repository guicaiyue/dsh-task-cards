// 手写一条卡：输入框 + 记下。回车等同点击。

import type { Translate } from '../types'

interface Props {
  t: Translate
  draft: string
  busy: boolean
  onChange: (value: string) => void
  onAdd: () => void
}

const MAX_TITLE = 200

export function CardComposer({ t, draft, busy, onChange, onAdd }: Props) {
  return (
    <div className="dtc-form">
      <input
        className="dtc-input"
        value={draft}
        placeholder={t('placeholder')}
        disabled={busy}
        maxLength={MAX_TITLE}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onAdd()
          }
        }}
      />
      <button type="button" className="dtc-add" disabled={busy || !draft.trim()} onClick={onAdd}>
        {t('add')}
      </button>
    </div>
  )
}
