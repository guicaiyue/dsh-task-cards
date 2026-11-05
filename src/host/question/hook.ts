// 包一层 userQuestions.ask / askTimed：每个提问先记一张卡，再照常走原逻辑。
//
// 用服务方法而不是事件，是因为 waterfall 事件按 agent scope 过滤分发，
// 插件注册的监听收不到；而提问一定要在会话里发生，跟页面开没开无关。

import type { Log, UserQuestionRequest, UserQuestionsLike } from '../host-api'
import {
  forgetPendingQuestion,
  type PendingEntry,
  pendingQuestions,
  registerPendingQuestion,
} from './pending'

const QUESTION_PATCH = Symbol.for('dsh-task-cards.userQuestions.patch')

type AskFn = (request: UserQuestionRequest, ...rest: unknown[]) => Promise<unknown>

interface PatchSlot {
  handlers: Set<(request: UserQuestionRequest) => void>
  answeredHandlers: Set<(request: UserQuestionRequest, answer: unknown) => void>
  original: { ask: AskFn; askTimed: AskFn | null }
}

/** 服务对象上挂的补丁槽：卸载时按它还原。 */
type PatchedService = UserQuestionsLike & { [QUESTION_PATCH]?: PatchSlot }

export type QuestionHandler = (request: UserQuestionRequest) => void
export type AnsweredHandler = (request: UserQuestionRequest, answer: unknown) => void

export function installQuestionHook(
  runtime: { userQuestions?: UserQuestionsLike } | null,
  log: Log,
  handler: QuestionHandler,
  answeredHandler?: AnsweredHandler,
): () => void {
  try {
    return installQuestionHookInner(runtime, log, handler, answeredHandler)
  } catch (err) {
    log(`提问建卡安装失败：${(err as Error)?.message || String(err)}`)
    return () => {}
  }
}

function installQuestionHookInner(
  runtime: { userQuestions?: UserQuestionsLike } | null,
  log: Log,
  handler: QuestionHandler,
  answeredHandler?: AnsweredHandler,
): () => void {
  const service = runtime?.userQuestions as PatchedService | undefined
  if (!service || typeof service.ask !== 'function') {
    log('提问建卡：宿主没有 userQuestions.ask，跳过')
    return () => {}
  }
  let slot = service[QUESTION_PATCH]
  if (!slot) {
    const original = {
      ask: service.ask as AskFn,
      askTimed: typeof service.askTimed === 'function' ? (service.askTimed as AskFn) : null,
    }
    slot = { handlers: new Set(), answeredHandlers: new Set(), original }
    service[QUESTION_PATCH] = slot
    const patchSlot: PatchSlot = slot
    const wrap = (name: 'ask' | 'askTimed'): AskFn =>
      async function patched(this: unknown, request: UserQuestionRequest, ...rest: unknown[]) {
        for (const onRequest of patchSlot.handlers) {
          try {
            onRequest(request)
          } catch {
            /* 建卡失败不能挡住提问本身 */
          }
        }
        if (
          name !== 'ask' ||
          !request ||
          !Array.isArray(request.questions) ||
          !request.questions.length
        ) {
          const originalFn = patchSlot.original[name]
          if (!originalFn) throw new Error(`userQuestions.${name} 不可用`)
          return originalFn.apply(this, [request, ...rest])
        }
        // 两条路并行：聊天里的提问 UI 照常出现，卡片也能作答，谁先答谁生效。
        const originalFn = patchSlot.original[name]
        if (!originalFn) throw new Error(`userQuestions.${name} 不可用`)
        const original = originalFn.apply(this, [request, ...rest])
        // 卡片先答时原提问会一直挂着：把它的失败吞掉，别冒未处理的拒绝。
        original.catch(() => {})
        const entry: PendingEntry = registerPendingQuestion(request)
        try {
          const winner = await Promise.race([
            original.then((answer) => ({ from: 'chat' as const, answer })),
            entry.promise.then((answer) => ({ from: 'card' as const, answer })),
          ])
          if (winner.from === 'chat') {
            for (const onAnswered of patchSlot.answeredHandlers) {
              try {
                onAnswered(request, winner.answer)
              } catch {
                /* 回写失败不影响回答本身 */
              }
            }
          }
          return winner.answer
        } finally {
          forgetPendingQuestion(entry)
        }
      }
    service.ask = wrap('ask')
    if (slot.original.askTimed) service.askTimed = wrap('askTimed')
  }
  slot.handlers.add(handler)
  if (typeof answeredHandler === 'function') slot.answeredHandlers.add(answeredHandler)
  return () => {
    const current = service[QUESTION_PATCH]
    if (!current) return
    current.handlers.delete(handler)
    if (typeof answeredHandler === 'function') current.answeredHandlers.delete(answeredHandler)
    if (current.handlers.size === 0) {
      // 插件卸载：把服务还原，别留一个包了两层的壳
      service.ask = current.original.ask
      if (current.original.askTimed) service.askTimed = current.original.askTimed
      delete service[QUESTION_PATCH]
      // 还挂着的提问也要收尾，避免 promise 永远悬着
      for (const [key, entry] of pendingQuestions) {
        if (entry.request) pendingQuestions.delete(key)
      }
    }
  }
}
