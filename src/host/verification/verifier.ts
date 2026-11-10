// 验收器：读卡/清单/证据 → 判定 → 落到状态机。
//
// 只做三件事：数返工次数、调用纯函数、把结论写进事件与卡状态。
// 语义判定（模型）在 M2 不默认启用：没有证据也没有清单时给 inconclusive。

import type { Card } from '../../shared/contract'
import type { CheckSpec, EvidenceLevel, EvidenceRecord } from '../../shared/evidence'
import type { ExecutionResult } from '../../shared/execution'
import type { VerificationOutcome } from '../../shared/outcome'
import type { TodoList } from '../../shared/todo'
import type { Store } from '../cards/store'
import { asRecord, type Log } from '../host-api'
import type { Journal } from '../kernel/journal'
import type { TransitionRequest } from '../kernel/transition'
import { noteCase } from '../kernel/transition'
import { verifyCard } from './verify'

export interface VerifierDeps {
  cards: Store
  journal: Journal
  apply: (req: TransitionRequest) => Promise<unknown>
  todo: { read(caseId: string): Promise<TodoList | null> }
  evidence: {
    read(caseId: string): Promise<{ records: EvidenceRecord[] }>
    /** 服务端自动收集（B）：只跑冻结 acceptance；返回新增记录。 */
    check?(
      caseId: string,
      specs: readonly CheckSpec[],
      ctx?: { cwd?: string; timeoutMs?: number },
      meta?: { level?: EvidenceLevel; sourceRef?: string; epoch?: number },
    ): Promise<EvidenceRecord[]>
  }
  log?: Log
}

const MAX_CONTINUE = 1
/** P2：同一卡同一 epoch 的证据上限（与 acceptance 上限一致）。 */
const MAX_EVIDENCE_PER_EPOCH = 5

function messageOf(err: unknown): string {
  return (err as Error)?.message || String(err)
}

export class Verifier {
  readonly #deps: VerifierDeps

  constructor(deps: VerifierDeps) {
    this.#deps = deps
  }

  /** 自动收集：按冻结 acceptance 跑服务端 checker（cwd 固定、30s 超时、上限 5 条）。 */
  async #autoCollect(card: Card): Promise<void> {
    const check = this.#deps.evidence.check
    const acceptance = card.acceptance ?? []
    if (!check || !acceptance.length) return
    const epoch = card.evidenceEpoch ?? 0
    const { records } = await this.#deps.evidence.read(card.id)
    const current = records.filter((record) => (record.epoch ?? 0) === epoch)
    const room = Math.max(0, MAX_EVIDENCE_PER_EPOCH - current.length)
    if (!room) {
      this.#deps.log?.(`自动收证据跳过：${card.id} 当前 epoch 已达上限 ${MAX_EVIDENCE_PER_EPOCH}`)
      return
    }
    for (const item of acceptance.slice(0, room)) {
      await check
        .call(
          this.#deps.evidence,
          card.id,
          [item.spec],
          { timeoutMs: 30_000 },
          {
            level: item.level,
            sourceRef: `${card.planId ?? card.id}#${item.id}`,
            epoch,
          },
        )
        .catch((err: unknown) => this.#deps.log?.(`自动收证据失败：${messageOf(err)}`))
    }
  }

  /** 三级验收的 decision/user 两级：开一张语义票据（等代理人或用户拍板）。 */
  async #openSemanticTicket(card: Card, outcome: VerificationOutcome): Promise<void> {
    const plan = this.#deps.cards.find(card.id)
    const title = `验收待定（${outcome.verifier === 'user' ? '用户' : '代理人'}）：${card.title}`
    if (this.#deps.cards.list().some((item) => item.title === title)) return
    await this.#deps.cards
      .create(title, {
        kind: 'decision',
        severity: outcome.verifier === 'user' ? 'high' : 'normal',
        detail: `${outcome.reason}。原卡：${card.id}`,
        ask: outcome.verifier === 'user' ? 'permission' : 'judgment',
        ...(card.origin ? { origin: card.origin } : {}),
        semantic: {
          planId: plan?.planId ?? card.id,
          verifier: outcome.verifier === 'user' ? 'user' : 'decision',
          sourceCardId: card.id,
          criteria: (card.acceptance ?? [])
            .filter((item) => (item.verifier ?? 'system') !== 'system')
            .map((item) => item.id),
        },
      })
      .catch((err: unknown) => this.#deps.log?.(`语义票据创建失败：${(err as Error)?.message}`))
  }

  async #retriesOf(caseId: string): Promise<number> {
    const { events } = await this.#deps.journal.read(caseId)
    return events.filter((event) => event.meta?.verifyRetry === true).length
  }

