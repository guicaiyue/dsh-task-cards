// 卡片、设置、策略的契约：zod schema 是唯一真源。
//
// 从这里派生：① TypeScript 类型（z.infer）② 运行时校验（parse）③ 观察者提示词里的
// JSON Schema（z.toJSONSchema）④ docs/contracts.md 的人工摘要。
// 客户端只能 `import type`，否则会把 zod 打进浏览器 bundle。

import { z } from 'zod'

import { AUTHORITIES, CARD_STATUSES, DELIVERY_STATES, WAIT_REASONS } from './case-contract'
import {
  ADVICE_VERDICTS,
  ANSWER_VIAS,
  ASK_KINDS,
  CARD_INTERACTIONS,
  CARD_KINDS,
  CARD_SEVERITIES,
  CARD_SOURCES,
  EFFECTS,
  PRECEDENT_OUTCOMES,
} from './contract-enums'
import {
  AcceptanceSchema,
  AdviceSchema,
  AnswerSelectionSchema,
  CardActionSchema,
  CardEventSchema,
  CardOriginSchema,
  PrecedentSchema,
  QuestionSchema,
} from './contract-parts'

export * from './case-contract'
export * from './contract-enums'
export * from './contract-parts'

/** 自动动作：到点后在原会话里补一句话（type 目前只有 prompt/retry 两种写法，行为相同）。 */

/** 回合内闸门命中时记在卡上的凭据：批准后用同样的 key 发一次性放行券。 */
export const CardGateSchema = z.object({
  tool: z.string(),
  effect: z.enum(EFFECTS),
  /** 命中的目标（命令片段 / 被写路径，截断）。 */
  target: z.string().default(''),
  /** sessionId + tool + 参数哈希，一次性放行券的 key。 */
  argHash: z.string(),
  sessionId: z.string().default(''),
  /** 语义身份 key（session+tool+effect+归一化 target）：发券/核销/卡去重共用。 */
  permitKey: z.string().optional(),
  /** 命中的规则名，审计用。 */
  reasons: z.array(z.string()).default([]),
  at: z.number(),
})
export type CardGate = z.infer<typeof CardGateSchema>

/** 决定状态机（唯一权威）：9 个值，全链路只认它；status 降级为派生视图。 */
export const DECISION_STATES = [
  'created',
  'card_ready',
  'pending_secretary',
  'escalated_user',
  'approved',
  'rejected',
  'conflicted',
  'stale',
  'notice',
  'closed',
] as const
export type DecisionState = (typeof DECISION_STATES)[number]
export const DecisionStateSchema = z.enum(DECISION_STATES)

/**
 * 决策代理人只给枚举置信度；阈值判定（§12 的 ≥0.9 / ≥0.8）统一用它换算：
 * high=0.95 / normal=0.8 / low=0.5。
 * normal=0.8 是按 43 张回放定的（若 0.6 则升级率 28.6%，贴近闸门）。
 */
export const CONFIDENCE_VALUE = { high: 0.95, normal: 0.8, low: 0.5 } as const

/** 授权路由（阶段 B）：user / secretary / auto 三档 + 可审计依据。 */
export const RouteSchema = z.object({
  decider: z.enum(['user', 'secretary', 'auto']),
  reason: z.string().default(''),
  /** 命中的策略规则串（policy.json 的 tier 条目）。 */
  threshold: z.array(z.string()).default([]),
  policyVersion: z.number().int().default(1),
  at: z.number(),
})
export type Route = z.infer<typeof RouteSchema>

/** 决定票：谁、以什么授权、在哪个渠道做了决定（一次决定一行，append-only）。 */
export const VerdictSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  decisionSeq: z.number().int().nonnegative(),
  actor: z.string().min(1),
  actorType: z.enum(['user', 'secretary', 'system', 'observer']).default('user'),
  authority: z.enum(AUTHORITIES).default('user'),
  /** 投票时的审批策略版本（审计：谁在哪版策略下投的）。 */
  policyVersion: z.number().int().default(1),
  channel: z.enum(['panel', 'api', 'scheduler', 'system']).default('panel'),
  decision: z.enum(['approve', 'reject', 'answer', 'reopen', 'skip']),
  optionId: z.string().optional(),
  text: z.string().optional(),
  rationale: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidenceRefs: z.array(z.string()).default([]),
  at: z.number(),
})
export type Verdict = z.infer<typeof VerdictSchema>

/** 租约：执行槽同一时刻只属于一个会话；过期即回收。 */
export const LeaseSchema = z.object({
  holder: z.string().min(1),
  expiresAt: z.number(),
  acquiredAt: z.number(),
})

