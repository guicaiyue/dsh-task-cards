// approval-policy.json：审批策略（分级授权），**不是**工具权限 policy.json（host/policy/policy.ts）。

import { existsSync } from 'node:fs'
import { z } from 'zod'

import { JsonDoc } from '../cards/doc'

/** 与工具白名单 POLICY_FILE（policy.json）刻意不同名：两本账不能互相覆盖。 */
export const APPROVAL_POLICY_FILE = 'approval-policy.json'

/** 三档默认规则串：新文件、空文件、以及历史 bug 写出的空档都要能自愈到这份。 */
export const DEFAULT_TIERS = {
  auto: ['effect=read', 'reversible-diagnostic'],
  delegated: [
    'reversible',
    'has-precedent',
    'confidence>=0.8',
    'not-spend',
    'not-destructive',
    'not-external',
  ],
  user: [
    'irreversible',
    'spend',
    'destructive',
    'external',
    'direction-change',
    'low-confidence',
    'conflict',
  ],
}

export const APPROVAL_TIERS = ['auto', 'delegated', 'user'] as const
export type ApprovalTier = (typeof APPROVAL_TIERS)[number]

export const ApprovalPolicySchema = z.object({
  version: z.number().int().default(1),
  tiers: z
    .object({
      /** auto：只读或可逆诊断写，**不要求判例**（§9 裁决）。 */
      auto: z.array(z.string()).default(['effect=read', 'reversible-diagnostic']),
      /** delegated：可逆 + 有判例 + confidence≥0.8 + 非 spend/destructive/external。 */
      delegated: z
        .array(z.string())
        .default([
          'reversible',
          'has-precedent',
          'confidence>=0.8',
          'not-spend',
          'not-destructive',
          'not-external',
        ]),
      /** user 档理由：不可逆 / spend / destructive / external / 方向变更 / 低置信 / 冲突票。 */
      user: z
        .array(z.string())
        .default([
          'irreversible',
          'spend',
          'destructive',
          'external',
          'direction-change',
          'low-confidence',
          'conflict',
        ]),
    })
    .optional(),
  updatedAt: z.number().default(0),
})
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>

export class ApprovalPolicyStore {
  readonly file: string
  readonly #doc: JsonDoc<ApprovalPolicy>

  constructor(file: string) {
    this.file = file
    this.#doc = new JsonDoc(file, () => ApprovalPolicySchema.parse({}))
  }

  /** 首次使用落盘：数据目录里真的出现 approval-policy.json。 */
  async ensureFile(): Promise<void> {
    if (existsSync(this.file)) return
    await this.#doc.mutate((value) => ({
      value: { ...value, updatedAt: Date.now() },
      result: undefined,
    }))
  }

  /**
   * 一次性归一化（boot 调用）：文件里三档全空（历史 bug 写出的旧文件）→ 把默认规则
   * 写回磁盘，而不是只在内存自愈。幂等：写回后再跑不会重复改。
   */
  async normalize(): Promise<boolean> {
    const raw = this.#doc.read() as { tiers?: Partial<typeof DEFAULT_TIERS> }
    const tiers = raw.tiers
    const empty = !tiers?.auto?.length && !tiers?.delegated?.length && !tiers?.user?.length
    if (!empty) return false
    await this.#doc.mutate((value) => ({
      value: { ...value, tiers: DEFAULT_TIERS, updatedAt: Date.now() },
      result: undefined,
    }))
    return true
  }

  read(): ApprovalPolicy & { tiers: typeof DEFAULT_TIERS } {
    const policy = this.#doc.read()
    // 自愈：历史 bug 会把三档写成 []，读的时候按默认规则补齐（不静默丢档）。
    const stored = policy.tiers as Partial<typeof DEFAULT_TIERS> | undefined
    const tiers = {
      auto: stored?.auto?.length ? stored.auto : DEFAULT_TIERS.auto,
      delegated: stored?.delegated?.length ? stored.delegated : DEFAULT_TIERS.delegated,
      user: stored?.user?.length ? stored.user : DEFAULT_TIERS.user,
    }
    return { ...policy, tiers }
  }

  async write(patch: Partial<ApprovalPolicy>): Promise<ApprovalPolicy> {
    const next = ApprovalPolicySchema.parse({
      ...this.read(),
      ...patch,
      updatedAt: Date.now(),
    })
    await this.#doc.mutate(() => ({ value: next, result: undefined }))
    return next
  }
}
