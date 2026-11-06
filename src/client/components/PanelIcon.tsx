// 侧栏图标：一张卡片的样子，跟面板里卡片行的形状呼应。
// 有未读的知晓卡时在右上角点一个小圆点（18px 图标放不下数字）。
// 圆点靠自己的轻量轮询更新——面板没打开时也要能发现新通知。

import { useUnreadInfo } from '../hooks/useUnreadInfo'

export function PanelIcon({ size = 18, label = 'Task Cards' }: { size?: number; label?: string }) {
  const unread = useUnreadInfo()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <rect x={4} y={4} width={16} height={16} rx={3} />
      <path d="M8 9.5h8" />
      <path d="M8 13h5" />
      <path d="M8 16.5h3" />
      {unread > 0 ? (
        <>
          <circle className="dtc-unread-dot-ring" cx={19.8} cy={4.2} r={4.1} stroke="none" />
          <circle className="dtc-unread-dot" cx={19.8} cy={4.2} r={3} stroke="none" />
        </>
      ) : null}
    </svg>
  )
}
