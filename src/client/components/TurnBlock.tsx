// 详情弹窗里的一轮：用户那句话 + 模型最终输出。太长时默认折叠。

import { useState } from 'react'
import { timeLabel } from '../time'
import type { Translate, Turn } from '../types'

const CLAMP_LINES = 6
const CLAMP_CHARS = 320

interface Props {
  t: Translate
  turn: Turn
  index: number
}

export function TurnBlock({ t, turn, index }: Props) {
  const [open, setOpen] = useState(false)
  const assistant = turn.assistant || ''
  const long = assistant.length > CLAMP_CHARS || assistant.split('\n').length > CLAMP_LINES
  return (
    <div className="dtc-turn">
      <div className="dtc-turn-label">
        <b>{t('turnNo', { n: index + 1 })}</b>
        {turn.at ? <span>{timeLabel(turn.at)}</span> : null}
      </div>
      {turn.user ? (
        <div>
          <div className="dtc-role">{t('roleUser')}</div>
          <div className="dtc-turn-user">{turn.user}</div>
        </div>
      ) : null}
      {assistant ? (
        <div>
          <div className="dtc-role">{t('roleModel')}</div>
          <div className={`dtc-turn-ai${long && !open ? ' dtc-clamp' : ''}`}>{assistant}</div>
          {long ? (
            <button type="button" className="dtc-more" onClick={() => setOpen((value) => !value)}>
              {open ? t('longCollapse') : t('longExpand')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
