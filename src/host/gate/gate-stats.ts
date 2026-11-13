// 闸门的「零静默」账本：每次拒绝都要有去向。
//
// 为什么需要它：拒绝本身是有副作用的动作（动作没发生），如果对应的 ask 没落地
// （写盘失败、依赖没接、被吞），执行方以为「已经登记给人了」，人却永远看不到——
// 这类静默在日志里只是一行 warn，没人会去翻。这里把「拒绝次数」和「ask 的三种去向」
// 分别计数，`unaccounted = denied - (created + deduped + failed)` 就是静默条数。
//
// 计数不追求精确到毫秒：它是度量，不是业务状态；崩溃丢几次计数不影响判断。

import os from 'node:os'
import path from 'node:path'

import { DATA_DIR, JsonDoc } from '../cards/doc'

export interface GateStats {
  /** 判定为要拦（= 会 deny）的次数。 */
  denied: number
  /** 落地成了 ask 条目。 */
  askCreated: number
  /** 同一次调用重复判定，复用已有 ask。 */
  askDeduped: number
  /** 写 ask 失败（= 静默风险）。 */
  askFailed: number
  updatedAt: number
}

export type GateOutcome = 'denied' | 'askCreated' | 'askDeduped' | 'askFailed'

const EMPTY = (): GateStats => ({
  denied: 0,
  askCreated: 0,
  askDeduped: 0,
  askFailed: 0,
  updatedAt: 0,
})

export function unaccountedOf(stats: GateStats): number {
  return Math.max(0, stats.denied - (stats.askCreated + stats.askDeduped + stats.askFailed))
}

export class GateStatsStore {
  readonly file: string
  readonly #doc: JsonDoc<GateStats>

  constructor(file: string = path.join(DATA_DIR, 'gate-stats.json')) {
    this.file = file
    this.#doc = new JsonDoc<GateStats>(file, EMPTY)
  }

  read(): GateStats {
    const value = this.#doc.read()
    return { ...EMPTY(), ...value }
  }

  /** 计数是度量，不阻塞判定路径：写入失败只丢计数，不影响拦截本身。 */
  bump(kind: GateOutcome, by = 1): void {
    void this.#doc
      .mutate((current) => {
        const base = { ...EMPTY(), ...current }
        return {
          value: { ...base, [kind]: base[kind] + by, updatedAt: Date.now() },
          result: undefined,
        }
      })
      .catch(() => undefined)
  }
}

let shared: GateStatsStore | null = null

/**
 * 全进程一份（闸门在多个会话间共享同一个账本）。
 *
 * 测试里必须落到临时目录：闸门的用例会真的走 deny 分支，不隔离的话
 * 每跑一次 `pnpm verify` 都会往**真实账本**里加几条 denied，度量立刻变成噪声
 * （2026-11-12 实测：一次 verify 后 denied=8 / askCreated=2，全部来自测试）。
 */
export function gateStats(): GateStatsStore {
  shared ??=
    process.env.VITEST || process.env.NODE_ENV === 'test'
      ? new GateStatsStore(path.join(os.tmpdir(), 'dtc-gate-stats-test.json'))
      : new GateStatsStore()
  return shared
}