  /** 执行回执：dispatched → executed 那条事件的 meta.execution。 */
  async #receiptOf(caseId: string): Promise<ExecutionResult | null> {
    const { events } = await this.#deps.journal.read(caseId)
    const executed = events.filter((event) => event.to === 'executed').pop()
    const execution = asRecord(executed?.meta).execution
    return execution ? (execution as ExecutionResult) : null
  }

  /** 对一张已执行的卡做验收；返回结论（同时已落状态与事件）。 */
  async verify(caseId: string): Promise<VerificationOutcome | null> {
    const card = this.#deps.cards.find(caseId)
    if (!card) return null
    if (card.deliveryState !== 'executed') {
      this.#deps.log?.(`跳过验收：${caseId} 当前不在 executed（${card.deliveryState ?? 'idle'}）`)
      return null
    }
    await this.#deps.apply({
      cardId: caseId,
      to: 'verifying',
      actor: 'verifier',
      authority: 'system',
      reason: '开始验收',
    })

    // B：验收时按冻结 acceptance 自动收集（不经过 HTTP，agent 无法伪造）。
    // 上限 ≤5/卡/epoch；收集失败/超时只落一条 failed 证据，不挂起验收。
    await this.#autoCollect(card)
    const [todo, evidence, retries, receipt] = await Promise.all([
      this.#deps.todo.read(caseId),
      this.#deps.evidence.read(caseId),
      this.#retriesOf(caseId),
      this.#receiptOf(caseId),
    ])
    // D：只认当前 epoch 的证据，旧 epoch 只作历史。
    const epoch = card.evidenceEpoch ?? 0
    const current = evidence.records.filter((record) => (record.epoch ?? 0) === epoch)
    const outcome = verifyCard({ card, todo, evidence: current, retries, receipt })
    await this.#applyOutcome(card, outcome, retries)
    return outcome
  }

  async #applyOutcome(card: Card, outcome: VerificationOutcome, retries: number): Promise<void> {
    const base = {
      cardId: card.id,
      actor: 'verifier' as const,
      authority: 'system' as const,
      reason: outcome.reason,
    }
    if (outcome.verified === 'confirmed') {
      // status 由 transition 按投递状态一起落（shared/case.ts::statusForDelivery）。
      await this.#deps.apply({ ...base, to: 'confirmed', waitReason: null })
      return
    }
    if (outcome.action === 'continue-session' && retries < MAX_CONTINUE) {
      // B 类：退回队列，让会话补更新清单（只给一次）。
      await this.#deps.apply({
        ...base,
        to: 'failed',
        waitReason: null,
        meta: { verifyRetry: true },
      })
      await this.#deps.apply({
        ...base,
        to: 'waiting',
        actor: 'scheduler',
        reason: '清单落后于实际，退回会话补更新',
        waitReason: 'queued',
      })
      this.#deps.log?.(`验收返工：${card.id}（清单落后，已退回会话）`)
      return
    }
    if (outcome.action === 'retry') {
      await this.#deps.apply({ ...base, to: 'failed', waitReason: null })
      await this.#deps.apply({
        ...base,
        to: 'waiting',
        actor: 'scheduler',
        reason: '证据不通过，自动重试一次',
        waitReason: 'retrying',
      })
      return
    }
    if (outcome.verified === 'unknown' && outcome.action === 'escalate' && outcome.semanticNeeded) {
      await this.#deps.apply({ ...base, to: 'unknown', waitReason: null })
      await this.#openSemanticTicket(card, outcome)
      return
    }
    if (outcome.verified === 'unknown' && outcome.action === 'escalate') {
      await this.#deps.apply({ ...base, to: 'unknown', waitReason: null })
      await noteCase(
        { cards: this.#deps.cards, journal: this.#deps.journal },
        {
          cardId: card.id,
          waitReason: 'awaiting-user-escalation',
          reason: `验收升级：${outcome.reason}`,
        },
      )
      return
    }
    await this.#deps.apply({ ...base, to: 'unknown', waitReason: null })
  }
}
