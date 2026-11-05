// dsh-task-cards —— 客户端半边（DSH 客户端模块）。
//
// 版式按 Executive Dashboard：顶部四个 KPI，下面按「要我决策 / 要我知晓 /
// 自动处理中 / 已结束」分组，密集但一眼能扫。颜色走本页自己的 CSS 变量，
// 深色主题一组覆盖（DSH 在 body[data-ds-dark-theme] 上切）。
//
// 数据全部经宿主路由；卡片是 JSON 的一种展现，JSON 才是源格式。
// 文案字典的值只能是字符串，插值用 {name}。

import { Panel } from './components/Panel'
import { PanelIcon } from './components/PanelIcon'
import { NS, PANEL_ID } from './constants'
import type { ClientContext } from './context'
import { DICT } from './locale'
import { injectStyles } from './styles'

export const inject = ['slots', 'locale', 'uiWorkspace']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const dispose = ctx.locale.register(NS, DICT)
    return typeof dispose === 'function' ? (dispose as () => void) : undefined
  }, 'dsh-task-cards: dictionaries')
  const t = ctx.locale.bind(NS)

  // 侧栏入口：点一下打开同名主面板（id 与 key 必须一致）。
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 18, locale: NS, label: () => t('nav') },
      (owner?: { size?: number }) => <PanelIcon size={owner?.size ?? 18} />,
    ),
  )

  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ t, uiWorkspace: ctx.uiWorkspace }),
      },
      Panel as unknown as (owner?: { size?: number }) => unknown,
    ),
  )

  ctx.effect(() => injectStyles(), 'dsh-task-cards: styles')
}
