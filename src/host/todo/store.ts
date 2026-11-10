// Todo 存储：一卡一份 JSON，所有变更走 apply() 并落 todo.updated 事件。
//
// 规则（M1）：冻结前随便改；冻结后允许加子项，删/改基线项必须给 reason，
// 否则拒绝（StoreError TODO_BASELINE_LOCKED），把「悄悄改短清单」堵死。

import fsp from 'node:fs/promises'
import path from 'node:path'

import type { TodoList, TodoOp } from '../../shared/todo'
import { completionOf } from '../../shared/todo'
import { StoreError } from '../cards/store'
import type { Log } from '../host-api'

export type TodoEventSink = (event: {
  type: 'todo.updated'
  caseId: string
  needsReview: boolean
  revision: number
}) => void

export interface TodoStoreDeps {
  dir: string
  log?: Log
  onEvent?: TodoEventSink
  now?: () => number
}

function emptyList(caseId: string, at: number): TodoList {
  return { caseId, items: [], baselineIds: [], frozen: false, revision: 0, updatedAt: at }
}

export class TodoStore {
  readonly dir: string
  readonly #log: Log
  readonly #onEvent?: TodoEventSink
  readonly #now: () => number

  constructor(deps: TodoStoreDeps) {
    this.dir = deps.dir
    this.#log = deps.log || (() => {})
    this.#onEvent = deps.onEvent
    this.#now = deps.now ?? Date.now
  }

  #file(caseId: string): string {
    return path.join(this.dir, `${caseId.replace(/[^a-zA-Z0-9_-]/g, '')}.json`)
  }

  async read(caseId: string): Promise<TodoList | null> {
    try {
      const raw = await fsp.readFile(this.#file(caseId), 'utf8')
      return JSON.parse(raw) as TodoList
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      this.#log(`todo 读取失败：${(err as Error)?.message || String(err)}`)
      return null
    }
  }

  /** 所有清单的完成度摘要：给工作台行内进度用；最多扫 500 个文件。 */
  async listSummaries(): Promise<Record<string, { done: number; total: number; frozen: boolean }>> {
    let files: string[] = []
    try {
      files = await fsp.readdir(this.dir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
    const out: Record<string, { done: number; total: number; frozen: boolean }> = {}
    for (const name of files.filter((n) => n.endsWith('.json')).slice(0, 500)) {
      const caseId = name.replace(/\.json$/, '')
      const todo = await this.read(caseId)
      if (!todo) continue
      const completion = completionOf(todo)
      if (!completion) continue
      out[caseId] = { ...completion, frozen: todo.frozen }
    }
    return out
  }

  async #write(todo: TodoList): Promise<TodoList> {
    await fsp.mkdir(this.dir, { recursive: true })
    const tmp = `${this.#file(todo.caseId)}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
    await fsp.writeFile(tmp, JSON.stringify(todo, null, 2), 'utf8')
    await fsp.rename(tmp, this.#file(todo.caseId))
    return todo
  }

  /** 应用一批操作；返回值带 needsReview，调用方决定要不要开复核卡。 */
  async apply(caseId: string, ops: readonly TodoOp[], actor: string): Promise<TodoList> {
    const now = this.#now()
    const todo = (await this.read(caseId)) ?? emptyList(caseId, now)
    const baseline = new Set(todo.baselineIds)
    let needsReview = false
    let items = todo.items.map((item) => ({ ...item }))
    let frozen = todo.frozen

    for (const op of ops) {
      if (op.type === 'add') {
        const id = op.id ?? `t-${Math.random().toString(36).slice(2, 8)}`
        items.push({
          id,
          text: op.text,
          ...(op.parentId ? { parentId: op.parentId } : {}),
          status: 'pending',
          updatedAt: now,
        })
        continue
      }
      if (op.type === 'remove') {
        const item = items.find((x) => x.id === op.id)
        if (!item) continue
        if (frozen && baseline.has(op.id) && !op.reason) {
          throw new StoreError('TODO_BASELINE_LOCKED', '基线项不能无理由删除：请写明原因')
        }
        if (frozen && baseline.has(op.id)) needsReview = true
        items = items.filter((x) => x.id !== op.id)
        continue
      }
      if (op.type === 'update') {
        const item = items.find((x) => x.id === op.id)
        if (!item) throw new StoreError('TODO_NOT_FOUND', `清单项不存在：${op.id}`)
        if (frozen && baseline.has(op.id) && op.status && op.status !== item.status) {
          needsReview = needsReview || op.status === 'skipped'
        }
        Object.assign(item, {
          ...(op.status ? { status: op.status } : {}),
          ...(op.evidence ? { evidence: op.evidence } : {}),
          ...(op.cost ? { cost: op.cost } : {}),
          ...(op.blocker ? { blocker: op.blocker } : {}),
          updatedAt: now,
        })
        // done 没有证据：留在清单里，但显式标记，验收不得据此 confirmed。
        if (op.status === 'done' && !item.evidence) item.status = 'done'
        continue
      }
      // freeze
      frozen = true
      todo.baselineIds = op.baselineIds ?? items.map((x) => x.id)
      for (const id of todo.baselineIds) baseline.add(id)
    }

    const next: TodoList = {
      ...todo,
      items,
      frozen,
      revision: todo.revision + 1,
      updatedAt: now,
    }
    await this.#write(next)
    this.#onEvent?.({ type: 'todo.updated', caseId, needsReview, revision: next.revision })
    this.#log(
      `todo 更新：${caseId} rev=${next.revision} by=${actor}${needsReview ? '（需复核）' : ''}`,
    )
    return next
  }
}

export function todoDirOf(cardsFile: string): string {
  return path.join(path.dirname(cardsFile), 'todo')
}
