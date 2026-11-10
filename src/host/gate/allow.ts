// 一次性放行券：按**语义身份**（session + tool + effect + 归一化 target）存，不按参数哈希。
//
// 历史 bug：早期用「整个 arguments 哈希」当 key，agent 重试时 description/timeoutMs
// 变化 → key 变 → 批准后仍被拦、同一命令出现多个 hash/多张卡。现在 key 由
// permitKey() **一个函数**算出，发券/核销/卡去重三处共用，杜绝构造不一致。

const ALLOW_TTL_MS = 10 * 60 * 1000
/** 宽限期：券用掉后 N 毫秒内仍视为允许（同一次调用可能被判两遍、或被重新派发）。 */
export const ALLOW_GRACE_MS = 5_000
const ALLOW_KEY = Symbol.for('dsh-task-cards.gate-allow')

interface AllowEntry {
  until: number
  usedAt?: number
  /** 发券时对应的卡 id：日志/审计不依赖去重登记表，避免并发期 card=(未知)。 */
  cardId?: string
}

/** 测试钩子：清空全局券（多个测试文件同 worker 共享 globalThis 时必须隔离）。 */

function allowMap(): Map<string, AllowEntry> {
  const bag = globalThis as unknown as Record<symbol, Map<string, AllowEntry> | undefined>
  const existing = bag[ALLOW_KEY]
  if (existing) return existing
  const created = new Map<string, AllowEntry>()
  bag[ALLOW_KEY] = created
  return created
}

/** 目标归一化：折叠空白、去首尾、去尾部斜杠（引号/前缀差异留给调用方命令本身）。 */
export function normalizeTarget(target: string): string {
  return target.replace(/\s+/g, ' ').trim().replace(/\/+$/, '')
}

export interface PermitIdentity {
  sessionId: string
  tool: string
  effect: string
  target: string
}

/** 券 key = 语义身份。发券、核销、卡去重都只调这一个函数。 */
export function permitKey(identity: PermitIdentity): string {
  return [
    identity.sessionId,
    identity.tool,
    identity.effect,
    normalizeTarget(identity.target),
  ].join('\u0000')
}

export function issueAllow(key: string, now: number, cardId?: string): void {
  allowMap().set(key, { until: now + ALLOW_TTL_MS, ...(cardId ? { cardId } : {}) })
}

/** 券上记录的卡 id（发券时写入，先于任何登记表变动）。 */
export function cardIdOfAllow(key: string): string | null {
  return allowMap().get(key)?.cardId ?? null
}

/** 一次性（带宽限）：第一次核销记 usedAt；宽限期内再判仍允许；宽限过期才真正失效。 */
export function consumeAllow(key: string, now: number, graceMs: number = ALLOW_GRACE_MS): boolean {
  const entry = allowMap().get(key)
  if (!entry) return false
  if (entry.until < now) {
    allowMap().delete(key)
    return false
  }
  if (entry.usedAt !== undefined) {
    // graceMs<=0 = 严格一次性（测试/极端场景）：用掉即失效。
    if (graceMs > 0 && now - entry.usedAt < graceMs) return true
    allowMap().delete(key)
    return false
  }
  entry.usedAt = now
  return true
}

/** 券是否已用掉（宽限计时起点）；没有券或已过期返回 null。 */
export function usedAtOf(key: string): number | null {
  return allowMap().get(key)?.usedAt ?? null
}

export function revokeAllow(key: string): void {
  allowMap().delete(key)
}

export function clearAllows(): void {
  allowMap().clear()
}
