// 调度器：每 tick 扫一遍，决定派谁、等谁、回收谁的租约。
//
// 只做准入与派发，不做内容判断；状态变更一律走 kernel/transition。
// 派发成功后卡停在 dispatched 等回执（execution/receipt.ts），这里不落 executed、
// 也不触发验收——那两件事以「origin 会话确实又跑完一轮」为前提。

import type { ApprovedPlan, Card, DeliveryState } from '../../shared/contract'
import type { ExecutionAdapter } from '../execution/adapter'
import type { Log } from '../host-api'
import { asRecord, asString } from '../host-api'
import type { TransitionDeps } from '../kernel/transition'
import { applyTransition, noteCase } from '../kernel/transition'
import type { PlansStore } from '../plans/store'
import { Admission } from './admission'
import { handleFailure } from './failure'
import { orderCandidates } from './queue'
import { failuresOf, isPermanentError, nextRetryAt, shouldStopRetry } from './retry'

export interface ReceiptHooks {
  /** 派发时 origin 会话的回合号。 */
  currentTurn(sessionId: string): number
  /** 登记「等这个会话的下一次 idle」。 */
  track(cardId: string, sessionId: string, dispatchedTurn: number): void
}

export interface SchedulerDeps extends TransitionDeps {
  getCards: () => Card[]
  adapter: ExecutionAdapter
  log: Log
  admission?: Admission
  /** 阶段 C：plans.json 是唯一租约/attempt 账（重启可恢复）。 */
  plans?: PlansStore
  /** 时钟（测试注入；默认 Date.now）。 */
  now?: () => number
  /** 回执登记：dispatch 成功后由 execution/receipt.ts 结算。 */
  receipt?: ReceiptHooks
}

export interface TickResult {
  dispatched: string[]
  expired: string[]
  waiting: Array<{ id: string; reason: string }>
}

/**
 * 投递幂等键：同一张卡的同一次「入队」只能派一次。
 *
 * 基数是最后一次进入 waiting 的那条事件 id，而不是当前 decisionSeq——派发过程中
 * 会连推 leased/dispatched，seq 一路增长；用 seq 会让「崩溃恢复后回到 waiting」
 * 变成一个新键，重复派发照样发生。重开再批会重新入队（新的 waiting 事件），
 * 那时才允许再派一次。
 */
export function idempotencyKeyOf(cardId: string, waitingEventId: string | null): string {
  return `${cardId}:${waitingEventId ?? 'unknown'}`
}

export class Scheduler {
  readonly #deps: SchedulerDeps
  readonly admission: Admission
  #running = false

  constructor(deps: SchedulerDeps) {
    this.#deps = deps
    this.admission = deps.admission ?? new Admission()
  }

