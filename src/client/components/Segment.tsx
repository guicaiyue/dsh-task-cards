// 详情里的通用分段壳（标题 + 右侧摘要 + 正文）。

import type React from 'react'

export function Segment({
  title,
  aside,
  children,
}: {
  title: string
  aside?: string | null
  children: React.ReactNode
}) {
  return (
    <section className="dtc-seg">
      <div className="dtc-seg-head">
        <span className="dtc-seg-title">{title}</span>
        {aside ? <span className="dtc-seg-aside">{aside}</span> : null}
      </div>
      <div className="dtc-seg-body">{children}</div>
    </section>
  )
}
