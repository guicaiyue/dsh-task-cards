// 面板里的时间只显示到分钟：卡片是按会话回合结的，秒级没有意义。

export function timeLabel(at: number | null | undefined): string {
  if (typeof at !== 'number' || !Number.isFinite(at)) return ''
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 卡片底栏的相对时间：用文案键 + 数字，交给 t() 拼；超过 7 天回 null 用日期。 */
export function relativeKey(
  at: number | null | undefined,
  now = Date.now(),
): { key: string; n: number } | null {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  const minutes = Math.floor(Math.max(0, now - at) / 60000)
  if (minutes < 1) return { key: 'timeJustNow', n: 0 }
  if (minutes < 60) return { key: 'timeMinutes', n: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { key: 'timeHours', n: hours }
  const days = Math.floor(hours / 24)
  if (days < 7) return { key: 'timeDays', n: days }
  return null
}

/** 一次调用的耗时：不到 1 秒写毫秒，否则写秒（一位小数）。 */
export function durationLabel(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