  /** 一次 tick：回收过期租约 → 逐个候选准入 → 派发。 */
  async tick(): Promise<TickResult> {
    if (this.#running) return { dispatched: [], expired: [], waiting: [] }
    this.#running = true
    try {
      return await this.#tick()
    } finally {
      this.#running = false
    }
  }

  async #tick(): Promise<TickResult> {
    const cards = this.#deps.getCards()
    const now = this.#deps.now ?? Date.now
    const result: TickResult = { dispatched: [], expired: [], waiting: [] }

    // 1) 回收过期租约：leased → waiting，原因 lease-expired。
    for (const id of this.admission.expired(cards)) {
      this.admission.release(id)
      await this.#move(id, 'waiting', 'lease-expired', '租约过期，重新排队')
      result.expired.push(id)
    }

    // 2) 阶段 C：恢复 plans.json 里的过期租约（重启后内存租约为空）。
    if (this.#deps.plans) {
      const stale = await this.#deps.plans.recoverStaleLeases(Date.now(), this.admission.leaseTtlMs)
      for (const planId of stale) {
        const plan = await this.#deps.plans.get(planId)
        if (!plan) continue
        const card = this.#deps.getCards().find((item) => item.id === plan.cardId)
        if (card?.deliveryState === 'leased') {
          await this.#move(card.id, 'waiting', 'lease-expired', '计划租约过期（plans.json 恢复）')
          result.expired.push(card.id)
        }
      }
    }

    // 3) 重新校验计划：卡已删除 → plan cancelled（真机删卡仍派发的自愈点）。
    for (const plan of (await this.#deps.plans?.list()) ?? []) {
      if (plan.cancelled || plan.failed) continue
      if (!cards.some((card) => card.id === plan.cardId))
        await this.#deps.plans?.cancel(plan.id, '卡已删除')
    }

    // 4) 准入：按优先级逐个尝试。每轮都重新读，否则同一 tick 里
    //    刚派出去的卡对后一张不可见，会一次派两张（WIP=1 失效）。
    const priorityOf = (card: Card): number => this.#deps.plans?.byCard(card.id)?.priority ?? 0
    for (const candidate of orderCandidates(this.#deps.getCards(), priorityOf)) {
      const snapshot = this.#deps.getCards()
      const card = snapshot.find((item) => item.id === candidate.id)
      if (!card || card.deliveryState !== 'waiting') continue
      // 阶段 C/D：已取消/已失败的 plan 不再消费；失败重试要走退避。
      const plan = this.#deps.plans?.byCard(card.id)
      if (plan && (plan.cancelled || plan.failed)) continue
      if (plan && failuresOf(plan) > 0 && now() < nextRetryAt(plan)) {
        if (card.waitReason !== 'retrying')
          await noteCase(this.#deps, {
            cardId: card.id,
            waitReason: 'retrying',
            reason: `失败退避中（第 ${failuresOf(plan)} 次失败，等 ${nextRetryAt(plan) - now()}ms）`,
          })
        result.waiting.push({ id: card.id, reason: 'retrying' })
        continue
      }
      if (plan?.dependsOn.length) {
        let blocked: string | null = null
        for (const depId of plan.dependsOn) {
          const outcome = (await this.#deps.plans?.outcomes(depId)) ?? []
          if (!outcome.some((item) => item.verified === 'confirmed')) blocked = depId
        }
        if (blocked) {
          if (card.waitReason !== 'depends-on')
            await noteCase(this.#deps, {
              cardId: card.id,
              waitReason: 'depends-on',
              reason: `等待依赖计划 ${blocked} 完成`,
            })
          result.waiting.push({ id: card.id, reason: `depends-on:${blocked}` })
          continue
        }
      }
      const decision = this.admission.decide(card, snapshot)
      if (!decision.ok) {
        const reason = decision.reason ?? 'queued'
        if (card.waitReason !== reason) {
          await noteCase(this.#deps, {
            cardId: card.id,
            waitReason: reason,
            reason: `等待放行：${reason}`,
          })
        }
        result.waiting.push({ id: card.id, reason })
        continue
      }
      await this.#dispatch(card, result)
    }
    return result
  }

