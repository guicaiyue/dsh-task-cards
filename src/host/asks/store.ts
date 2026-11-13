// ask 通道账本：asks.json。提问是例外通道，不再往 cards.json 里塞卡。

import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { Ask } from '../../shared/ask-contract'
import { JsonDoc } from '../cards/doc'

export interface AsksFile {
  version: number
  asks: Ask[]
  updatedAt: number
}

const empty = (): AsksFile => ({ version: 1, asks: [], updatedAt: 0 })

export class AskStore {
  readonly file: string
  readonly #doc: JsonDoc<AsksFile>

  constructor(file: string) {
    this.file = file
    this.#doc = new JsonDoc<AsksFile>(file, empty)
  }

  async ensureFile(): Promise<void> {
    await this.#doc
      .mutate((current) => ({ value: current, result: undefined }))
      .catch(() => undefined)
  }

  list(): Ask[] {
    return this.#doc.read().asks ?? []
  }

  open(): Ask[] {
    return this.list().filter((ask) => ask.answeredAt === undefined)
  }

  async create(
    input: Omit<Ask, 'id' | 'kind' | 'createdAt' | 'key'> & { id?: string; key?: string },
  ): Promise<{ ask: Ask; duplicate: boolean }> {
    const ask: Ask = {
      ...input,
      kind: 'ask',
      key: input.key ?? '',
      id: input.id ?? `ask-${randomUUID().slice(0, 12)}`,
      createdAt: Date.now(),
    }
    let deduped: Ask | null = null
    await this.#doc.mutate((current) => {
      const asks = current.asks ?? []
      // 同一次工具调用会被 guard 与 pre-execute 各判一次（宿主两条回调），
      // 同会话同去重键还有没答的 ask 时不再新增一条，否则人会被问两遍。
      const same = input.key
        ? asks.find(
            (one) =>
              one.answeredAt === undefined &&
              one.key === input.key &&
              one.sessionId === ask.sessionId,
          )
        : undefined
      if (same) {
        deduped = same
        return { value: current, result: undefined }
      }
      return {
        value: { ...current, asks: [...asks, ask], updatedAt: Date.now() },
        result: undefined,
      }
    })
    const kept = deduped ?? ask
    return { ask: kept, duplicate: kept !== ask }
  }

  async answer(id: string, answer: string, auto = false): Promise<Ask | null> {
    let updated: Ask | null = null
    await this.#doc.mutate((current) => {
      const asks = (current.asks ?? []).map((ask) => {
        if (ask.id !== id || ask.answeredAt !== undefined) return ask
        updated = {
          ...ask,
          answer,
          answeredAt: Date.now(),
          ...(auto ? { autoContinued: true } : {}),
        }
        return updated
      })
      return { value: { ...current, asks, updatedAt: Date.now() }, result: undefined }
    })
    return updated
  }
}