/** 执行尝试：每次派发一行（result 记录回执/失败原因）。 */
export const AttemptSchema = z.object({
  id: z.string().min(1),
  at: z.number(),
  sessionId: z.string().nullable().default(null),
  result: z.enum(['dispatched', 'executed', 'failed', 'timeout']).default('dispatched'),
  detail: z.string().default(''),
})

/** 已批准的计划：批准时冻结，执行/验收都以它为准（plans.json）。 */
export const ApprovedPlanSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  sessionId: z.string().nullable().default(null),
  instruction: z.string().default(''),
  effect: z.enum(EFFECTS).default('read'),
  acceptance: z.array(AcceptanceSchema).default([]),
  executionMode: z.enum(['dispatch', 'manual', 'observe']).default('dispatch'),
  priority: z.number().int().default(0),
  dependsOn: z.array(z.string()).default([]),
  idempotencyKey: z.string().min(1),
  lease: LeaseSchema.nullable().default(null),
  attempts: z.array(AttemptSchema).default([]),
  /** 卡被删除/取消时置真：调度不再消费，重试不再发生。 */
  cancelled: z.boolean().default(false),
  /** 重试耗尽（或永久失败）时置真：plan 停止消费，已升级人工。 */
  failed: z.boolean().default(false),
})
export type ApprovedPlan = z.infer<typeof ApprovedPlanSchema>

/** 验收结论（扩展现有 VerificationOutcome；plans.json 的 outcome 段）。 */
export const OutcomeSchema = z.object({
  planId: z.string().min(1),
  verified: z.enum(['confirmed', 'failed', 'unknown', 'inconclusive']),
  criteriaResults: z.array(z.record(z.string(), z.unknown())).default([]),
  verifier: z.enum(['machine', 'model', 'user']).default('machine'),
  confidence: z.number().min(0).max(1).default(0),
  at: z.number(),
})
export type Outcome = z.infer<typeof OutcomeSchema>

/** 一张卡。detail 之外的字段都有默认值，旧数据也能解析。 */
export const CardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().default(''),
  kind: z.enum(CARD_KINDS).default('info'),
  severity: z.enum(CARD_SEVERITIES).default('normal'),
  status: z.enum(CARD_STATUSES).default('open'),
  /** 决定状态机的权威字段；旧卡为空，由 deriveDecision 推导（status 只是派生视图）。 */
  decision: DecisionStateSchema.optional(),
  /** 授权路由结论（阶段 B）：谁该做这个决定 + 依据 + 策略版本。 */
  route: RouteSchema.optional(),
  /** 阶段 E/G2：卡片级依赖（卡 id，同会话）；批准时映射为 plan.dependsOn。 */
  blockedBy: z.array(z.string()).optional(),
  /** P1/P3：目标标识（一次用户目标一个 goalId，卡与事件都带）。 */
  goalId: z.string().optional(),
  /** P3：目标结果卡（做了什么/产物/验证/风险），验收不靠标题猜。 */
  result: z.boolean().optional(),
  /** P2：提问必须自带默认答案；10 分钟无回复按默认继续。 */
  defaultAnswer: z.string().optional(),
  /** P2：只有「答案不可推断 + 不可逆」才允许无限等。 */
  blocking: z.boolean().optional(),
  /** 阶段 D：三级验收的语义票据（decision/user 级）；system 级不需要。 */
  semantic: z
    .object({
      planId: z.string(),
      verifier: z.enum(['decision', 'user']),
      sourceCardId: z.string(),
      criteria: z.array(z.string()).default([]),
    })
    .optional(),
  action: CardActionSchema.nullable().default(null),
  dueAt: z.number().nullable().default(null),
  source: z.enum(CARD_SOURCES).default('human'),
  interaction: z.enum(CARD_INTERACTIONS).default('reply'),
  question: QuestionSchema.nullable().default(null),
  /** 决策卡的请求类型；非决策卡无意义。 */
  ask: z.enum(ASK_KINDS).default('judgment'),
  origin: CardOriginSchema.nullable().default(null),
  /** 决策 agent 出的票拟；没跑过或没结论时为 null。 */
  advice: AdviceSchema.nullable().default(null),
  /** 全链路 id：事件、执行、验收都挂在它下面。旧卡由迁移补齐。 */
  traceId: z.string().optional(),
  /** CAS 令牌：只随「决定相关」变化递增（状态迁移、票写入、内容变更），已读不算。 */
  decisionSeq: z.number().int().nonnegative().optional(),
  /** 计划走到哪一步；与 status 正交：status 管卡还要不要人管，它管执行到哪。 */
  deliveryState: z.enum(DELIVERY_STATES).optional(),
  /** 停在原地时的原因；不在等待时为 null。 */
  waitReason: z.enum(WAIT_REASONS).nullable().optional(),
  /** 这张卡的决定来自谁：秘书代批 / 用户本人 / 系统。 */
  authority: z.enum(AUTHORITIES).nullable().optional(),
  /** 对账判定失效时的一句话原因；可重开。 */
  invalidatedReason: z.string().nullable().optional(),
  /** 可核验的产物路径：全部已存在时，对账可判定这张「失败/未完成」卡已过期。 */
  artifacts: z.array(z.string()).optional(),
  /** 回合内危险动作闸门命中时的凭据（没有命中为 null）。 */
  gate: CardGateSchema.nullable().optional(),
  /** 多问题卡逐题作答的结果（问题 id → 选择），单题卡可空。 */
  answers: z.array(AnswerSelectionSchema).optional(),
  /** 批准时冻结的验收检查表；未批准/旧卡为空，此时不允许收集证据。 */
  acceptance: z.array(AcceptanceSchema).optional(),
  /** 批准时生成的计划 id（卡级）；证据/清单必须绑定它。 */
  planId: z.string().nullable().optional(),
  /** 证据版本：reopen 时 +1，旧 epoch 的证据只作历史，不再参与验收。 */
  evidenceEpoch: z.number().int().optional(),
  /**
   * 免打扰：建卡时就已经判定「用户在原会话里看过了」，落盘即 acknowledged，不计未读、不亮圆点。
   * 只对观察者写的 info 卡成立——决策卡永远要人回应。
   */
  silent: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number(),
  executedAt: z.number().optional(),
  lastError: z.string().nullable().optional(),
  answer: z.string().optional(),
  answeredAt: z.number().optional(),
  answeredVia: z.enum(ANSWER_VIAS).optional(),
  events: z.array(CardEventSchema).default([]),
})
export type Card = z.infer<typeof CardSchema>