  /** 派发一张卡：waiting → leased → dispatched，失败退回 waiting。 */
  async #dispatch(card: Card, result: TickResult): Promise<void> {
    const { adapter, log, receipt } = this.#deps
    const now = this.#deps.now ?? Date.now
    const dispatchKey = await this.#dispatchKeyOf(card)
    // 阶段 C：幂等键落 plan 级——attempt.id=dispatchKey，跨重启仍能认出已派过。
    const plan = this.#deps.plans?.byCard(card.id)
    if (plan?.attempts.some((attempt) => attempt.id === dispatchKey)) {
      log(`重复派发已阻止（plans.json）：${card.id}（attempt ${dispatchKey} 已存在）`)
      await noteCase(this.#deps, {
        cardId: card.id,
        waitReason: 'already-dispatched',
        reason: `幂等键 ${dispatchKey} 已在计划账本里派发过`,
      })
      return
    }
    if (await this.#alreadyDispatched(card, dispatchKey)) {
      log(`重复派发已阻止：${card.id}（幂等键 ${dispatchKey} 已派发过）`)
      // 不能只打日志：卡停在 waiting 也需要一个可解释的原因（否则是静默死路）。
      await noteCase(this.#deps, {
        cardId: card.id,
        waitReason: 'already-dispatched',
        reason: `幂等键 ${dispatchKey} 已派发过，停止重复投递`,
      })
      return
    }
    this.admission.reserve(card.id)
    try {
      if (plan) {
        await this.#deps.plans?.setLease(plan.id, {
          holder: card.id,
          acquiredAt: Date.now(),
          expiresAt: Date.now() + this.admission.leaseTtlMs,
        })
      }
      await this.#move(card.id, 'leased', null, '通过准入，落租约')
      let outcome: Awaited<ReturnType<typeof adapter.execute>>
      try {
        outcome = await adapter.execute(card)
      } catch (err) {
        // 适配器抛异常也必须落 attempt（审计：throw 路径 attempts=0 是漏洞）。
        const error = (err as Error)?.message || String(err)
        outcome = { accepted: false, error, permanent: isPermanentError(error) }
      }
      if (!outcome.accepted) {
        await handleFailure(
          {
            ...(this.#deps.plans ? { plans: this.#deps.plans } : {}),
            ...(this.#deps.now ? { now: this.#deps.now } : {}),
            log: this.#deps.log,
            createCard: (title, options) => this.#deps.cards.create(title, options as never),
            move: (cardId, to, waitReason, reason) => this.#move(cardId, to, waitReason, reason),
          },
          card,
          plan,
          dispatchKey,
          outcome,
        )
        return
      }
      // 派发成功只表示「话已投出去」：记下派发时的回合号，等 origin 会话下一次 idle。
      const sessionId = card.origin?.sessionId ?? ''
      const turn = receipt?.currentTurn(sessionId) ?? 0
      await this.#move(card.id, 'dispatched', 'awaiting-receipt', '已派发，等回执', {
        via: outcome.via,
        turn,
        idempotencyKey: dispatchKey,
      })
      if (plan) {
        await this.#deps.plans?.recordAttempt(plan.id, {
          id: dispatchKey,
          at: Date.now(),
          sessionId,
          result: 'dispatched',
          detail: `via=${outcome.via}`,
        })
        await this.#deps.plans?.setLease(plan.id, null)
      }
      receipt?.track(card.id, sessionId, turn)
      result.dispatched.push(card.id)
    } catch (err) {
      this.admission.release(card.id)
      log(`派发异常：${card.id} — ${(err as Error)?.message || String(err)}`)
    }
  }

  /** 这一次入队的幂等键：由最后一次 waiting 事件决定。 */
  async #dispatchKeyOf(card: Card): Promise<string> {
    const { events } = await this.#deps.journal.read(card.id)
    // 只看「真正迁移进 waiting」的事件：noteCase（等待原因备注）的 from===to===waiting，
    // 若把它算作入队事件，会悄悄换掉幂等键 → 重复派发（C 阶段发现的真实 bug）。
    const waiting = events
      .filter((event) => event.to === 'waiting' && event.from !== 'waiting')
      .pop()
    return idempotencyKeyOf(card.id, waiting?.id ?? null)
  }

  /** 这张卡的这个决定是否已经派发过（同一 key 只派一次）。 */
  async #alreadyDispatched(card: Card, key: string): Promise<boolean> {
    const { events } = await this.#deps.journal.read(card.id)
    return events.some(
      (event) => event.to === 'dispatched' && asString(asRecord(event.meta).idempotencyKey) === key,
    )
  }

  async #move(
    cardId: string,
    to: DeliveryState,
    waitReason: Card['waitReason'],
    reason: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await applyTransition(this.#deps, {
      cardId,
      to,
      actor: 'scheduler',
      authority: 'system',
      reason,
      waitReason: waitReason ?? null,
      ...(meta ? { meta } : {}),
    })
  }
}
