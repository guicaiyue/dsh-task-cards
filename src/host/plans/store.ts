// plans.json：plan / lease / attempt / result / outcome 的账本（与 cards.json 快照分离）。

import { existsSync } from 'node:fs'

import type { ApprovedPlan, Outcome, Verdict } from '../../shared/contract'
import { JsonDoc } from '../cards/doc'

interface PlansFile {
  version: number
  plans: ApprovedPlan[]
  outcomes: Outcome[]
  verdicts: Verdict[]
  updatedAt: number
}

const empty = (): PlansFile => ({ version: 1, plans: [], outcomes: [], verdicts: [], updatedAt: 0 })

/** 租约回收时钟偏移容差：过期后再等 5s 才回收，避免时钟抖动误杀。 */
export const LEASE_RECLAIM_SKEW_MS = 5_000

export class PlansStore {
  readonly file: string
  readonly #doc: JsonDoc<PlansFile>

  constructor(file: string) {
    this.file = file
    this.#doc = new JsonDoc(file, empty)
  }

  /** 首次使用落盘：数据目录里真的出现 plans.json。 */
  async ensureFile(): Promise<void> {
    if (existsSync(this.file)) return
    await this.#doc.mutate((value) => ({
      value: { ...value, updatedAt: Date.now() },
      result: undefined,
    }))
  }

  list(): ApprovedPlan[] {
    // 旧文件（C 之前）可能缺 attempts/dependsOn/acceptance/lease 段：逐条归一化，
    // 否则调度 tick 读 `.length/.some` 会抛 TypeError。
    return (this.#doc.read().plans ?? []).map((plan) => ({
      ...plan,
      acceptance: plan.acceptance ?? [],
      dependsOn: plan.dependsOn ?? [],
      attempts: plan.attempts ?? [],
      lease: plan.lease ?? null,
    }))
  }

  /**
   * 启动归一化（boot 调用）：缺段的旧 plans.json 补空数组合集并写回磁盘。
   * 幂等：四段齐全时不写。
   */
  async normalize(): Promise<boolean> {
    const raw = new JsonDoc<Partial<PlansFile>>(this.file, empty).read()
    const hasAll =
      Array.isArray(raw.plans) && Array.isArray(raw.outcomes) && Array.isArray(raw.verdicts)
    const plansNeedFix =
      !Array.isArray(raw.plans) ||
      (raw.plans ?? []).some(
        (plan) =>
          !Array.isArray(plan.attempts) ||
          !Array.isArray(plan.dependsOn) ||
          !Array.isArray(plan.acceptance),
      )
    if (hasAll && !plansNeedFix) return false
    await this.#doc.mutate((current) => ({
      value: {
        version: current.version ?? 1,
        plans: (current.plans ?? []).map((plan) => ({
          ...plan,
          acceptance: plan.acceptance ?? [],
          dependsOn: plan.dependsOn ?? [],
          attempts: plan.attempts ?? [],
          lease: plan.lease ?? null,
        })),
        outcomes: current.outcomes ?? [],
        verdicts: current.verdicts ?? [],
        updatedAt: Date.now(),
      },
      result: undefined,
    }))
    return true
  }

  get(id: string): ApprovedPlan | null {
    return this.list().find((plan) => plan.id === id) ?? null
  }

  async upsert(plan: ApprovedPlan): Promise<ApprovedPlan> {
    await this.#doc.mutate((current) => ({
      value: {
        ...current,
        plans: [...current.plans.filter((item) => item.id !== plan.id), plan],
        updatedAt: Date.now(),
      },
      result: undefined,
    }))
    return plan
  }

  async recordOutcome(outcome: Outcome): Promise<Outcome> {
    await this.#doc.mutate((current) => ({
      value: {
        ...current,
        outcomes: [...(current.outcomes ?? []), outcome],
        updatedAt: Date.now(),
      },
      result: undefined,
    }))
    return outcome
  }

  /** 卡不存在/永久失败：取消计划（调度不再消费，重试不再发生）。 */
  async cancel(planId: string, reason: string): Promise<void> {
    await this.#patchPlan(planId, { cancelled: true, lease: null })
  }

  /** 重试耗尽：标 failed（保留 attempts 供审计），并清租约。 */
  async markFailed(planId: string, reason: string): Promise<void> {
    await this.#patchPlan(planId, { failed: true, lease: null })
  }

  async #patchPlan(planId: string, patch: Partial<ApprovedPlan>): Promise<void> {
    await this.#doc.mutate((current) => ({
      value: {
        ...current,
        plans: (current.plans ?? []).map((plan) =>
          plan.id === planId ? { ...plan, ...patch } : plan,
        ),
        updatedAt: Date.now(),
      },
      result: undefined,
    }))
  }

  byCard(cardId: string): ApprovedPlan | null {
    return this.list().find((plan) => plan.cardId === cardId) ?? null
  }

  byIdempotencyKey(key: string): ApprovedPlan | null {
    return this.list().find((plan) => plan.idempotencyKey === key) ?? null
  }

  /** 派发前持久化租约（plans.json 是唯一租约账，重启可恢复）。 */
  async setLease(planId: string, lease: ApprovedPlan['lease']): Promise<void> {
    await this.#doc.mutate((current) => ({
      value: {
        ...current,
        plans: (current.plans ?? []).map((plan) =>
          plan.id === planId ? { ...plan, lease } : plan,
        ),
        updatedAt: Date.now(),
      },
      result: undefined,
    }))
  }

  /** 派发后写 attempt（幂等：attempt.id = dispatchKey）。 */
  async recordAttempt(planId: string, attempt: ApprovedPlan['attempts'][number]): Promise<void> {
    await this.#doc.mutate((current) => ({
      value: {
        ...current,
        plans: (current.plans ?? []).map((plan) =>
          plan.id === planId
            ? {
                ...plan,
                attempts: [...plan.attempts.filter((item) => item.id !== attempt.id), attempt],
              }
            : plan,
        ),
        updatedAt: Date.now(),
      },
      result: undefined,
    }))
  }

  /** 回收过期租约（>ttl）：清空 lease，返回 planId 列表供调度重排。 */
  async recoverStaleLeases(now: number, _ttlMs?: number): Promise<string[]> {
    // 单 TTL 语义：expiresAt 已经是绝对时间，再等一个 SKEW 就回收（不是 2×TTL）。
    const stale = this.list()
      .filter((plan) => plan.lease !== null && plan.lease.expiresAt + LEASE_RECLAIM_SKEW_MS < now)
      .map((plan) => plan.id)
    if (!stale.length) return []
    await this.#doc.mutate((current) => ({
      value: {
        ...current,
        plans: (current.plans ?? []).map((plan) =>
          stale.includes(plan.id) ? { ...plan, lease: null } : plan,
        ),
        updatedAt: now,
      },
      result: undefined,
    }))
    return stale
  }

  get warning(): string | null {
    return this.#doc.warning
  }

  async recordVerdict(verdict: Verdict): Promise<Verdict> {
    await this.#doc.mutate((current) => ({
      value: {
        ...current,
        verdicts: [...(current.verdicts ?? []), verdict],
        updatedAt: Date.now(),
      },
      result: undefined,
    }))
    return verdict
  }

  /** 不走缓存读：外部/测试刚写入 plans.json 后立即可见（/case 用）。 */
  verdictsFresh(cardId: string): Verdict[] {
    const fresh = new JsonDoc<PlansFile>(this.file, empty)
    return (fresh.read().verdicts ?? []).filter((item) => item.cardId === cardId)
  }

  verdictsOf(cardId: string): Verdict[] {
    return (this.#doc.read().verdicts ?? []).filter((item) => item.cardId === cardId)
  }

  async outcomes(planId: string): Promise<Outcome[]> {
    return (this.#doc.read().outcomes ?? []).filter((item) => item.planId === planId)
  }
}
