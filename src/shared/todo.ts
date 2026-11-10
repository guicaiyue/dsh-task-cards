// Todo 清单：执行者维护的结构化进度，验收只把它当「进度」不当「事实」。
//
// 纯类型，不含 IO：store 在 host/todo，事件写进 kernel/journal。

export type TodoStatus = 'pending' | 'doing' | 'done' | 'blocked' | 'skipped'

export type TodoEvidenceKind = 'exit' | 'file' | 'url' | 'diff' | 'text'

export interface TodoEvidence {
  kind: TodoEvidenceKind
  /** 证据引用：命令、路径、URL 或摘要；可点开看原文。 */
  ref: string
}

export interface TodoItem {
  id: string
  text: string
  parentId?: string
  status: TodoStatus
  evidence?: TodoEvidence
  /** 工作量变化：变大要给原因，用来识别「代价变高」。 */
  cost?: { delta: 'same' | 'up' | 'down'; reason?: string }
  blocker?: string
  updatedAt: number
}

export interface TodoList {
  caseId: string
  items: TodoItem[]
  /** 冻结的基线项 id：完成率只按它们算，子项不计入分母。 */
  baselineIds: string[]
  frozen: boolean
  revision: number
  updatedAt: number
}

export type TodoOp =
  | { type: 'add'; id?: string; text: string; parentId?: string }
  | {
      type: 'update'
      id: string
      status?: TodoStatus
      evidence?: TodoEvidence
      cost?: TodoItem['cost']
      blocker?: string
    }
  | { type: 'remove'; id: string; reason?: string }
  | { type: 'freeze'; baselineIds?: string[] }

export interface TodoApplyResult {
  todo: TodoList
  /** 冻结后动了基线项：需要一次复核（M2 才接判定，M1 只标出来）。 */
  needsReview: boolean
}

/** 完成率：只按冻结基线算；未冻结返回 null（不展示假进度）。 */
export function completionOf(todo: TodoList): { done: number; total: number; rate: number } | null {
  if (!todo.frozen || !todo.baselineIds.length) return null
  const baseline = new Set(todo.baselineIds)
  const items = todo.items.filter((item) => baseline.has(item.id))
  const done = items.filter((item) => item.status === 'done' || item.status === 'skipped').length
  return { done, total: items.length, rate: items.length ? done / items.length : 0 }
}
