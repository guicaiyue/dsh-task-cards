// 决策代理人的执行记录：每次跑没跑、跑了多久、出了几张票拟、有没有自动执行。
//
// 用户要能一眼看出「决策者到底跑没跑」，所以失败记录把 error 原样放出来。

import { durationLabel, timeLabel } from '../time'
import type { ObserverRecord, Translate } from '../types'

const STATUS_TONE: Record<ObserverRecord['status'], string> = {
  ok: 'is-ok',
  empty: 'is-empty',
  invalid: 'is-invalid',
  error: 'is-error',
}

interface Props {
  t: Translate
  records: ObserverRecord[]
  /** 最多显示几条，其余折成一行「还有 n 条」。 */
  limit?: number
}

export function RecordList({ t, records, limit }: Props) {
  if (!records.length) return <div className="dtc-hint">{t('recordEmpty')}</div>
  const visible = limit && limit > 0 ? records.slice(0, limit) : records
  const hidden = records.length - visible.length
  return (
    <div className="dtc-records">
      {visible.map((record) => (
        <RecordRow key={record.id} t={t} record={record} />
      ))}
      {hidden > 0 ? <div className="dtc-hint">{t('recordMore', { n: hidden })}</div> : null}
    </div>
  )
}

function RecordRow({ t, record }: { t: Translate; record: ObserverRecord }) {
  return (
    <div className="dtc-record">
      <div className="dtc-record-head">
        <span className={`dtc-status ${STATUS_TONE[record.status]}`}>
          {t(`recordStatus_${record.status}`)}
        </span>
        <span>{timeLabel(record.at)}</span>
        {record.model ? <span>{t('recordModel', { model: record.model })}</span> : null}
        {typeof record.durationMs === 'number' ? (
          <span>{t('recordDuration', { duration: durationLabel(record.durationMs) })}</span>
        ) : null}
      </div>
      <div className="dtc-record-counts">
        {t('recordCounts', {
          created: record.cardsCreated ?? 0,
          applied: record.applied ?? 0,
          corrected: record.corrected ?? 0,
        })}
      </div>
      {record.error ? (
        <div className="dtc-pre is-error">{t('recordError', { error: record.error })}</div>
      ) : null}
    </div>
  )
}
