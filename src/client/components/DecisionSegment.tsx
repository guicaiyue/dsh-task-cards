// 详情「决定」段：票拟全文 + 采纳/返工；没票拟时给「出一版」入口。

import { isCardClosed } from '../../shared/state'
import { isAdviceApplied } from '../advice'
import { AdviceBlock } from './AdviceBlock'
import { suggestOfAsk } from './ask-suggest'
import type { SegmentsProps } from './DetailSegments'
import { Segment } from './Segment'

/** ① 决定：票拟全文 + 采纳/返工；没票拟时给出「出一版」的入口。 */
export function DecisionSegment(props: SegmentsProps) {
  const { t, card, precedents, busy } = props
  const suggest = suggestOfAsk(props.suggestAsk, card)
  const advice = card.advice
  const judgment = !advice?.ask || advice.ask === 'judgment'
  const ask = card.ask || advice?.ask || 'judgment'
  return (
    <Segment title={t('segDecide')} aside={t(`ask_${ask}`)}>
      {!advice ? (
        <>
          <p className="dtc-hint">{t('detailNoAdvice')}</p>
          {card.kind === 'decision' && card.status === 'open' ? (
            <button
              type="button"
              className="dtc-btn"
              disabled={busy}
              onClick={() => props.onRedecide(card)}
            >
              {t('adviceRedecide')}
            </button>
          ) : null}
        </>
      ) : judgment ? (
        <>
          {suggest ? <p className="dtc-hint">{t('caseSuggestHint', suggest)}</p> : null}
          <AdviceBlock
            t={t}
            advice={advice}
            cardKind={card.kind}
            precedents={precedents}
            busy={busy}
            closed={isCardClosed(card)}
            autoApplied={isAdviceApplied(card)}
            onAdopt={(index) => props.onAdopt(card, index)}
            onReworked={(note) => props.onReworked(card, note)}
          />
        </>
      ) : (
        <p className="dtc-hint">{advice.summary || t('detailNoSummary')}</p>
      )}
    </Segment>
  )
}
