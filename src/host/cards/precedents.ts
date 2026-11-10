// 判例库：用户过去的同类决定。
//
// 返工过的（outcome=reworked）不进决策输入，那条规则在 decision/input.ts 执行；
// 这里只负责存。落盘同样走 ./doc.ts 的 JsonDoc（原子写）。

import type { Precedent, PrecedentOutcome } from '../../shared/contract'
import { JsonDoc, nextId, PRECEDENTS_FILE, StoreError } from './doc'

const PRECEDENT_LIMIT = 500
const PRECEDENT_OUTCOMES = new Set<string>(['unknown', 'valid', 'reworked'])

export interface PrecedentInput {
  cardId?: string
  title?: string
  question?: string
  choice?: string
  outcome?: PrecedentOutcome
  note?: string
  keywords?: string[]
}

function normalizeOutcome(value: unknown): PrecedentOutcome {
  return typeof value === 'string' && PRECEDENT_OUTCOMES.has(value)
    ? (value as PrecedentOutcome)
    : 'unknown'
}

export class PrecedentStore {
  #doc: JsonDoc<Precedent[]>

  constructor(file: string = PRECEDENTS_FILE) {
    this.#doc = new JsonDoc<Precedent[]>(file, () => [])
  }

  get file(): string {
    return this.#doc.file
  }

  get warning(): string | null {
    return this.#doc.warning
  }

  /** 倒序（最新在前），上限 500 条。 */
  list(limit: number = PRECEDENT_LIMIT): Precedent[] {
    const rows = this.#rows()
    const cap = Math.max(0, Math.min(limit, PRECEDENT_LIMIT))
    return rows.slice(0, cap).map((row) => ({ ...row }))
  }

  /** 某张卡最近的一条判例（同一张卡可能被处理多次，以最新一条为准）。 */
  latestForCard(cardId: string): Precedent | undefined {
    const found = this.#rows().find((row) => row.cardId === cardId)
    return found ? { ...found } : undefined
  }

  async add(input: PrecedentInput): Promise<Precedent> {
    const entry: Precedent = {
      id: nextId('P'),
      at: Date.now(),
      cardId: String(input.cardId ?? ''),
      title: String(input.title ?? '').slice(0, 200),
      question: String(input.question ?? '').slice(0, 2000),
      choice: String(input.choice ?? '').slice(0, 2000),
      outcome: normalizeOutcome(input.outcome),
      note: String(input.note ?? '').slice(0, 1000),
      keywords: (input.keywords ?? []).map(String).filter(Boolean).slice(0, 12),
    }
    // mutate 内部先 readFresh：热重载的两个实例不能各拿缓存整份覆盖。
    return this.#doc.mutate((current) => {
      const rows = Array.isArray(current) ? current : []
      rows.unshift(entry)
      if (rows.length > PRECEDENT_LIMIT) rows.length = PRECEDENT_LIMIT
      return { value: rows, result: { ...entry } }
    })
  }

  /** 只改 outcome / note：判例的其余内容是对过去事实的记录，不允许回改。 */
  async update(
    id: string,
    changes: Pick<Partial<Precedent>, 'outcome' | 'note'>,
  ): Promise<Precedent> {
    return this.#doc.mutate((current) => {
      const rows = Array.isArray(current) ? current : []
      const row = rows.find((item) => item.id === id)
      if (!row) throw new StoreError('NOT_FOUND', '这条判例不存在')
      if (changes.outcome !== undefined) row.outcome = normalizeOutcome(changes.outcome)
      if (changes.note !== undefined) row.note = String(changes.note).slice(0, 1000)
      return { value: rows, result: { ...row } }
    })
  }

  /** 读也走 readFresh：另一个实例刚写入的判例要能被这次决策读到。 */
  #rows(): Precedent[] {
    const all = this.#doc.readFresh()
    return Array.isArray(all) ? all : []
  }
}
