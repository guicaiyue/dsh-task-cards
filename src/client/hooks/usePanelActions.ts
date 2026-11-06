// 面板动作：手写、卡片操作、采纳票拟、返工标记、重出票拟、刷新。
// 集中在一处，组件只管渲染。

import { useCallback } from 'react'

import { redecide } from '../api'
import type { ActionResult, Card, CardActionName, DetailApi } from '../types'

interface Options {
  /** 提交当前输入框内容；返回 true 表示已创建，面板据此清空草稿。 */
  submit: () => Promise<boolean>
  act: (card: Card, action: CardActionName, option?: string) => Promise<ActionResult>
  refresh: () => void
  detail: Pick<DetailApi, 'replaceCard' | 'closeDetail'>
  run: <T>(job: () => Promise<T>) => Promise<T | undefined>
  /** 独立的请求（重出票拟）失败时，把原因写进面板错误条。 */
  reportError: (message: string) => void
}

export interface PanelActions {
  onAdd: () => void
  onAction: (card: Card, action: CardActionName, option?: string) => Promise<void>
  onAnswer: (card: Card, option: string) => void
  onAdopt: (card: Card, index: number) => void
  onReworked: (card: Card, note: string) => void
  onRedecide: (card: Card) => void
  onRefresh: () => void
}

/** 卡片动作的一个便捷入口：不关心返回，失败由 act 内部写进错误条。 */
type OnAction = (card: Card, action: CardActionName, option?: string) => Promise<void>

function delegate(onAction: OnAction, card: Card, action: CardActionName, option?: string): void {
  onAction(card, action, option).catch(() => {})
}

export function usePanelActions({
  submit,
  act,
  refresh,
  detail,
  run,
  reportError,
}: Options): PanelActions {
  const onAdd = useCallback(() => {
    run(async () => {
      await submit()
    }).catch(() => {})
  }, [submit, run])

  const onAction = useCallback(
    async (card: Card, action: CardActionName, option?: string) => {
      await run(async () => {
        const result = await act(card, action, option)
        if (action === 'delete') detail.closeDetail()
        else if (result?.card) detail.replaceCard(result.card)
      })
    },
    [act, detail, run],
  )

  const onAnswer = useCallback(
    (card: Card, option: string) => delegate(onAction, card, 'answer', option),
    [onAction],
  )

  /** 采纳第 index 个方案：回给原会话，卡随之结束。 */
  const onAdopt = useCallback(
    (card: Card, index: number) => delegate(onAction, card, 'adopt', String(index)),
    [onAction],
  )

  /** 这个决定后来返工了：只写判例库，不改卡的状态。 */
  const onReworked = useCallback(
    (card: Card, note: string) => delegate(onAction, card, 'mark-reworked', note),
    [onAction],
  )

  /** 重出票拟：让决策代理人再跑一次，结果异步写回卡上，随后刷新列表。 */
  const onRedecide = useCallback(
    (card: Card) => {
      run(async () => {
        await redecide(card.id)
        refresh()
      }).catch((err) => reportError((err as Error).message || String(err)))
    },
    [run, refresh, reportError],
  )

  return { onAdd, onAction, onAnswer, onAdopt, onReworked, onRedecide, onRefresh: refresh }
}
