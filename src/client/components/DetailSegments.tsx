// 详情五段的内容：决定 / 计划 / 执行清单 / 执行 / 验收。
//
// 与详情屏分开，避免单文件越过 300 行预算；这里不拉数据，只渲染传入的案卷。

import { isCardClosed } from '../../shared/state'
import { completionOf, type TodoItem } from '../../shared/todo'
import { isAdviceApplied } from '../advice'
import { authorityLabel, traceShort, verifyKeyOf, waitLabelKey } from '../stage'
import { timeLabel } from '../time'
import type { Card, DetailState, Precedent, Translate } from '../types'
import { AcceptanceBlock } from './AcceptanceBlock'
import { AdviceBlock } from './AdviceBlock'
import { suggestOfAsk } from './ask-suggest'
import { DecisionSegment } from './DecisionSegment'
import { DependencySegment } from './DependencySegment'
import { Segment } from './Segment'
import { TurnBlock } from './TurnBlock'

export interface SegmentsProps {
  t: Translate
  card: Card
  detail: DetailState | null
  precedents: Precedent[]
  busy: boolean
  onAdopt: (card: Card, index: number) => void
  onReworked: (card: Card, note: string) => void
  onRedecide: (card: Card) => void
  /** 一键补验收方式（模板 file/exit/http）。 */
  onFixAcceptance?: (card: Card, acceptance: Array<Record<string, unknown>>) => void
  /** askTimeoutAction=suggest：超 30 分钟显示默认建议。 */
  suggestAsk?: boolean
  /** P2：默认答案自动继续窗口（分钟）。 */
  askTimeoutMinutes?: number
}

export function DetailSegments(props: SegmentsProps) {
  return (
    <>
      <DecisionSegment {...props} />
      <PlanSegment t={props.t} card={props.card} />
      <TodoSegment {...props} />
      <RunSegment {...props} />
      <VerifySegment {...props} />
      <VerdictSegment {...props} />
      <DependencySegment t={props.t} card={props.card} />
    </>
  )
}

/** ② 计划：为什么停在这、影响多大、下一步动作是什么。 */
function PlanSegment({ t, card }: { t: Translate; card: Card }) {
  const wait = waitLabelKey(card)
  const authority = authorityLabel(card)
  const effect = card.advice?.effect
  const action = card.action
  return (
    <Segment title={t('segPlan')}>
      <dl className="dtc-kv">
        {wait ? <Kv label={t('planWait')} value={t(wait)} /> : null}
        {authority && card.authority ? (
          <Kv label={t('planAuthority')} value={t(authority)} />
        ) : null}
        {effect ? <Kv label={t('planEffect')} value={t(`effect_${effect}`)} /> : null}
        {card.advice?.scope ? <Kv label={t('planScope')} value={card.advice.scope} mono /> : null}
        {action ? (
          <Kv
            label={t('planAction')}
            value={`${action.type} · ${Math.round(action.delayMs / 1000)}s · ${action.input}`}
            mono
          />
        ) : null}
        {card.dueAt ? <Kv label={t('planDue')} value={timeLabel(card.dueAt)} /> : null}
        {card.invalidatedReason ? (
          <Kv label={t('planInvalid')} value={card.invalidatedReason} />
        ) : null}
        {!wait && !action && !card.dueAt ? <p className="dtc-hint">{t('planNone')}</p> : null}
      </dl>
    </Segment>
  )
}

const STATUS_CLASS: Record<TodoItem['status'], string> = {
  done: 'is-done',
  doing: 'is-doing',
  pending: 'is-pending',
  blocked: 'is-blocked',
  skipped: 'is-skipped',
}

