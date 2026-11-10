// 详情「依赖」段：等 X 完成 + 卡上依赖链（从 DetailSegments 拆出）。

import type { Card, Translate } from '../types'

export function DependencySegment({ t, card }: { t: Translate; card: Card }) {
  const deps = [...new Set([...(card.blockedBy ?? []), ...(card.advice?.dependsOn ?? [])])]
  return (
    <section className="dtc-seg">
      <div className="dtc-seg-head">
        <span className="dtc-seg-title">{t('caseDepsTitle')}</span>
        {card.waitReason === 'depends-on' ? (
          <span className="dtc-seg-aside">{t('wait_depends-on')}</span>
        ) : null}
      </div>
      <div className="dtc-seg-body">
        {deps.length ? (
          <ul className="dtc-case-list">
            {deps.map((id) => (
              <li key={id} className="dtc-case-item">
                <span className="dtc-case-dot" aria-hidden="true" />
                <span className="dtc-mono">{id}</span>
                <span className="dtc-case-text">{t('caseDepsWaiting', { id })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dtc-hint">{t('caseDepsEmpty')}</p>
        )}
      </div>
    </section>
  )
}
