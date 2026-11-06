// 详情弹窗里的票拟区块：结论 + 一句话摘要 + 方案对照（每块可采纳）+ 依据 +
// 判例编号（点开看判例）+ 返工标记（带一句原因）。
//
// 结论是「建议」，不是已经发生的事：采纳才动外部世界，返工标记只写判例库。

import { useState } from 'react'
import { confidenceLabel, laneLabel, verdictLabel, verdictTone } from '../advice'
import { timeLabel } from '../time'
import type { Advice, CardKind, Precedent, Translate } from '../types'
import { AdviceOptionCard } from './AdviceOptionCard'
import { PrecedentList } from './PrecedentList'

interface Props {
  t: Translate
  advice: Advice
  /** 卡片当前车道：票拟判的车道不同时说明原分类被纠正。 */
  cardKind: CardKind
  precedents: Precedent[]
  busy: boolean
  closed: boolean
  /** 系统已经替用户执行过这张票拟（卡上有 advice-applied 事件）。 */
  autoApplied: boolean
  onAdopt: (index: number) => void
  onReworked: (note: string) => void
}

export function AdviceBlock({
  t,
  advice,
  cardKind,
  precedents,
  busy,
  closed,
  autoApplied,
  onAdopt,
  onReworked,
}: Props) {
  const [showPrecedents, setShowPrecedents] = useState(false)
  const cited = precedents.filter((item) => advice.precedentIds.includes(item.id))
  return (
    <div className="dtc-advice">
      <AdviceHead t={t} advice={advice} cardKind={cardKind} autoApplied={autoApplied} />
      {advice.summary ? <div className="dtc-advice-summary">{advice.summary}</div> : null}
      {advice.verdict === 'wait' && advice.question ? (
        <div className="dtc-advice-question">
          {t('adviceQuestion', { question: advice.question })}
        </div>
      ) : null}
      {advice.options.length ? (
        <div className="dtc-advice-options">
          {advice.options.map((option, index) => {
            const chosen = index === advice.chosen
            return (
              <AdviceOptionCard
                key={`${option.name}::${option.verdict}::${option.answer}`}
                t={t}
                option={option}
                index={index}
                chosen={chosen}
                autoApply={chosen && advice.autoApply}
                busy={busy}
                closed={closed}
                onAdopt={onAdopt}
              />
            )
          })}
        </div>
      ) : null}
      {advice.basis ? (
        <div className="dtc-advice-basis">{t('adviceBasis', { basis: advice.basis })}</div>
      ) : null}
      <PrecedentLinks
        t={t}
        ids={advice.precedentIds}
        open={showPrecedents}
        onToggle={() => setShowPrecedents((prev) => !prev)}
      />
      {showPrecedents ? <PrecedentList t={t} precedents={cited} limit={8} /> : null}
      <ReworkRow t={t} busy={busy} onReworked={onReworked} />
    </div>
  )
}

function AdviceHead({
  t,
  advice,
  cardKind,
  autoApplied,
}: {
  t: Translate
  advice: Advice
  cardKind: CardKind
  autoApplied: boolean
}) {
  return (
    <div className="dtc-advice-head">
      <span className="dtc-advice-eyebrow">{t('adviceEyebrow')}</span>
      <span className={`dtc-chip ${verdictTone(advice.verdict)}`}>
        {verdictLabel(t, advice.verdict)}
      </span>
      {autoApplied ? <span className="dtc-chip is-approve">{t('adviceAutoApplied')}</span> : null}
      <span className="dtc-advice-confidence">{confidenceLabel(t, advice.confidence)}</span>
      {advice.lane !== cardKind ? (
        <span className="dtc-advice-lane">
          {advice.applied
            ? t('adviceLaneApplied', { lane: laneLabel(t, advice.lane) })
            : t('adviceLaneSuggest', { lane: laneLabel(t, advice.lane) })}
        </span>
      ) : null}
      <span className="dtc-spacer" />
      <span className="dtc-advice-at">{t('adviceAt', { time: timeLabel(advice.at) })}</span>
    </div>
  )
}

interface LinkProps {
  t: Translate
  ids: string[]
  open: boolean
  onToggle: () => void
}

function PrecedentLinks({ t, ids, open, onToggle }: LinkProps) {
  if (!ids.length) return <div className="dtc-advice-precedents">{t('adviceNoPrecedent')}</div>
  return (
    <div className="dtc-advice-precedents">
      <span>{t('advicePrecedents')}</span>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className="dtc-advice-link"
          aria-expanded={open}
          onClick={onToggle}
        >
          {id}
        </button>
      ))}
      <span className="dtc-advice-precedents-hint">{t('advicePrecedentsHint')}</span>
    </div>
  )
}

interface ReworkProps {
  t: Translate
  busy: boolean
  onReworked: (note: string) => void
}

function ReworkRow({ t, busy, onReworked }: ReworkProps) {
  const [note, setNote] = useState('')
  const [marked, setMarked] = useState(false)
  return (
    <div className="dtc-advice-rework">
      <input
        className="dtc-input"
        value={note}
        placeholder={t('reworkPlaceholder')}
        onChange={(event) => {
          setNote(event.target.value)
          setMarked(false)
        }}
      />
      <button
        type="button"
        className="dtc-btn is-danger"
        disabled={busy}
        onClick={() => {
          onReworked(note)
          setNote('')
          setMarked(true)
        }}
      >
        {t('reworkButton')}
      </button>
      {marked ? <span className="dtc-advice-marker">{t('reworkSaved')}</span> : null}
    </div>
  )
}
