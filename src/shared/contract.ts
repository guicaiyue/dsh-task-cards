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

/** 决策代理人对一张卡给的结论：照办 / 不该做 / 换个做法 / 现在别决。 */
export const ADVICE_VERDICTS = ['approve', 'reject', 'modify', 'wait'] as const
/** 判例的后果：还没验收 / 验收通过 / 后来返工了（返工过的判例不再当准绳）。 */
export const PRECEDENT_OUTCOMES = ['unknown', 'valid', 'reworked'] as const

export type CardKind = (typeof CARD_KINDS)[number]
export type AdviceVerdict = (typeof ADVICE_VERDICTS)[number]
export type PrecedentOutcome = (typeof PRECEDENT_OUTCOMES)[number]
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
  /** 观察者为什么判成这个 kind（一句话，给决策代理人当依据）。 */
  reason: z.string().default(''),
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
  /** verdict=wait 时的一个追问，用来补上缺的那条信息。 */
  question: z.string().default(''),
  /** 它推荐哪个方案（options 的 0-based 序号）。 */
  chosen: z.number().int().nonnegative().default(0),
  /** 这个推荐是否可逆且便宜（撤回不需要用户本人动手）——为真才允许系统自动执行。 */
  autoApply: z.boolean().default(false),
  /** 它判定的车道；与卡的 kind 不同时说明原分类被纠正。 */
  lane: z.enum(CARD_KINDS).default('decision'),
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
  /** 决策 agent 出的票拟；没跑过或没结论时为 null。 */
  advice: AdviceSchema.nullable().default(null),
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

/** 观察者输出的草稿：还没落盘，没有 id/时间戳。 */
export const CardDraftSchema = z.object({
  title: z.string().min(1),
  detail: z.string().default(''),
  kind: z.enum(CARD_KINDS).default('info'),
  severity: z.enum(CARD_SEVERITIES).default('normal'),
  action: CardActionSchema.nullable().default(null),
  /** 分类凭据：一句话说明为什么是这个 kind。 */
  reason: z.string().default(''),
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
  /** 决策阶段：卡建好后另跑一个「只出票拟、不动手」的会话。 */
  decisionEnabled: z.boolean().default(true),
  /** 决策代理人的系统提示词（用户的决策画像写在里面），面板可编辑。 */
  decisionPrompt: z.string().default(''),
  decisionProvider: z.string().default(''),
  decisionModel: z.string().default(''),
  /** 一次票拟最多带几条判例进输入。 */
  decisionPrecedentLimit: z.number().int().nonnegative().default(30),
  /** 允许系统直接执行 autoApply=true 的票拟（不等人批红）。 */
  decisionAutoApply: z.boolean().default(true),
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

/** 一次观察者 / 决策会话的调用记录：谁跑的、跑了多久、出了什么、有没有动手。 */
export const RecordSchema = z.object({
  id: z.string(),
  at: z.number(),
  /** 哪一段：观察者写卡，还是决策代理人出票拟。 */
  phase: z.enum(['observer', 'decision']).default('observer'),
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
  /** 决策阶段：这次自动执行了几张（不等批红就动手的）。 */
  applied: z.number().optional(),
  /** 决策阶段：被判成 info 而降车道的张数。 */
  corrected: z.number().optional(),
})
export type ObserverRecord = z.infer<typeof RecordSchema>
