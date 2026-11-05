// 卡片、设置、策略的契约：zod schema 是唯一真源。
//
// 从这里派生：① TypeScript 类型（z.infer）② 运行时校验（parse）③ 观察者提示词里的
// JSON Schema（z.toJSONSchema）④ docs/contracts.md 的人工摘要。
// 客户端只能 `import type`，否则会把 zod 打进浏览器 bundle。

import { z } from 'zod'

export const CARD_KINDS = ['decision', 'info', 'auto'] as const
export const CARD_SEVERITIES = ['high', 'normal', 'low'] as const
export const CARD_STATUSES = ['open', 'acknowledged', 'scheduled', 'done', 'dismissed'] as const
export const CARD_SOURCES = ['human', 'agent'] as const
export const CARD_INTERACTIONS = ['reply', 'question'] as const
export const CARD_ACTION_TYPES = ['prompt', 'retry'] as const
export const ANSWER_VIAS = ['card', 'chat'] as const

export type CardKind = (typeof CARD_KINDS)[number]
export type CardSeverity = (typeof CARD_SEVERITIES)[number]
export type CardStatus = (typeof CARD_STATUSES)[number]
export type CardSource = (typeof CARD_SOURCES)[number]
export type CardInteraction = (typeof CARD_INTERACTIONS)[number]
export type CardActionType = (typeof CARD_ACTION_TYPES)[number]
export type AnswerVia = (typeof ANSWER_VIAS)[number]

/** 自动动作：到点后在原会话里补一句话（type 目前只有 prompt/retry 两种写法，行为相同）。 */
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
})
export type CardOrigin = z.infer<typeof CardOriginSchema>

export const CardEventSchema = z.object({
  at: z.number(),
  type: z.string(),
  via: z.string().optional(),
})
export type CardEvent = z.infer<typeof CardEventSchema>

/** 一张卡。detail 之外的字段都有默认值，旧数据也能解析。 */
export const CardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().default(''),
  kind: z.enum(CARD_KINDS).default('info'),
  severity: z.enum(CARD_SEVERITIES).default('normal'),
  status: z.enum(CARD_STATUSES).default('open'),
  action: CardActionSchema.nullable().default(null),
  dueAt: z.number().nullable().default(null),
  source: z.enum(CARD_SOURCES).default('human'),
  interaction: z.enum(CARD_INTERACTIONS).default('reply'),
  question: QuestionSchema.nullable().default(null),
  origin: CardOriginSchema.nullable().default(null),
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

/** 观察者输出的草稿：还没落盘，没有 id/时间戳。 */
export const CardDraftSchema = z.object({
  title: z.string().min(1),
  detail: z.string().default(''),
  kind: z.enum(CARD_KINDS).default('info'),
  severity: z.enum(CARD_SEVERITIES).default('normal'),
  action: CardActionSchema.nullable().default(null),
})
export type CardDraft = z.infer<typeof CardDraftSchema>

/** 观察者设置。每次读都合并默认值，所以新增字段不会让旧文件失效。 */
export const SettingsSchema = z.object({
  enabled: z.boolean().default(true),
  systemPrompt: z.string().default(''),
  provider: z.string().default(''),
  model: z.string().default(''),
  minReplyChars: z.number().int().nonnegative().default(120),
  includeSubagents: z.boolean().default(false),
  maxInputBytes: z.number().int().positive().default(16000),
  timeoutMs: z.number().int().positive().default(60000),
})
export type Settings = z.infer<typeof SettingsSchema>

export const POLICY_ROLES = ['observer', 'worker', 'default'] as const
export type PolicyRole = (typeof POLICY_ROLES)[number]

export const PolicyRuleSchema = z.object({
  tools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
})
export const PolicySchema = z.object({
  version: z.number().int().positive().default(1),
  roles: z.record(z.enum(POLICY_ROLES), PolicyRuleSchema),
})
export type Policy = z.infer<typeof PolicySchema>

/** 观察者调用记录：面板「记录」页签已删除，但记录仍写盘，便于事后排查。 */
export const RecordSchema = z.object({
  id: z.string(),
  at: z.number(),
  status: z.enum(['ok', 'empty', 'invalid', 'error']),
  originSessionId: z.string().optional(),
  turn: z.number().optional(),
  observerSessionId: z.string().optional(),
  model: z.string().optional(),
  inputChars: z.number().optional(),
  outputChars: z.number().optional(),
  usage: z
    .object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() })
    .optional(),
  toolCalls: z.number().optional(),
  durationMs: z.number().optional(),
  attempts: z.number().optional(),
  excerpt: z.string().optional(),
  error: z.string().optional(),
  cardsCreated: z.number().optional(),
  cardIds: z.array(z.string()).optional(),
})
export type ObserverRecord = z.infer<typeof RecordSchema>
