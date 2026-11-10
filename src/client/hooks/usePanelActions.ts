// 面板动作：手写、卡片操作、采纳票拟、返工标记、重出票拟、刷新。
// 集中在一处，组件只管渲染。

import { useCallback, useMemo } from 'react'

import { redecide } from '../api'
import type { ActionNotice, ActionOutcome, Card, CardActionName, DetailApi } from '../types'

interface Options {
  /** 提交当前输入框内容；返回 true 表示已创建，面板据此清空草稿。 */
  submit: () => Promise<boolean>
  act: (
    card: Card,
    action: CardActionName,
    option?: string,
    answers?: Array<{ id: string; selected: string[] }>,
  ) => Promise<ActionOutcome>
  refresh: () => void
  detail: Pick<DetailApi, 'replaceCard' | 'closeDetail'>
  run: <T>(job: () => Promise<T>) => Promise<T | undefined>
  /** 独立的请求（重出票拟）失败时，把原因写进面板错误条。 */
  reportError: (message: string) => void
  /** 批准的结果要显式告诉用户：推回原会话了，还是只结束了卡。 */
  notify: (notice: ActionNotice | null) => void
}

export interface PanelActions {
  onAdd: () => void
  onAction: (
    card: Card,
    action: CardActionName,
    option?: string,
    answers?: Array<{ id: string; selected: string[] }>,
  ) => Promise<void>
  onAnswer: (
    card: Card,
    option: string,
    answers?: Array<{ id: string; selected: string[] }>,
  ) => void
  onAdopt: (card: Card, index: number) => void
  onReworked: (card: Card, note: string) => void
  onRedecide: (card: Card) => void
  onRefresh: () => void
}

/** 卡片动作的一个便捷入口：不关心返回，失败由 act 内部写进错误条。 */
type OnAction = (
  card: Card,
  action: CardActionName,
  option?: string,
  answers?: Array<{ id: string; selected: string[] }>,
) => Promise<void>

function delegate(
  onAction: OnAction,
  card: Card,
  action: CardActionName,
  option?: string,
  answers?: Array<{ id: string; selected: string[] }>,
): void {
  onAction(card, action, option, answers).catch(() => {})
}

export function usePanelActions({
  submit,
  act,
  refresh,
  detail,
  run,
  reportError,
  notify,
}: Options): PanelActions {
  const onAdd = useCallback(() => {
    run(async () => {
      await submit()
    }).catch(() => {})
  }, [submit, run])

  const onAction = useCallback(
    async (
      card: Card,
      action: CardActionName,
      option?: string,
      answers?: Array<{ id: string; selected: string[] }>,
    ) => {
      notify(null)
      await run(async () => {
        const result = await act(card, action, option, answers)
        if (action === 'delete') detail.closeDetail()
        else if (result?.card) detail.replaceCard(result.card)
        if ((action === 'approve' || action === 'deny') && result) {
          notify({ pushed: result.pushed !== false, reason: result.reason || '' })
        }
      })
    },
    [act, detail, run, notify],
  )

  const delegates = useMemo(
    () => ({
      onAnswer: (card: Card, option: string, answers?: Array<{ id: string; selected: string[] }>) =>
        delegate(onAction, card, 'answer', option, answers),
      onAdopt: (card: Card, index: number) => delegate(onAction, card, 'adopt', String(index)),
      onReworked: (card: Card, note: string) => delegate(onAction, card, 'mark-reworked', note),
      onRedecide: (card: Card) => {
        run(async () => {
          await redecide(card.id)
          await refresh()
        }).catch((err: unknown) => reportError((err as Error)?.message || String(err)))
      },
    }),
    [onAction, run, refresh, reportError],
  )
  return { onAdd, onAction, ...delegates, onRefresh: refresh }
}
