// 面板里的时间只显示到分钟：卡片是按会话回合结的，秒级没有意义。

export function timeLabel(at: number | null | undefined): string {
  if (typeof at !== 'number' || !Number.isFinite(at)) return ''
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
