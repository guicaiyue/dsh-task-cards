// 闸门装配（P1 授权反转）：可逆放行写 autonomy:auto，不可逆进 ask 通道（不建卡）。

import type { Card, Settings } from '../../shared/contract'
import type { AskStore } from '../asks/store'
import type { Store } from '../cards/store'
import { TurnGate } from '../gate/gate'
import { type GateStatsStore, gateStats } from '../gate/gate-stats'
import type { Log } from '../host-api'
import type { Journal } from '../kernel/journal'
import type { KernelRuntime } from '../kernel/runtime'
import { gitSnapshot, rollbackOf } from './audit'

export interface GateWireDeps {
  cards: Store
  settings: () => Settings
  log: Log
  kernel: Pick<KernelRuntime, 'journal' | 'asks' | 'approvalPolicy'>
  /** 零静默账本（可注入）：拒绝次数与 ask 去向。 */
  stats?: GateStatsStore
}

export function createTurnGate(deps: GateWireDeps): TurnGate {
  const { cards, settings, log, kernel } = deps
  return new TurnGate({
    cards,
    settings,
    log,
    recordAutonomy: (entry) => writeAutonomy(kernel.journal, log, entry, policyVersionOf(kernel)),
    policyVersion: () => policyVersionOf(kernel),
    stats: deps.stats,
    createAsk: (entry) =>
      writeAsk(kernel.journal, kernel.asks, log, entry, deps.stats ?? gateStats()),
  })
}

function policyVersionOf(kernel: GateWireDeps['kernel']): number {
  try {
    return kernel.approvalPolicy.read().version
  } catch {
    return 1
  }
}

function writeAutonomy(
  journal: Journal,
  log: Log,
  entry: Parameters<NonNullable<ConstructorParameters<typeof TurnGate>[0]['recordAutonomy']>>[0] & {
    cwd?: string
  },
  policyVersion: number,
): void {
  const snapshot = gitSnapshot(entry.cwd)
  void journal
    .append({
      id: `e-autonomy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      caseId: `autonomy-${entry.sessionId || 'unknown'}`,
      traceId: `tr-autonomy-${Date.now().toString(36)}`,
      at: Date.now(),
      phase: 'execute',
      from: 'idle',
      to: 'idle',
      actor: 'system',
      authority: 'system',
      reason: 'autonomy:auto：可逆仓内操作自批执行',
      evidenceRefs: [],
      policyVersion,
      meta: {
        type: 'autonomy:auto',
        goalId: entry.sessionId || 'session-unknown',
        policyVersion,
        reason: 'autonomy:auto：可逆仓内操作自批执行',
        tool: entry.tool,
        effect: entry.effect,
        target: entry.target,
        reasons: entry.reasons,
        beforeRef: snapshot.beforeRef,
        rollback: rollbackOf(snapshot),
      },
    })
    .catch((err: unknown) => log(`自主审计写入失败：${(err as Error)?.message}`))
}

type AskInput = Parameters<AskStore['create']>[0] & {
  beforeRef?: string
  rollback?: { kind: string; ref: string }
}

function writeAsk(
  journal: Journal,
  asks: AskStore,
  log: Log,
  entry: {
    goalId: string
    sessionId: string
    key: string
    question: string
    defaultAnswer: string
    blocking: boolean
    reason: string
    effect: 'read' | 'write-code' | 'external' | 'spend' | 'destructive'
    policyVersion: number
  },
  stats: GateStatsStore,
): void {
  const snapshot = gitSnapshot()
  const input = {
    ...entry,
    beforeRef: snapshot.beforeRef,
    rollback: rollbackOf(snapshot),
  } as AskInput
  void asks
    .create(input)
    .then(({ ask, duplicate }) => {
      // 同一次调用的第二次判定（guard 与 pre-execute 各一次）：账本已有一条，只记日志。
      if (duplicate) {
        stats.bump('askDeduped')
        return log(`ask 去重：同一次调用已有未作答的提问（${ask.id}）`)
      }
      stats.bump('askCreated')
      return journal.append({
        id: `e-ask-${ask.id}`,
        caseId: `ask-${ask.id}`,
        traceId: `tr-ask-${ask.id}`,
        at: Date.now(),
        phase: 'decide',
        from: 'idle',
        to: 'idle',
        actor: 'system',
        authority: 'system',
        reason: 'ask:open：不可逆动作等待确认（带默认答案）',
        evidenceRefs: [],
        policyVersion: ask.policyVersion,
        meta: {
          type: 'ask:open',
          policyVersion: ask.policyVersion,
          reason: 'ask:open：不可逆动作等待确认（带默认答案）',
          askId: ask.id,
          defaultAnswer: ask.defaultAnswer,
          blocking: ask.blocking,
        },
      })
    })
    .catch((err: unknown) => {
      stats.bump('askFailed')
      log(`ask 通道写入失败：${(err as Error)?.message}`)
    })
}
