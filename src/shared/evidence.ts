// 证据：只认「边界事实」，不证明智能体的思考。
//
// M1 只做三种检查器：exit / file / http。全部 10s 超时，超时记 unknown，不重试。

export type CheckSpec =
  | { kind: 'exit'; cmd: string; expect: number }
  | { kind: 'file'; path: string; expect: 'exists' | 'absent' }
  | { kind: 'http'; url: string; expect: number }

/**
 * 证据等级（验收只认边界事实）：
 * E1 = 自述/无来源；E2 = 机器产出（exit/file/http 检查器、测试输出）；E3 = 外部不可变记录；E4 = 多方交叉。
 * 旧记录没有 level，一律按 E1 处理（不足以 confirmed）。
 */
export type EvidenceLevel = 'E1' | 'E2' | 'E3' | 'E4'

/**
 * 按 effect 选最低证据级别（阶段 D 三级验收）：
 * read=E1 / write-code=E2 / external=E2 / destructive=E3 / spend=E4。
 * 决策卡仍走「回执 + 非空回复」，另外至少 E2 机器证据才 confirmed。
 */
export function minimumLevelFor(
  effect: 'read' | 'write-code' | 'external' | 'destructive' | 'spend',
): EvidenceLevel {
  if (effect === 'read') return 'E1'
  if (effect === 'destructive') return 'E3'
  if (effect === 'spend') return 'E4'
  return 'E2'
}

export const EVIDENCE_LEVEL_WEIGHT: Record<EvidenceLevel, number> = {
  E1: 1,
  E2: 2,
  E3: 3,
  E4: 4,
}

export interface EvidenceRecord {
  id: string
  caseId: string
  at: number
  spec: CheckSpec
  /** 等级；缺省（旧数据）按 E1 处理。 */
  level?: EvidenceLevel
  /** 指向真实产物/日志/测试输出的引用（路径、planId+acceptanceId 等）。 */
  sourceRef?: string
  /** 证据所属的计划版本（与 Card.evidenceEpoch 对齐；缺省按 0）。 */
  epoch?: number
  ok: boolean
  /** 人读的一句话：exit=1、文件存在（sha256 前 12 位）、HTTP 500。 */
  detail: string
  durationMs: number
  sha256?: string
  error?: string
}

export interface CheckContext {
  cwd?: string
  timeoutMs?: number
  /** 允许检查内网地址（默认拒绝，防 SSRF）。 */
  allowPrivate?: boolean
}

export const CHECK_TIMEOUT_MS = 10_000
