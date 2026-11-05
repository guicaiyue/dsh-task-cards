// 侧栏图标：一张卡片的样子，跟面板里卡片行的形状呼应。

export function PanelIcon({ size = 18, label = 'Task Cards' }: { size?: number; label?: string }) {
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
    </svg>
  )
}
