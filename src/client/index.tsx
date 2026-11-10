// dsh-task-cards —— 客户端半边（DSH 客户端模块）。
//
// 版式按 Executive Dashboard：顶部四个 KPI，下面按「要我决策 / 要我知晓 /
// 自动处理中 / 已结束」分组，密集但一眼能扫。颜色走本页自己的 CSS 变量，
// 深色主题一组覆盖（DSH 在 body[data-ds-dark-theme] 上切）。
//
// 数据全部经宿主路由；卡片是 JSON 的一种展现，JSON 才是源格式。
// 文案字典的值只能是字符串，插值用 {name}。

import {
  TASK_CARD_NODE_KIND,
  TaskCardAnswerNodeView,
  taskCardAnswerDefinition,
} from './chat/taskCardAnswer'
import { GenericTurnTriggerNodeView } from './chat/turnTrigger'
import { Panel } from './components/Panel'
import { PanelIcon } from './components/PanelIcon'
import { NS, PANEL_ID } from './constants'
import type { ClientContext, SlotOwner } from './context'
import { injectPanelCss } from './css'
import { DICT } from './locale'

export const inject = ['slots', 'locale', 'uiWorkspace', 'uiConversation']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const dispose = ctx.locale.register(NS, DICT)
    return typeof dispose === 'function' ? (dispose as () => void) : undefined
  }, 'dsh-task-cards: dictionaries')
  // 任务卡答复在 Chat 里用自己的节点，而不是内置的通用 turn-trigger。
  ctx.effect(() => {
    const dispose = ctx.uiConversation?.events?.register(
      taskCardAnswerDefinition as unknown as Record<string, unknown>,
    )
    return typeof dispose === 'function' ? dispose : undefined
  }, 'dsh-task-cards: chat node definition')

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

  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      { name: 'conversation.chat.node', key: TASK_CARD_NODE_KIND, locale: NS },
      TaskCardAnswerNodeView as unknown as (owner?: SlotOwner) => unknown,
    ),
  )
  // 通用 source-kind 文案：复用内置 turn-trigger 这个 key，替换它的渲染。
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      { name: 'conversation.chat.node', key: 'turn-trigger', locale: NS, priority: -1 },
      GenericTurnTriggerNodeView as unknown as (owner?: SlotOwner) => unknown,
    ),
  )

  // 样式表由宿主以静态资源提供，客户端只挂 <link>（见 client/css.ts）。
  ctx.effect(() => injectPanelCss(), 'dsh-task-cards: panel css')
}