/** ③ 执行清单：绿点=做完；冻结基线之外的增补项也照实显示。 */
function TodoSegment({ t, card, detail }: SegmentsProps) {
  const todo = detail?.caseInfo?.todo ?? null
  const completion = todo ? completionOf(todo) : null
  return (
    <Segment
      title={t('segTodo')}
      aside={
        completion
          ? t('caseTodoProgress', { done: completion.done, total: completion.total })
          : null
      }
    >
      {todo && todo.items.length ? (
        <ul className="dtc-case-list">
          {todo.items.map((item) => (
            <li key={item.id} className={`dtc-case-item ${STATUS_CLASS[item.status]}`}>
              <span className="dtc-case-dot" aria-hidden="true" />
              <span className="dtc-case-text">{item.text}</span>
              {item.blocker ? <span className="dtc-case-tag">{item.blocker}</span> : null}
              {item.cost?.delta === 'up' ? (
                <span className="dtc-case-tag is-warn">{t('caseCostUp')}</span>
              ) : null}
              {item.evidence ? <span className="dtc-case-evi">{item.evidence.ref}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="dtc-hint">{t('caseTodoEmpty')}</p>
      )}
      {card.invalidatedReason ? (
        <p className="dtc-case-reason">
          {t('caseInvalidReason', { reason: card.invalidatedReason })}
        </p>
      ) : null}
    </Segment>
  )
}

/** ④ 执行：状态机事件流 + 原会话尾部轮次。 */
function RunSegment({ t, card, detail }: SegmentsProps) {
  const events = detail?.caseInfo?.events ?? []
  const turns = detail?.turns ?? []
  return (
    <Segment title={t('segRun')} aside={card.traceId ? `tr-${traceShort(card)}` : null}>
      {events.length ? (
        <ol className="dtc-events">
          {events.map((event) => (
            <li key={event.id} className="dtc-event">
              <span className="dtc-event-time">{timeLabel(event.at)}</span>
              <span className="dtc-mono">
                {event.from} → {event.to}
              </span>
              <span className="dtc-event-actor">
                {event.actor} · {event.authority}
              </span>
              <span className="dtc-event-reason">{event.reason}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="dtc-hint">{t('runNoEvents')}</p>
      )}
      {turns.length ? (
        <div className="dtc-timeline">
          <div className="dtc-hint">{t('runTurns', { n: turns.length })}</div>
          {turns.slice(-3).map((turn, index) => (
            <TurnBlock
              key={`${turn.at ?? ''}-${turn.user.slice(0, 12)}`}
              t={t}
              turn={turn}
              index={Math.max(0, turns.length - 3) + index}
            />
          ))}
        </div>
      ) : null}
    </Segment>
  )
}

/** ⑥ 决定票（delegated 可审计）+ 升级说明：谁批的/依据/置信/策略版本/判例。 */
function VerdictSegment({ t, card, detail }: SegmentsProps) {
  const verdicts = detail?.caseInfo?.verdicts ?? []
  const escalated = card.decision === 'escalated_user'
  return (
    <Segment title={t('caseVerdictTitle')}>
      {escalated ? (
        <div className="dtc-hint">
          <div>{t('caseEscalationTitle')}</div>
          <div>{t('caseEscalationReason', { reason: card.route?.reason ?? '—' })}</div>
          <div>{t('caseEscalationMissing', { missing: card.advice?.question || '—' })}</div>
          <div>
            {t('caseEscalationLeaning', {
              leaning: card.advice ? `${card.advice.verdict} / ${card.advice.summary}` : '—',
            })}
          </div>
        </div>
      ) : null}
      {verdicts.length ? (
        <ul className="dtc-case-list">
          {verdicts.map((verdict) => (
            <li key={verdict.id} className="dtc-case-item is-done">
              <span className="dtc-case-dot" aria-hidden="true" />
              <span className="dtc-mono">{verdict.authority}</span>
              <span className="dtc-case-text">
                {verdict.actorType} · 策略 v{verdict.policyVersion} · 置信{' '}
                {verdict.confidence ?? '—'} · {verdict.rationale || '无依据'}
                {verdict.evidenceRefs.length ? ` · 判例 ${verdict.evidenceRefs.join(', ')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dtc-hint">{t('caseVerdictEmpty')}</p>
      )}
    </Segment>
  )
}

/** ⑤ 验收：判成什么、证据长什么样；无验收方式时给一键补。 */
function VerifySegment({ t, card, detail, onFixAcceptance }: SegmentsProps) {
  const evidence = detail?.caseInfo?.evidence ?? []
  const acceptance = card.acceptance ?? []
  return (
    <Segment title={t('segVerify')} aside={t(verifyKeyOf(card))}>
      <AcceptanceBlock t={t} card={card} {...(onFixAcceptance ? { onFixAcceptance } : {})} />
      {evidence.length ? (
        <ul className="dtc-case-list">
          {evidence.map((record) => (
            <li key={record.id} className={`dtc-case-item ${record.ok ? 'is-done' : 'is-blocked'}`}>
              <span className="dtc-case-dot" aria-hidden="true" />
              <span className="dtc-mono">{record.spec.kind}</span>
              <span className="dtc-case-text">{record.detail}</span>
              <span className="dtc-case-evi">{Math.round(record.durationMs)}ms</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dtc-hint">{t('caseEvidenceEmpty')}</p>
      )}
    </Segment>
  )
}

function Kv({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? 'dtc-mono' : undefined}>{value}</dd>
    </>
  )
}
