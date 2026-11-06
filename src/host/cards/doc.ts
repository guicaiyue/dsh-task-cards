// 本机数据文件的底座：路径、原子写的 JSON 文档、短 id。
//
// 卡、设置、调用记录、判例都用「一个 JSON 文件 + 原子写」。不接 storageDomain：
// 那要 domain spec、zod schema 和 backend route 三样东西，现阶段换来的是零收益的复杂度。
//
// 落点与其它插件一致：$DSH_HOME/dsh-task-cards/*.json

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
export const DATA_DIR = path.join(DSH_HOME, 'dsh-task-cards')
export const DATA_FILE = path.join(DATA_DIR, 'cards.json')
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
export const RECORDS_FILE = path.join(DATA_DIR, 'records.json')
export const PRECEDENTS_FILE = path.join(DATA_DIR, 'precedents.json')

/** 带稳定 code 的业务错误：路由层据此回 400 而不是 500。 */
export class StoreError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** 一个 JSON 文档：懒加载、原子写、写失败抛出去。 */
export class JsonDoc<T> {
  readonly file: string
  #value: T | undefined
  #chain: Promise<void> = Promise.resolve()
  #warning: string | null = null
  #fallback: () => T

  constructor(file: string, fallback: () => T) {
    this.file = file
    this.#fallback = fallback
  }

  get warning(): string | null {
    return this.#warning
  }

  read(): T {
    if (this.#value !== undefined) return this.#value
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      this.#value = JSON.parse(raw) as T
    } catch (err) {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.#value = this.#fallback()
      } else {
        // 坏文件不静默丢：挪到旁边，界面能看到 warning。
        this.#warning = `数据文件无法解析，已挪到旁边：${(err as Error)?.message || String(err)}`
        this.#value = this.#fallback()
        try {
          fs.renameSync(this.file, `${this.file}.bad-${Date.now()}`)
        } catch {
          /* 挪不动也不挡开工 */
        }
      }
    }
    return this.#value as T
  }

  write(value: T): Promise<void> {
    this.#value = value
    const run = async () => {
      await fsp.mkdir(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
      await fsp.rename(tmp, this.file)
    }
    const next = this.#chain.then(run, run)
    this.#chain = next.catch(() => {})
    return next
  }
}

let counter = 0

/** 短 id：前缀 + 时间 base36 + 自增 + 随机尾巴，够本机唯一定位。 */
export function nextId(prefix: string): string {
  counter = (counter + 1) % 1e6
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
