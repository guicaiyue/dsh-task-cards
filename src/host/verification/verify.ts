// 验收判定：Todo 管结构，证据管事实，机器项优先于自述。
//
// 纯函数：输入卡、清单、证据、已重试次数，输出结论与下一步。
// 不读时钟、不写存储，方便穷举测试。

import type { Card } from '../../shared/contract'
import { EVIDENCE_LEVEL_WEIGHT, type EvidenceRecord, minimumLevelFor } from '../../shared/evidence'
import { type ExecutionResult, hasReceipt } from '../../shared/execution'
import type { CriterionResult, VerificationOutcome } from '../../shared/outcome'
import type { TodoList } from '../../shared/todo'
import { completionOf } from '../../shared/todo'

export interface VerifyInput {
  card: Card
  todo: TodoList | null
  evidence: readonly EvidenceRecord[]
  /** 已经因为「清单落后」返工过几次（上限 1）。 */
  retries: number
  /** 执行回执（dispatched 之后 origin 会话确实又跑完一轮）。 */
  receipt?: ExecutionResult | null
}

function evidenceCriteria(evidence: readonly EvidenceRecord[]): CriterionResult[] {
  return evidence.map((record) => ({
    id: record.id,
    pass: record.ok,
    evidence: record.detail,
  }))
}

/** 基线里被阻塞或代价变高的项：这类不判失败，交决策者。 */
function blockedItems(todo: TodoList): string[] {
  const baseline = new Set(todo.baselineIds)
  return todo.items
    .filter((item) => baseline.has(item.id))
    .filter((item) => item.status === 'blocked' || item.cost?.delta === 'up')
    .map((item) => item.text)
}

/** 语义项分级：acceptance 里非 system 的判据 → decision/user（destructive/spend 强制 user）。 */
export function semanticTierOf(card: Card): 'decision' | 'user' | null {
  const items = (card.acceptance ?? []).filter((item) => (item.verifier ?? 'system') !== 'system')
  if (!items.length) return null
  const effect = card.advice?.effect
  if (effect === 'destructive' || effect === 'spend') return 'user'
  return items.some((item) => item.verifier === 'user') ? 'user' : 'decision'
}

function semanticOutcome(card: Card, criteria: CriterionResult[]): VerificationOutcome | null {
  const tier = semanticTierOf(card)
  if (!tier) return null
  const ids = (card.acceptance ?? [])
    .filter((item) => (item.verifier ?? 'system') !== 'system')
    .map((item) => item.id)
  return {
    verified: 'unknown',
    action: 'escalate',
    verifier: tier,
    reason: `语义项需要${tier === 'user' ? '用户' : '决策代理人'}判定：${ids.join(', ')}`,
    criteria,
    semanticNeeded: true,
  }
}

export function verifyCard(input: VerifyInput): VerificationOutcome {
  const criteria = evidenceCriteria(input.evidence)
  const blocked = blockedOutcome(input.todo, criteria)
  if (blocked) return blocked

  const failed = failedEvidenceOutcome(input, criteria)
  if (failed) return failed

  const incomplete = incompleteOutcome(input, criteria)
  if (incomplete) return incomplete

  // 阶段 D：语义项不能由机器确认，交给 decision/user 两级（semanticNeeded 消费点）。
  const semantic = semanticOutcome(input.card, criteria)
  if (semantic) return semantic

  const confirmed = confirmedOutcome(input, criteria)
  if (confirmed) return confirmed

  // 没有清单也没有证据时，唯一能 confirmed 的凭据是「回执」：
  // origin 会话在派发之后确实又起了一轮并结束，且最终回复非空。
  // 决策卡也走这条——它没有别的可验收产物，但「投递成功」不等于「回执」，两者别混。
  if (!input.todo?.frozen && hasReceipt(input.receipt)) {
    const receipt = input.receipt
    return {
      verified: 'confirmed',
      action: 'close',
      verifier: 'system',
      reason: `回执已到：origin 会话第 ${receipt?.receiptTurn ?? '?'} 回合已结束（回复 ${receipt?.replyChars ?? 0} 字）`,
      criteria,
      semanticNeeded: false,
    }
  }

  return {
    verified: 'unknown',
    action: 'inconclusive',
    verifier: 'system',
    reason: `执行中断（A 类：无回执/无证据/可能报错或超时），无法验收（${input.card.title}）`,
    criteria,
    semanticNeeded: true,
  }
}

function blockedOutcome(
  todo: TodoList | null,
  criteria: CriterionResult[],
): VerificationOutcome | null {
  if (!todo) return null
  const blocked = blockedItems(todo)
  if (!blocked.length) return null
  return {
    verified: 'unknown',
    action: 'escalate',
    verifier: 'system',
    reason: `代价变高/被阻塞（C 类，交决策者评估继续/缩小/终止）：${blocked[0]}`,
    criteria,
    semanticNeeded: false,
  }
}

function failedEvidenceOutcome(
  input: VerifyInput,
  criteria: CriterionResult[],
): VerificationOutcome | null {
  const failed = criteria.filter((item) => !item.pass)
  if (!failed.length) return null
  return {
    verified: 'failed',
    action: input.retries < 1 ? 'retry' : 'escalate',
    verifier: 'system',
    reason: `执行失败（A 类：证据不通过），${input.retries < 1 ? '重试一次' : '转人工/补偿'}：${failed[0]?.evidence ?? '未知'}`,
    criteria,
    semanticNeeded: false,
  }
}

function incompleteOutcome(
  input: VerifyInput,
  criteria: CriterionResult[],
): VerificationOutcome | null {
  const todo = input.todo
  if (!todo?.frozen) return null
  const completion = completionOf(todo)
  if (!completion || completion.done >= completion.total) return null
  return {
    verified: 'failed',
    action: input.retries < 1 ? 'continue-session' : 'escalate',
    verifier: 'system',
    reason: `正常结束但忘更新（B 类：给会话第 ${input.retries + 1}/1 次对账机会）：清单 ${completion.done}/${completion.total}`,
    criteria,
    semanticNeeded: false,
  }
}

/**
 * 清单/证据侧的唯一 confirmed 出口：**必须有证据**。
 *
 * 「清单全绿但零证据」= 执行者自证，不能 confirmed（EVIDENCE-MODEL V2 / Goodhart）。
 * 决策卡没有清单也没有证据时走上面的回执分支；回执也不成立就只能是 unknown。
 */
function confirmedOutcome(
  input: VerifyInput,
  criteria: CriterionResult[],
): VerificationOutcome | null {
  // 收口（审计 P0-4 / 阶段 D）：机器证据至少 E2；按 effect 再抬到 E3(破坏性)/E4(花钱)。
  // 旧证据没有 level → 按 E1 处理，不足以确认。
  const effect = (input.card.advice?.effect ?? 'write-code') as Parameters<
    typeof minimumLevelFor
  >[0]
  const required = EVIDENCE_LEVEL_WEIGHT[minimumLevelFor(effect)]
  const strong = input.evidence.filter(
    (record) =>
      EVIDENCE_LEVEL_WEIGHT[record.level ?? 'E1'] >= Math.max(required, EVIDENCE_LEVEL_WEIGHT.E2),
  )
  if (!strong.length) return null
  const complete = input.todo?.frozen ? completionOf(input.todo) : null
  if (input.todo?.frozen && (!complete || complete.done < complete.total)) return null
  return {
    verified: 'confirmed',
    action: 'close',
    verifier: 'system',
    reason: '清单/证据均通过',
    criteria,
    semanticNeeded: false,
  }
}
