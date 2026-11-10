// Todo 存储：冻结基线、完成率、删基线项必须给理由。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { TodoStore } from '../../src/host/todo/store'
import { completionOf } from '../../src/shared/todo'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-todo-'))
  const events: Array<{ needsReview: boolean; revision: number }> = []
  const store = new TodoStore({
    dir,
    now: () => 1_700_000_000_000,
    onEvent: (event) => events.push({ needsReview: event.needsReview, revision: event.revision }),
  })
  return { dir, store, events }
}

describe('Todo 清单', () => {
  it('冻结前不产生完成率；冻结后按基线算', async () => {
    const { store } = setup()
    await store.apply(
      'c-1',
      [
        { type: 'add', id: 't1', text: '跑测试' },
        { type: 'add', id: 't2', text: '提交' },
      ],
      'executor',
    )
    const open = (await store.read('c-1')) as Awaited<ReturnType<TodoStore['read']>>
    expect(completionOf(open as never)).toBeNull()

    await store.apply('c-1', [{ type: 'update', id: 't1', status: 'done' }], 'executor')
    const frozen = await store.apply(
      'c-1',
      [{ type: 'freeze', baselineIds: ['t1', 't2'] }],
      'decision',
    )
    expect(frozen.frozen).toBe(true)
    expect(completionOf(frozen)).toEqual({ done: 1, total: 2, rate: 0.5 })
  })

  it('冻结后加子项不计入分母', async () => {
    const { store } = setup()
    await store.apply('c-2', [{ type: 'add', id: 't1', text: 'A' }], 'executor')
    await store.apply('c-2', [{ type: 'freeze' }], 'decision')
    await store.apply('c-2', [{ type: 'add', id: 't2', text: '子项', parentId: 't1' }], 'executor')
    const todo = (await store.read('c-2')) as Awaited<ReturnType<TodoStore['read']>>
    expect(completionOf(todo as never)).toEqual({ done: 0, total: 1, rate: 0 })
  })

  it('删基线项不给理由直接拒绝', async () => {
    const { store } = setup()
    await store.apply('c-3', [{ type: 'add', id: 't1', text: '关键步骤' }], 'executor')
    await store.apply('c-3', [{ type: 'freeze' }], 'decision')
    await expect(
      store.apply('c-3', [{ type: 'remove', id: 't1' }], 'executor'),
    ).rejects.toMatchObject({ code: 'TODO_BASELINE_LOCKED' })
  })

  it('删基线项给理由：允许，但标记需复核', async () => {
    const { store, events } = setup()
    await store.apply('c-4', [{ type: 'add', id: 't1', text: '关键步骤' }], 'executor')
    await store.apply('c-4', [{ type: 'freeze' }], 'decision')
    await store.apply(
      'c-4',
      [{ type: 'remove', id: 't1', reason: '方案变更，任务取消' }],
      'executor',
    )
    expect(events.at(-1)?.needsReview).toBe(true)
    const todo = (await store.read('c-4')) as Awaited<ReturnType<TodoStore['read']>>
    expect(todo?.items).toHaveLength(0)
    expect(todo?.frozen).toBe(true)
  })

  it('改不存在的项报 TODO_NOT_FOUND', async () => {
    const { store } = setup()
    await expect(
      store.apply('c-5', [{ type: 'update', id: 'nope', status: 'done' }], 'executor'),
    ).rejects.toMatchObject({ code: 'TODO_NOT_FOUND' })
  })
})
