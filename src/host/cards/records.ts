// 观察者 / 决策每次运行的调用记录：追加型数据，写入口只有 add。
//
// 落盘同样走 ./doc.ts 的 JsonDoc；写入必须走 mutate（先 readFresh 再改），
// 否则热重载的两个实例会各拿一份缓存整份覆盖，条目互相吞掉（真实事故）。

import type { ObserverRecord } from '../../shared/contract'
import { JsonDoc, nextId, RECORDS_FILE } from './doc'

const RECORD_LIMIT = 200

export class RecordStore {
  #doc: JsonDoc<ObserverRecord[]>

  constructor(file: string = RECORDS_FILE) {
    this.#doc = new JsonDoc<ObserverRecord[]>(file, () => [])
  }

  get file(): string {
    return this.#doc.file
  }

  list(limit: number = RECORD_LIMIT): ObserverRecord[] {
    const all = this.#doc.readFresh()
    return (Array.isArray(all) ? all : []).slice(0, Math.max(1, limit))
  }

  /** 按 phase 过滤（面板的决策记录只看 decision）：倒序，最多 limit 条。 */
  listByPhase(phase: ObserverRecord['phase'], limit: number = RECORD_LIMIT): ObserverRecord[] {
    const all = this.#doc.readFresh()
    return (Array.isArray(all) ? all : [])
      .filter((record) => (record.phase || 'observer') === phase)
      .slice(0, Math.max(1, limit))
      .map((record) => ({ ...record }))
  }

  async add(
    record: Omit<ObserverRecord, 'id' | 'at'> & Record<string, unknown>,
  ): Promise<ObserverRecord> {
    // mutate 内部先 readFresh：热重载后旧实例的缓存可能落后，整份覆盖会丢条目。
    return this.#doc.mutate((current) => {
      const list = Array.isArray(current) ? current : []
      const entry = { id: nextId('r'), at: Date.now(), ...record } as ObserverRecord
      list.unshift(entry)
      if (list.length > RECORD_LIMIT) list.length = RECORD_LIMIT
      return { value: list, result: entry }
    })
  }
}
