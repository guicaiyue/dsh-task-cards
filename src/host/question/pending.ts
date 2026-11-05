// 挂起的提问表：卡片作答时按问题 id 找到这次 ask_user_question，直接回填原生结果。

import type { UserQuestionRequest } from '../host-api'
import { asRecord } from '../host-api'

export interface PendingQuestionItem {
  id: string
  question: unknown
  multiSelect: boolean
}

export interface PendingEntry {
  key: string
  items: PendingQuestionItem[]
  sessionId?: string
  request: UserQuestionRequest
  promise: Promise<{ answers: Array<{ id: string; selected: string[] }> }>
  resolve: (value: { answers: Array<{ id: string; selected: string[] }> }) => void
  reject: (error: Error) => void
  cleanup?: () => void
}

export const pendingQuestions = new Map<string, PendingEntry>()

/** 把一次提问挂进待答表：卡片作答时按问题 id 找到它。 */
export function registerPendingQuestion(request: UserQuestionRequest): PendingEntry {
  const items = (request.questions || []).map((item) => {
    const raw = asRecord(item)
    return {
      id: String(raw.id ?? ''),
      question: raw.question,
      multiSelect: raw.multiSelect === true,
    }
  })
  const agent = asRecord(request.agent)
  const session = asRecord(agent.session)
  const sessionId = String(agent.sessionId ?? session.id ?? agent.id ?? '') || undefined
  const key = items.map((item) => item.id).join(',')
  let resolveFn!: PendingEntry['resolve']
  let rejectFn!: PendingEntry['reject']
  const promise = new Promise<{ answers: Array<{ id: string; selected: string[] }> }>(
    (resolve, reject) => {
      resolveFn = resolve
      rejectFn = reject
    },
  )
  promise.catch(() => {})
  const entry: PendingEntry = {
    key,
    items,
    sessionId,
    request,
    promise,
    resolve: resolveFn,
    reject: rejectFn,
  }
  pendingQuestions.set(key, entry)
  const signal = request.signal
  if (signal) {
    const onAbort = () => {
      if (pendingQuestions.get(key) === entry) pendingQuestions.delete(key)
      entry.reject(Object.assign(new Error('question aborted'), { code: 'ASK_ABORTED' }))
    }
    if (signal.aborted) onAbort()
    else {
      signal.addEventListener('abort', onAbort, { once: true })
      entry.cleanup = () => signal.removeEventListener('abort', onAbort)
    }
  }
  return entry
}

/** 提问结束后把挂起项摘掉（不管谁答的）。 */
export function forgetPendingQuestion(entry: PendingEntry | null | undefined): void {
  if (!entry) return
  if (pendingQuestions.get(entry.key) === entry) pendingQuestions.delete(entry.key)
  try {
    entry.cleanup?.()
  } catch {
    /* 已经清理过 */
  }
}

/** 用卡片上的选择回答一次挂起的提问；答到就返回 true。 */
export function answerPendingQuestion(
  sessionId: string | undefined,
  answers: Array<{ id: string; selected: string[] }>,
): boolean {
  for (const [key, entry] of pendingQuestions) {
    const idsMatch = entry.items.every((item) => answers.some((answer) => answer.id === item.id))
    if (!idsMatch) continue
    // 会话对得上，或至少有一边没记到会话 id 时才认：避免答到别的会话的同名问题上。
    if (entry.sessionId && sessionId && entry.sessionId !== sessionId) continue
    pendingQuestions.delete(key)
    try {
      entry.cleanup?.()
    } catch {
      /* 已经清理过 */
    }
    entry.resolve({ answers })
    return true
  }
  return false
}
