// 30s 定时器里的提问相关副作用（从 wire.ts 拆出）：
// 阻塞扫描 / 超时按默认继续 / ask 通道超时继续 / blocking 过期收尾。全部 fire-and-forget。

import type { Settings } from '../../shared/contract'
import { expireBlockingAsks, sweepAskStore, sweepAutoContinue } from '../asks/auto-continue'
import type { AskStore } from '../asks/store'
import type { Store } from '../cards/store'
import type { HostRuntime, Log } from '../host-api'
import { answerQuestion } from '../question/answer'
import { sweepBlockedAsks } from './blocked-asks'
import type { Journal } from './journal'

export interface AskTimerDeps {
  cards: Store
  asks: AskStore
  journal: Journal
  approvalPolicy: { read(): { version: number } }
  settings: () => Settings
  runtime: () => HostRuntime | null
  log: Log
}

/** 一条提问去向的审计事实：自动继续、过期收尾共用同一形状。 */
function appendAskFact(
  deps: AskTimerDeps,
  askId: string,
  type: 'ask:auto-continued' | 'ask:expired',
  reason: string,
  meta: Record<string, unknown>,
): void {
  void deps.journal
    .append({
      id: `e-${type === 'ask:expired' ? 'askexp' : 'askauto'}-${askId}`,
      caseId: `ask-${askId}`,
      traceId: `tr-ask-${askId}`,
      at: Date.now(),
      phase: 'decide',
      from: 'idle',
      to: 'idle',
      actor: 'system',
      authority: 'system',
      reason,
      evidenceRefs: [],
      policyVersion: deps.approvalPolicy.read().version,
      meta: { type, ...meta },
    })
    .catch(() => undefined)
}

export function runAskTimers(deps: AskTimerDeps): void {
  const { settings, log } = deps
  const failed = (what: string) => (err: unknown) =>
    log(`${what}：${(err as Error)?.message || String(err)}`)
  sweepBlockedAsks({ cards: deps.cards, settings, log }).catch(failed('阻塞扫描失败'))
  void sweepAutoContinue({
    cards: deps.cards,
    settings,
    log,
    deliver: async (card, text) => {
      await answerQuestion(card, text, deps.runtime())
    },
  }).catch(failed('自动继续失败'))
  void sweepAskStore({
    asks: deps.asks,
    settings,
    log,
    audit: (askId, timeoutMs, defaultAnswer) =>
      appendAskFact(deps, askId, 'ask:auto-continued', 'ask:auto-continued：超时按默认答案继续', {
        timeoutMs,
        answer: defaultAnswer,
        defaultAnswer,
        auto: true,
      }),
  }).catch(failed('ask 自动继续失败'))
  // blocking 提问没人来答（会话常常已经结束）：等够 6 小时按默认答案收尾，不让它永远挂着。
  void expireBlockingAsks({
    asks: deps.asks,
    settings,
    log,
    audit: (askId, waitedMs, defaultAnswer) =>
      appendAskFact(
        deps,
        askId,
        'ask:expired',
        'ask:expired：blocking 提问超时未答，按默认答案收尾',
        {
          waitedMs,
          answer: defaultAnswer,
          defaultAnswer,
          expired: true,
        },
      ),
  }).catch(failed('blocking ask 收尾失败'))
}
