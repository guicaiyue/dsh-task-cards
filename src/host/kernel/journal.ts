// 事件日志：一卡一文件，append-only JSONL。
//
// 为什么不是往 cards.json 里塞数组：事件只增不改，卡快照才需要改；
// 分开之后 replay 可以校验快照，坏行也只影响一行。

import fsp from 'node:fs/promises'
import path from 'node:path'

import type { CaseEvent } from '../../shared/case'
import { CaseEventSchema } from '../../shared/case-event'

/** 一卡一份事件流；写入按文件串行，避免同一 tick 里交错。 */
export class Journal {
  readonly dir: string
  readonly #chains = new Map<string, Promise<void>>()

  constructor(dir: string) {
    this.dir = dir
  }

  #file(caseId: string): string {
    // caseId 来自内部生成（c-xxx），但仍做一次白名单，防止路径穿越。
    const safe = caseId.replace(/[^a-zA-Z0-9_-]/g, '')
    return path.join(this.dir, `${safe}.jsonl`)
  }

  /** 追加一条事件；同一 case 的写入串行，保证行序 = 发生序。 */
  async append(event: CaseEvent): Promise<void> {
    // 事件是重放的唯一输入：写入前先过契约（traceId 必填）。
    const checked = CaseEventSchema.parse(event) as CaseEvent
    const file = this.#file(event.caseId)
    const prev = this.#chains.get(file) ?? Promise.resolve()
    const run = async () => {
      await fsp.mkdir(this.dir, { recursive: true })
      await fsp.appendFile(file, `${JSON.stringify(checked)}\n`, 'utf8')
    }
    const next = prev.then(run, run)
    this.#chains.set(
      file,
      next.catch(() => {}),
    )
    return next
  }

  /** 最近事件（跨卡）：给记录屏用；最多扫 200 个文件，避免大目录拖慢。 */
  async recent(limit = 100): Promise<{ events: CaseEvent[]; truncated: boolean }> {
    let files: string[] = []
    try {
      files = await fsp.readdir(this.dir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { events: [], truncated: false }
      throw err
    }
    const picked = files.filter((name) => name.endsWith('.jsonl')).slice(-200)
    const all: CaseEvent[] = []
    for (const name of picked) {
      const caseId = name.replace(/\.jsonl$/, '')
      const { events } = await this.read(caseId)
      all.push(...events)
    }
    all.sort((a, b) => b.at - a.at)
    return { events: all.slice(0, limit), truncated: all.length > limit }
  }

  /** 读一张卡的事件流；坏行跳过（不静默丢：调用方拿到 badLines 计数）。 */
  async read(caseId: string): Promise<{ events: CaseEvent[]; badLines: number }> {
    let raw = ''
    try {
      raw = await fsp.readFile(this.#file(caseId), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { events: [], badLines: 0 }
      throw err
    }
    const events: CaseEvent[] = []
    let badLines = 0
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as CaseEvent
        // 历史事件 traceId 为空（审计：78/134）：读取时按迁移口径补，保证时间线可重放。
        if (!parsed.traceId) parsed.traceId = `migrate-${parsed.id}`
        events.push(CaseEventSchema.parse(parsed) as CaseEvent)
      } catch {
        badLines += 1
      }
    }
    return { events, badLines }
  }
}

export const JOURNAL_DIR_NAME = 'journal'
