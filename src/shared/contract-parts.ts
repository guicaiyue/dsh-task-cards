// 卡片子结构（选项 / 问题 / 票拟 / 判例 / 验收检查）：被 CardSchema 组合。
//
// 单独成文件是为了 contract.ts 的 300 行预算；枚举来自 contract-enums，避免循环导入。

import { z } from 'zod'
import type { Effect } from './contract-enums'
import {
  ADVICE_VERDICTS,
  ANSWER_VIAS,
  ASK_KINDS,
  CARD_ACTION_TYPES,
  CARD_KINDS,
  CARD_SEVERITIES,
  EFFECTS,
  ORDER_SOURCES,
  PRECEDENT_OUTCOMES,
} from './contract-enums'

export const EvidenceLevelSchema = z.enum(['E1', 'E2', 'E3', 'E4'])

/** 批准时冻结的验收检查：路由只能按这张表收集证据，不能再传任意命令。 */
export const AcceptanceSchema = z.object({
  id: z.string(),
  /** 谁来判这条：system（机器）/ decision（语义）/ user（重大）。 */
  verifier: z.enum(['system', 'decision', 'user']).optional(),
  level: EvidenceLevelSchema.default('E2'),
  spec: z.union([
    z.object({ kind: z.literal('exit'), cmd: z.string(), expect: z.number().default(0) }),
    z.object({ kind: z.literal('file'), path: z.string(), expect: z.enum(['exists', 'absent']) }),
    z.object({ kind: z.literal('http'), url: z.string(), expect: z.number() }),
  ]),
})
export type Acceptance = z.infer<typeof AcceptanceSchema>

export const CardActionSchema = z.object({
  type: z.enum(CARD_ACTION_TYPES),
  delayMs: z.number().int().nonnegative(),
  input: z.string().min(1),
  sessionId: z.string().min(1).optional(),
})
export type CardAction = z.infer<typeof CardActionSchema>

/** 阻塞式提问的一个问题：面板把 options 直接当回答入口。 */
export const QuestionItemSchema = z.object({
  id: z.string(),
  question: z.string(),
  multiSelect: z.boolean().optional(),
  options: z.array(z.string()).optional(),
})
export type QuestionItem = z.infer<typeof QuestionItemSchema>

/** 逐题作答的一项：问题 id + 选中的选项（多选时多个）。 */
export const AnswerSelectionSchema = z.object({
  id: z.string(),
  selected: z.array(z.string()).default([]),
})
export type AnswerSelection = z.infer<typeof AnswerSelectionSchema>

export const QuestionSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().optional(),
  callId: z.string().optional(),
  items: z.array(QuestionItemSchema),
})
export type Question = z.infer<typeof QuestionSchema>

export const CardOriginSchema = z.object({
  sessionId: z.string().optional(),
  turn: z.number().optional(),
  observerSessionId: z.string().optional(),
  /** 观察者为什么判成这个 kind（一句话，给决策代理人当依据）。 */
  reason: z.string().default(''),
  /** 触发这张卡的最近一条真人原话（脱敏、截断）。 */
  userQuote: z.string().optional(),
  /** 真正触发这张卡的输入：可能是真人，也可能是系统代发的卡片答复。 */
  triggerText: z.string().optional(),
  userQuoteAt: z.number().optional(),
  /** 触发来源：真人 / 任务卡系统代发 / 其它系统注入。 */
  sourceKind: z.enum(ORDER_SOURCES).optional(),
  /** 系统代发时来自哪张卡。 */
  sourceCardId: z.string().optional(),
  /** 触发时面板打开的卡（用于解析「这张卡」）。 */
  uiCardId: z.string().optional(),
  /** 同会话最近几张卡，供澄清解析。 */
  relatedCardIds: z.array(z.string()).optional(),
})
export type CardOrigin = z.infer<typeof CardOriginSchema>

export const CardEventSchema = z.object({
  at: z.number(),
  type: z.string(),
  via: z.string().optional(),
})
export type CardEvent = z.infer<typeof CardEventSchema>

