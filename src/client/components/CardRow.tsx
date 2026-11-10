// 一行卡片：阶段/等待/影响/会话/序号在标题上方，授权与 trace 在底部。
// 同一行既能在会话分组里出现，也能平铺使用，所以只接最小 props。

import { isCardClosed } from '../../shared/state'
import { useReadOnScreen } from '../hooks/useReadOnScreen'
import { authorityLabel, type StageView, stageOf, traceShort, waitLabelKey } from '../stage'
import { relativeKey, timeLabel } from '../time'
import type { AnswerSelection, Card, CardProgress, Translate } from '../types'
import { AdviceChip } from './AdviceChip'
import { CardActions, type CardHandlers } from './CardActions'
import { QuestionOptions } from './QuestionOptions'

interface Props extends CardHandlers {
  t: Translate
  card: Card
  busy: boolean
  onAnswer: (card: Card, option: string, answers?: AnswerSelection[]) => void
  onRedecide: (card: Card) => void
  progress?: CardProgress
  sessionLabel?: string
  seq?: { index: number; total: number }
}

export function CardRow(props: Props) {
  const { t, card, busy, onAction, onDetail } = props
  const closed = isCardClosed(card)
  const stage = stageOf(card)
  // 观察者写的 info 卡是通知：在视口里停留满 2 秒才算看过，不再要人点一下。
  const rowRef = useReadOnScreen<HTMLDivElement>(() => onAction(card, 'acknowledge'), {
    enabled:
      card.kind === 'info' && card.source === 'agent' && card.status === 'open' && !card.silent,
    busy,
  })
  return (
    <div ref={rowRef} className={`dtc-card is-${stage.tone}${closed ? ' is-closed' : ''}`}>
      <div className="dtc-rail" />
      <div className="dtc-main">
        <RowChips {...props} stage={stage} />
        <div className="dtc-text">{card.title}</div>
        {card.detail ? <div className="dtc-detail">{card.detail}</div> : null}
        <RowMiddle {...props} closed={closed} />
        <RowFoot t={t} card={card} closed={closed} />
      </div>
      <CardActions
        t={t}
        card={card}
        busy={busy}
        closed={closed}
        onAction={onAction}
        onDetail={onDetail}
      />
    </div>
  )
}

/** 标题上方那排徽标：阶段、等待原因、影响、会话、序号、进度。 */
function RowChips(props: Props & { stage: StageView }) {
  const { t, card, stage, sessionLabel, seq, progress } = props
  const wait = waitLabelKey(card)
  return (
    <div className="dtc-rowchips">
      <span className={`dtc-stage is-${stage.tone}`}>{t(stage.labelKey)}</span>
      {wait ? <span className="dtc-wait">{t(wait)}</span> : null}
      {card.advice?.effect ? (
        <span className="dtc-tag">{t(`effect_${card.advice.effect}`)}</span>
      ) : null}
      {sessionLabel ? <span className="dtc-mono">{sessionLabel}</span> : null}
      {seq ? (
        <span className="dtc-mono">
          #{seq.index}/{seq.total}
        </span>
      ) : null}
      {card.deliveryState === 'invalidated' ? (
        <span className="dtc-tag is-neutral">{t('invalidChip')}</span>
      ) : null}
      {progress ? (
        <span className="dtc-chip is-progress">
          {t('progressChip', { done: progress.done, total: progress.total })}
        </span>
      ) : null}
    </div>
  )
}

/** 标题下面：答复类型、票拟、阻塞式提问。 */
function RowMiddle(props: Props & { closed: boolean }) {
  const { t, card, busy, closed, onAnswer, onRedecide } = props
  const ask = card.ask || card.advice?.ask || 'judgment'
  return (
    <>
      {card.kind === 'decision' && !closed ? (
        <span className="dtc-chip">{t(`ask_${ask}`)}</span>
      ) : null}
      {card.kind === 'decision' && (card.advice || !closed) ? (
        <AdviceChip t={t} card={card} busy={busy} onRedecide={onRedecide} />
      ) : null}
      {card.interaction === 'question' && !closed ? (
        <QuestionOptions t={t} card={card} busy={busy} onAnswer={onAnswer} />
      ) : null}
    </>
  )
}

/** 相对时间（刚刚 / n 分钟前 / n 小时前 / n 天前），超过 7 天回落到日期。 */
function relativeLabel(t: Translate, at: number): string {
  const rel = relativeKey(at)
  return rel ? t(rel.key, { n: rel.n }) : timeLabel(at)
}

/** 底栏：谁批的、trace、时间、来源、免打扰与上次失败。 */
function RowFoot({ t, card, closed }: { t: Translate; card: Card; closed: boolean }) {
  const authority = authorityLabel(card)
  return (
    <div className="dtc-card-foot">
      {authority && card.authority ? (
        <span className="dtc-authority">{t('approvedBy', { who: t(authority) })}</span>
      ) : null}
      {card.traceId ? <span className="dtc-trace">tr-{traceShort(card)}</span> : null}
      <span>{relativeLabel(t, closed ? card.updatedAt : card.createdAt)}</span>
      <span>{card.source === 'agent' ? t('fromAgent') : t('fromHuman')}</span>
      {card.silent ? <span className="dtc-chip is-silent">{t('silentChip')}</span> : null}
      {card.lastError ? (
        <span className="dtc-chip is-fail">
          {t('failReason', { reason: card.lastError.slice(0, 48) })}
        </span>
      ) : null}
    </div>
  )
}
