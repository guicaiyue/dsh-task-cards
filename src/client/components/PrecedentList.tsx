// 判例列表：设置页与详情弹窗共用。outcome=reworked 的条目整条标红。

import { outcomeLabel, outcomeTone } from '../advice'
import { timeLabel } from '../time'
import type { Precedent, Translate } from '../types'

interface Props {
  t: Translate
  precedents: Precedent[]
  /** 最多显示几条，其余折成一行「还有 n 条」。 */
  limit?: number
}

export function PrecedentList({ t, precedents, limit }: Props) {
  if (!precedents.length) return <div className="dtc-hint">{t('precedentEmpty')}</div>
  const visible = limit && limit > 0 ? precedents.slice(0, limit) : precedents
  const hidden = precedents.length - visible.length
  return (
    <div className="dtc-precedents">
      {visible.map((precedent) => (
        <PrecedentRow key={precedent.id} t={t} precedent={precedent} />
      ))}
      {hidden > 0 ? <div className="dtc-hint">{t('precedentMore', { n: hidden })}</div> : null}
    </div>
  )
}

function PrecedentRow({ t, precedent }: { t: Translate; precedent: Precedent }) {
  const reworked = precedent.outcome === 'reworked'
  return (
    <div className={`dtc-precedent ${outcomeTone(precedent.outcome)}`}>
      <div className="dtc-precedent-head">
        <code>{precedent.id}</code>
        <span className="dtc-precedent-title">{precedent.title || precedent.choice}</span>
        <span className="dtc-chip">{outcomeLabel(t, precedent.outcome)}</span>
        <span className="dtc-precedent-at">{timeLabel(precedent.at)}</span>
      </div>
      <div className="dtc-precedent-meta">
        <span>
          {t('precedentChoice', { choice: precedent.choice || t('precedentChoiceEmpty') })}
        </span>
      </div>
      {reworked && precedent.note ? (
        <div className="dtc-precedent-note">{t('precedentNote', { note: precedent.note })}</div>
      ) : null}
    </div>
  )
}
