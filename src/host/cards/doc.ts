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
  #tmpSeq = 0
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

  /**
   * 从磁盘重读一份，丢掉内存缓存。
   *
   * 为什么需要：插件热重载会同时存在「旧实例」和「新实例」，两边各有一份
   * 懒加载缓存；追加型写入（记录、判例）如果直接用旧缓存整份覆盖，会把
   * 对方刚写进去的条目丢掉。追加前先重读，能把这种回退收窄成一个极短窗口。
   */
  readFresh(): T {
    this.#value = undefined
    this.#warning = null
    return this.read()
  }

  write(value: T): Promise<void> {
    return this.#enqueue(() => withFileLock(this.file, () => this.#writeRaw(value)))
  }

  /**
   * 读改写收口：永远先 readFresh 拿磁盘上最新的内容，再应用变更并原子写回。
   *
   * 追加 / 局部修改型数据（卡、判例、记录）必须走这里。插件热重载会同时存在
   * 新旧两个实例，各自持有懒加载缓存；用缓存整份覆盖会把对方刚写进去的条目
   * 吞掉（真实事故：records.json 内容变旧、卡片被旧实例覆盖）。
   *
   * fn 只能「读 current → 返回新的 value 和调用方要的结果」，不要在 fn 里写盘。
   */
  mutate<R>(fn: (current: T) => { value: T; result: R }): Promise<R> {
    return this.#enqueue(() =>
      withFileLock(this.file, async () => {
        const { value, result } = fn(this.readFresh())
        await this.#writeRaw(value)
        return result
      }),
    )
  }

  /** 所有写入串成一条链：同实例内不并发写同一个文件，也不在链内再排队（会自锁）。 */
  #enqueue<R>(job: () => Promise<R>): Promise<R> {
    const next = this.#chain.then(job, job)
    this.#chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  async #writeRaw(value: T): Promise<void> {
    this.#value = value
    await fsp.mkdir(path.dirname(this.file), { recursive: true })
    // 临时文件名必须唯一：同一份文件可能被两个 Store 实例写（测试与多入口都会），
    // 共用一个 .tmp 会在并发 rename 时互相踩掉（ENOENT）。
    const tmp = `${this.file}.tmp-${process.pid}-${++this.#tmpSeq}-${Math.random().toString(36).slice(2, 8)}`
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await fsp.rename(tmp, this.file)
  }
}

/**
 * 进程级 per-file 读改写锁。热重载会在同一进程留下新旧两个 Store 实例，
 * 各线程/请求并发 create/patch 时，只有「先 readFresh 再写」还不够——两个实例会
 * 同时读到同一份旧内容、再各自整份写回，后写的把前一个的条目吞掉。这把锁把
 * 同一文件名的 mutate/write 串起来；跨进程不加锁（本机单实例插件，够用）。
 */
const FILE_LOCK_KEY = Symbol.for('dsh-task-cards.file-lock')

function fileLocks(): Map<string, Promise<void>> {
  const bag = globalThis as unknown as Record<symbol, Map<string, Promise<void>> | undefined>
  const existing = bag[FILE_LOCK_KEY]
  if (existing) return existing
  const created = new Map<string, Promise<void>>()
  bag[FILE_LOCK_KEY] = created
  return created
}

const LOCK_WARN_MS = 2_000

async function withFileLock<R>(file: string, job: () => Promise<R>): Promise<R> {
  // key 用解析后的绝对路径：不同写法（相对/带 ./）指向同一文件时必须共用一把锁。
  const key = path.resolve(file)
  const locks = fileLocks()
  const startedAt = Date.now()
  const prev = locks.get(key) ?? Promise.resolve()
  const run = prev.then(job, job)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  locks.set(key, tail)
  const waited = Date.now() - startedAt
  if (waited > LOCK_WARN_MS) {
    console.warn(`[dsh-task-cards] 文件写锁等待过久：${key} 等了 ${waited}ms，前面有慢写或死锁`)
  }
  try {
    return await run
  } finally {
    if (locks.get(key) === tail) locks.delete(key)
  }
}

let counter = 0

/** 短 id：前缀 + 时间 base36 + 自增 + 随机尾巴，够本机唯一定位。 */
export function nextId(prefix: string): string {
  counter = (counter + 1) % 1e6
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
