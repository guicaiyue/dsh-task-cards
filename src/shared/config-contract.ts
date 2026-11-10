// 设置 / 策略 / 运行记录的契约：从 contract.ts 拆出，保持单文件 ≤300 行预算。
//
// contract.ts 会 re-export 这里的一切，外部 import 路径保持不变。

import { z } from 'zod'

/** 回合内闸门档位：关 / 只拦高风险 / 连工作区内写也拦。 */
export const TURN_GATES = ['off', 'high-risk', 'all'] as const

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
  /** 独立开关：只自动放行可逆的诊断性 write-code（日志/插桩/复测），不影响其它票拟。 */
  autoApproveDiagnostics: z.boolean().default(false),
  /** 水平触发排水：定时扫 pending_secretary 且无票拟的卡补派决策（默认开）。 */
  autoDecide: z.boolean().default(true),
  /** 观察者兜底：回合结束事件漏了/坏了时，定时补一次观察（默认开）。 */
  fallbackObserve: z.boolean().default(true),
  /** 派发后等回执的超时（毫秒）：超时判 failed/no-receipt。 */
  receiptTimeoutMs: z.number().int().positive().default(180000),
  /** 回合内危险动作前置闸门（write-code/destructive/spend 当场拦，不等回合结束）。 */
  turnGate: z.enum(TURN_GATES).default('high-risk'),
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
  /** skipped = 这一轮被跳过没观察（兜底会补；记录页能看到原因）。 */
  status: z.enum(['ok', 'empty', 'invalid', 'error', 'skipped']),
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
  /** status=skipped 时「为什么没观察」。 */
  skipReason: z.string().optional(),
  cardsCreated: z.number().optional(),
  cardIds: z.array(z.string()).optional(),
  /** 决策阶段：这次自动执行了几张（不等批红就动手的）。 */
  applied: z.number().optional(),
  /** 决策阶段：被判成 info 而降车道的张数。 */
  corrected: z.number().optional(),
})
export type ObserverRecord = z.infer<typeof RecordSchema>