/**
 * 票拟里的一个方案。四栏是用户批红时要对照的东西：
 * 成本、长期收益（以后每次少走几步）、最坏情况，以及采纳后回给原会话的那句话。
 */
export const AdviceOptionSchema = z.object({
  name: z.string().min(1),
  cost: z.string().default(''),
  gain: z.string().default(''),
  worst: z.string().default(''),
  /** 采纳后替用户发回原会话的话，必须能独立成立。 */
  answer: z.string().default(''),
  verdict: z.enum(ADVICE_VERDICTS).default('modify'),
})
export type AdviceOption = z.infer<typeof AdviceOptionSchema>

/** 决策代理人对一张卡出的票拟：结论 + 2–3 个方案 + 依据（含判例编号）。 */
export const AdviceSchema = z.object({
  verdict: z.enum(ADVICE_VERDICTS).default('wait'),
  summary: z.string().default(''),
  options: z.array(AdviceOptionSchema).default([]),
  /** 一句话依据；引用判例时写编号，没有同类判例写「无同类判例」。 */
  basis: z.string().default(''),
  precedentIds: z.array(z.string()).default([]),
  confidence: z.enum(CARD_SEVERITIES).default('normal'),
  /** 阶段 D：票拟建议的验收检查；applyAdvice 会先过白名单再落卡。 */
  acceptance: z.array(AcceptanceSchema).optional(),
  /** 数值置信度（0–1）；有它时按数值路由（≥0.9 可补偿无判例，§12）。 */
  confidenceScore: z.number().min(0).max(1).optional(),
  /** verdict=wait 时的一个追问，用来补上缺的那条信息。 */
  question: z.string().default(''),
  /** 许可/澄清的顶层答复；判断卡用 options[chosen].answer。 */
  answer: z.string().optional(),
  /** 它推荐哪个方案（options 的 0-based 序号）。 */
  chosen: z.number().int().nonnegative().default(0),
  /** 这个推荐是否可逆且便宜（撤回不需要用户本人动手）——为真才允许系统自动执行。 */
  autoApply: z.boolean().default(false),
  /** 它判定的车道；与卡的 kind 不同时说明原分类被纠正。 */
  lane: z.enum(CARD_KINDS).default('decision'),
  /** 请求类型：判断 / 许可 / 澄清。 */
  ask: z.enum(ASK_KINDS).optional(),
  /** 这句话对原会话的影响等级；只有 read 才允许自动执行。 */
  effect: z.enum(EFFECTS).optional(),
  /** 执行这句话需要的能力，必须都在能力清单里。 */
  requires: z.array(z.string()).optional(),
  /** 许可卡：将执行的具体动作/命令。 */
  action: z.string().optional(),
  /** 许可卡：文件/路径/范围。 */
  scope: z.string().optional(),
  /** 许可卡：是否可撤回。 */
  reversible: z.boolean().optional(),
  /** 澄清卡：候选值。 */
  candidates: z.array(z.string()).optional(),
  /** 自动执行被拦下的原因；为空表示没被拦。 */
  blockedReasons: z.array(z.string()).optional(),
  /** 车道纠正是否已自动落盘（只允许向 info 方向纠正）。 */
  applied: z.boolean().default(false),
  at: z.number(),
})
export type Advice = z.infer<typeof AdviceSchema>

/**
 * 判例：用户过去同类决定的一条记录。返工过的判例（outcome=reworked）
 * 不再当准绳——这是用户的硬规则，不是建议。
 */
export const PrecedentSchema = z.object({
  id: z.string().min(1),
  at: z.number(),
  cardId: z.string().default(''),
  /** 当时要定的事。 */
  title: z.string().default(''),
  /** 当时的问法与判据，供同类匹配。 */
  question: z.string().default(''),
  /** 用户当时怎么定的（原话或采纳的方案名）。 */
  choice: z.string().default(''),
  outcome: z.enum(PRECEDENT_OUTCOMES).default('unknown'),
  /** 返工原因，只在 outcome=reworked 时有值。 */
  note: z.string().default(''),
  keywords: z.array(z.string()).default([]),
})
export type Precedent = z.infer<typeof PrecedentSchema>