/** 案卷：决定所需的一切输入（决定层唯一入参）。 */
export const CaseFileSchema = z.object({
  card: CardSchema,
  origin: CardOriginSchema.nullable().default(null),
  policy: z.record(z.string(), z.unknown()).default({}),
  precedents: z.array(z.record(z.string(), z.unknown())).default([]),
  capabilities: z.record(z.string(), z.unknown()).default({}),
  sessionState: z.record(z.string(), z.unknown()).default({}),
  acceptanceDraft: z.array(AcceptanceSchema).default([]),
  priorVerdicts: z.array(VerdictSchema).default([]),
})
export type CaseFile = z.infer<typeof CaseFileSchema>

/** 观察者输出的草稿：还没落盘，没有 id/时间戳。 */
export const CardDraftSchema = z.object({
  title: z.string().min(1),
  detail: z.string().default(''),
  kind: z.enum(CARD_KINDS).default('info'),
  severity: z.enum(CARD_SEVERITIES).default('normal'),
  action: CardActionSchema.nullable().default(null),
  /** 分类凭据：一句话说明为什么是这个 kind。 */
  reason: z.string().default(''),
  /** 决策卡的请求类型；观察者可以不给，默认判断。 */
  ask: z.enum(ASK_KINDS).optional(),
  /** 许可卡建议的动作范围（写进 detail 的补充）。 */
  scope: z.string().optional(),
  /** 许可卡建议的 effect。 */
  effect: z.enum(EFFECTS).optional(),
  /** 澄清卡的候选值。 */
  candidates: z.array(z.string()).optional(),
  /** 失败/未完成结论必须给出可核验的产物路径（文件/目录），否则对账判不了。 */
  artifacts: z.array(z.string()).optional(),
  /** 阶段 D：观察者可给出可核验的验收检查（file/exit/http），落库前走服务端白名单。 */
  acceptance: z.array(AcceptanceSchema).optional(),
  /** 阶段 E/G2：这张卡被哪些卡阻塞（卡 id，同会话）；批准时映射成 plan.dependsOn。 */
  blockedBy: z.array(z.string()).optional(),
  /** P1/P3：目标标识与结果卡标记。 */
  goalId: z.string().optional(),
  result: z.boolean().optional(),
  /** P2：默认答案 / 是否允许无限等。 */
  defaultAnswer: z.string().optional(),
  blocking: z.boolean().optional(),
})
export type CardDraft = z.infer<typeof CardDraftSchema>

/** 观察者设置。每次读都合并默认值，所以新增字段不会让旧文件失效。 */

export type { ObserverRecord, Policy, PolicyRole, Settings } from './config-contract'
export {
  POLICY_ROLES,
  PolicyRuleSchema,
  PolicySchema,
  RecordSchema,
  SettingsSchema,
} from './config-contract'
