// 验收方式展示 + 一键补（file/exit/http 模板；服务端白名单 + 面板令牌）。

import type { Card, Translate } from '../types'

type Fix = (card: Card, acceptance: Array<Record<string, unknown>>) => void

function template(kind: string, value: string): Array<Record<string, unknown>> {
  const base = { id: `acc-${kind}-${Date.now()}`, level: 'E2', verifier: 'system' }
  if (kind === 'file') return [{ ...base, spec: { kind: 'file', path: value, expect: 'exists' } }]
  if (kind === 'exit') return [{ ...base, spec: { kind: 'exit', cmd: value, expect: 0 } }]
  return [{ ...base, spec: { kind: 'http', url: value, expect: 200 } }]
}

export function AcceptanceBlock({
  t,
  card,
  onFixAcceptance,
}: {
  t: Translate
  card: Card
  onFixAcceptance?: Fix
}) {
  const acceptance = card.acceptance ?? []
  if (acceptance.length) {
    return (
      <ul className="dtc-case-list">
        {acceptance.map((item) => (
          <li key={item.id} className="dtc-case-item">
            <span className="dtc-case-dot" aria-hidden="true" />
            <span className="dtc-mono">{item.spec.kind}</span>
            <span className="dtc-case-text">{item.id}</span>
          </li>
        ))}
      </ul>
    )
  }
  if (!onFixAcceptance) return null
  const add = (kind: 'file' | 'exit' | 'http', hint: string, fallback: string) => {
    const value = window.prompt(hint, fallback) || fallback
    onFixAcceptance(card, template(kind, value))
  }
  return (
    <div className="dtc-hint">
      <p>{t('caseNoAcceptance')}</p>
      <button
        type="button"
        className="dtc-btn"
        onClick={() => add('file', t('caseAcceptancePath'), 'package.json')}
      >
        {t('caseAcceptanceFile')}
      </button>
      <button
        type="button"
        className="dtc-btn"
        onClick={() => add('exit', t('caseAcceptanceCmd'), 'pnpm test')}
      >
        {t('caseAcceptanceExit')}
      </button>
      <button
        type="button"
        className="dtc-btn"
        onClick={() => add('http', t('caseAcceptanceUrl'), 'https://example.com')}
      >
        {t('caseAcceptanceHttp')}
      </button>
    </div>
  )
}
