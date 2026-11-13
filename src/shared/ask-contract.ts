// ask 通道（P2/P1）：提问不再落 cards.json，而是独立 ask 对象（kind=ask）。
//
// 目的：卡片是「人机之间的收费站」，问一句不该产生一张卡；ask 只是例外通道，
// 带默认答案，超时按默认继续（P2），只有 blocking=true 才无限等。

import { z } from 'zod'

export const AskSchema = z.object({
  kind: z.literal('ask').default('ask'),
  id: z.string(),
  goalId: z.string().default(''),
  sessionId: z.string().default(''),
  /** 去重键：同一次工具调用的判定只应产生一条 ask（guard 与 pre-execute 会各判一次）。 */
  key: z.string().default(''),
  question: z.string(),
  /** 默认答案：必须给（P2）；超时按它继续，并在结果里注明「已按默认执行」。 */
  defaultAnswer: z.string(),
  /** 只有「答案不可推断 + 不可逆」才允许 true（无限等）。 */
  blocking: z.boolean().default(false),
  /** 不可逆动作的说明（为什么要问）。 */
  reason: z.string().default(''),
  effect: z.enum(['read', 'write-code', 'external', 'spend', 'destructive']).default('write-code'),
  /** 审计：动作前的可回滚 git ref 与回滚方式。 */
  beforeRef: z.string().default(''),
  rollback: z.object({ kind: z.string(), ref: z.string() }).optional(),
  policyVersion: z.number().int().default(1),
  createdAt: z.number(),
  answeredAt: z.number().optional(),
  answer: z.string().optional(),
  autoContinued: z.boolean().optional(),
})
export type Ask = z.infer<typeof AskSchema>
