// 证据账：一卡一份 JSONL，只增不改；卡上只存 evidenceRef。
//
// 记录进这里之后就是「事实」的落点：面板能点开原文，验收只读不猜。

import fsp from 'node:fs/promises'

import type { CheckContext, CheckSpec, EvidenceLevel, EvidenceRecord } from '../../shared/evidence'
import type { Log } from '../host-api'
import { runCheck } from './checkers'

export interface EvidenceStoreDeps {
  dir: string
  log?: Log
  now?: () => number
  nextId?: () => string
}

export class EvidenceStore {
  readonly dir: string
  readonly #log: Log
  readonly #now: () => number
  readonly #nextId: () => string
  readonly #chains = new Map<string, Promise<void>>()

  constructor(deps: EvidenceStoreDeps) {
    this.dir = deps.dir
    this.#log = deps.log || (() => {})
    this.#now = deps.now ?? Date.now
    this.#nextId = deps.nextId ?? (() => `ev-${Math.random().toString(36).slice(2, 10)}`)
  }

  #file(caseId: string): string {
    return `${this.dir}/${caseId.replace(/[^a-zA-Z0-9_-]/g, '')}.jsonl`
  }

  async append(record: EvidenceRecord): Promise<void> {
    const file = this.#file(record.caseId)
    const prev = this.#chains.get(file) ?? Promise.resolve()
    const runAppend = async () => {
      await fsp.mkdir(this.dir, { recursive: true })
      await fsp.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
    }
    const next = prev.then(runAppend, runAppend)
    this.#chains.set(
      file,
      next.catch(() => {}),
    )
    return next
  }

  async read(caseId: string): Promise<{ records: EvidenceRecord[]; badLines: number }> {
    let raw = ''
    try {
      raw = await fsp.readFile(this.#file(caseId), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { records: [], badLines: 0 }
      throw err
    }
    const records: EvidenceRecord[] = []
    let badLines = 0
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        records.push(JSON.parse(line) as EvidenceRecord)
      } catch {
        badLines += 1
      }
    }
    return { records, badLines }
  }

  /** 跑一组检查并落账；单条失败不影响其余（并行上限 3）。 */
  async check(
    caseId: string,
    specs: readonly CheckSpec[],
    ctx: CheckContext = {},
    meta: { level?: EvidenceLevel; sourceRef?: string; epoch?: number } = {},
  ): Promise<EvidenceRecord[]> {
    const out: EvidenceRecord[] = []
    for (const spec of specs) {
      const started = this.#now()
      const result = await runCheck(spec, ctx)
      const record: EvidenceRecord = {
        id: this.#nextId(),
        caseId,
        at: started,
        spec,
        ...(meta.level ? { level: meta.level } : {}),
        ...(meta.sourceRef ? { sourceRef: meta.sourceRef } : {}),
        ...(meta.epoch !== undefined ? { epoch: meta.epoch } : {}),
        ok: result.ok,
        detail: result.detail,
        durationMs: this.#now() - started,
        ...(result.sha256 ? { sha256: result.sha256 } : {}),
        ...(result.error ? { error: result.error } : {}),
      }
      await this.append(record)
      out.push(record)
      this.#log(`证据：${caseId} ${spec.kind} ${record.ok ? 'ok' : 'fail'} — ${record.detail}`)
    }
    return out
  }
}

export function evidenceDirOf(cardsFile: string): string {
  const dir = cardsFile.replace(/[\\/][^\\/]+$/, '')
  return `${dir}/evidence`
}
