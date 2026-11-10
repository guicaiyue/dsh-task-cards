// 一次执行只判一次：宿主先跑 pre-execute waterfall、allow 之后再跑 guard，
// 两条路径拿到的是同一个 exec。不缓存结论的话：第一条消费券放行、第二条再判一次
// （券已核销）→ deny + 多建一张卡，用户体感「批了还是没执行」。

import { asRecord, asString, type ToolExecutionLike } from '../host-api'

const JUDGED_KEY = Symbol.for('dsh-task-cards.gate-judged')
const JUDGED_TTL_MS = 60_000

interface JudgedEntry {
  deny: string | undefined
}

interface JudgedStore {
  byExec: WeakMap<object, JudgedEntry>
  byCallId: Map<string, JudgedEntry & { at: number }>
}

function judgedStore(): JudgedStore {
  const bag = globalThis as unknown as Record<symbol, JudgedStore | undefined>
  const existing = bag[JUDGED_KEY]
  if (existing) return existing
  const created: JudgedStore = { byExec: new WeakMap(), byCallId: new Map() }
  bag[JUDGED_KEY] = created
  return created
}

function callIdOf(exec: ToolExecutionLike): string | null {
  const value = asRecord(exec)
  return asString(value.callId) || asString(value.token) || asString(value.id) || null
}

/** 读「这次执行是否已经判过」：pre-execute/guard 两条路径只看一次结论。 */
export function readJudged(exec: ToolExecutionLike): { hit: boolean; deny?: string } {
  const store = judgedStore()
  const byExec = store.byExec.get(exec as unknown as object)
  if (byExec) return { hit: true, deny: byExec.deny }
  const callId = callIdOf(exec)
  const byId = callId ? store.byCallId.get(callId) : undefined
  if (byId && Date.now() - byId.at < JUDGED_TTL_MS) return { hit: true, deny: byId.deny }
  return { hit: false }
}

/** 记下这次执行的结论（deny 为空 = 放行），避免第二条路径重复消费券/建卡。 */
export function writeJudged(exec: ToolExecutionLike, deny: string | undefined): void {
  const store = judgedStore()
  const entry: JudgedEntry = { deny }
  store.byExec.set(exec as unknown as object, entry)
  const callId = callIdOf(exec)
  if (callId) store.byCallId.set(callId, { ...entry, at: Date.now() })
  if (store.byCallId.size > 200) {
    const now = Date.now()
    for (const [key, value] of store.byCallId) {
      if (now - value.at >= JUDGED_TTL_MS) store.byCallId.delete(key)
    }
  }
}
