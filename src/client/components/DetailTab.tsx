// 卡片详情屏：头部（阶段/标题/返回/看会话）+ 卡本身 + 五段内容。
//
// 五段在 DetailSegments 里，这里只负责屏头与空态。

import { stageOf } from '../stage'
import type { Card, CardActionName, DetailState, Precedent, Translate } from '../types'
import { DetailSegments } from './DetailSegments'
import { ModalCardBlock } from './ModalCardBlock'

export interface DetailTabProps {
  t: Translate
  detail: DetailState | null
  card: Card | null
  precedents: Precedent[]
  busy: boolean
  onBack: () => void
  onOpenSession: (sessionId: string) => void
  onOpenSessionTab: (sessionId: string) => void
  onAction: (card: Card, action: CardActionName, option?: string) => void
  onAdopt: (card: Card, index: number) => void
  onReworked: (card: Card, note: string) => void
  onRedecide: (card: Card) => void
}

export function DetailTab(props: DetailTabProps) {
  const { t, detail, card } = props
  if (!card) {
    return (
      <section className="dtc-detail">
        <p className="dtc-empty">{t('detailEmpty')}</p>
        <button type="button" className="dtc-btn" onClick={props.onBack}>
          {t('backToWorkbench')}
        </button>
      </section>
    )
  }
  const stage = stageOf(card)
  return (
    <section className="dtc-detail">
      <div className="dtc-dhead">
        <button type="button" className="dtc-btn" onClick={props.onBack}>
          {t('backToWorkbench')}
        </button>
        <span className={`dtc-stage is-${stage.tone}`}>{t(stage.labelKey)}</span>
        <h2 className="dtc-dtitle">{card.title}</h2>
        <div className="dtc-spacer" />
        {detail?.sessionId ? (
          <>
            <button
              type="button"
              className="dtc-btn"
              onClick={() => props.onOpenSessionTab(detail.sessionId)}
            >
              {t('viewCaseSession')}
            </button>
            <button
              type="button"
              className="dtc-btn is-primary"
              onClick={() => props.onOpenSession(detail.sessionId)}
            >
              {t('openSession')}
            </button>
          </>
        ) : null}
      </div>
      <ModalCardBlock t={t} card={card} busy={props.busy} onAction={props.onAction} />
      <DetailSegments
        t={t}
        card={card}
        detail={detail}
        precedents={props.precedents}
        busy={props.busy}
        onAdopt={props.onAdopt}
        onReworked={props.onReworked}
        onRedecide={props.onRedecide}
      />
    </section>
  )
}
