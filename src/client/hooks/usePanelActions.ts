// 面板动作：手写、卡片操作、回答、刷新。集中在一处，组件只管渲染。

import { useCallback } from 'react'

import type { ActionResult, Card, CardActionName, DetailApi } from '../types'

interface Options {
  /** 提交当前输入框内容；返回 true 表示已创建，面板据此清空草稿。 */
  submit: () => Promise<boolean>
  act: (card: Card, action: CardActionName, option?: string) => Promise<ActionResult>
  refresh: () => void
  detail: Pick<DetailApi, 'replaceCard' | 'closeDetail'>
  run: <T>(job: () => Promise<T>) => Promise<T | undefined>
}

export interface PanelActions {
  onAdd: () => void
  onAction: (card: Card, action: CardActionName, option?: string) => Promise<void>
  onAnswer: (card: Card, option: string) => void
  onRefresh: () => void
}

export function usePanelActions({ submit, act, refresh, detail, run }: Options): PanelActions {
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
    (card: Card, option: string) => {
      onAction(card, 'answer', option).catch(() => {})
    },
    [onAction],
  )

  return { onAdd, onAction, onAnswer, onRefresh: refresh }
}
