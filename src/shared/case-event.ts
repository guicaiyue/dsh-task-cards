// CaseEvent 的 zod 校验：事件是重放的唯一输入，traceId 必填。
//
// 历史数据（78/134）traceId 为空：读取时由 journal 补 `migrate-<id>`，写回时带迁移说明。

import { z } from 'zod'
import type { CaseEvent } from './case'
import { ACTORS, AUTHORITIES, CASE_PHASES, DELIVERY_STATES } from './case-contract'

export const CaseEventSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  traceId: z.string().min(1),
  at: z.number(),
  phase: z.enum(CASE_PHASES),
  from: z.enum(DELIVERY_STATES),
  to: z.enum(DELIVERY_STATES),
  actor: z.enum(ACTORS),
  authority: z.enum(AUTHORITIES),
  reason: z.string().default(''),
  evidenceRefs: z.array(z.string()).default([]),
  policyVersion: z.number().int().default(1),
  attempt: z.number().int().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
})
export type CaseEventValidated = z.infer<typeof CaseEventSchema>

export function parseCaseEvent(value: unknown): CaseEvent {
  return CaseEventSchema.parse(value) as CaseEvent
}
