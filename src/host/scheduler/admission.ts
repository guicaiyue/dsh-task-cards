// 准入：WIP=1、非抢占、租约。只回答「现在能不能派这张卡」。
//
// 租约存在内存里；重启后内存为空，所有 leased 卡会被当作过期回收
// （对应 A-core 的启动短路：leased 且无 attempt → 重排）。

import { pickWaitReason } from '../../shared/case'
import type { WaitReason } from '../../shared/case-contract'
import type { Card } from '../../shared/contract'
import { inFlightOf } from './queue'

export const LEASE_TTL_MS = 90_000

export interface AdmissionOptions {
  wipLimit?: number
  leaseTtlMs?: number
  now?: () => number
}

export interface AdmissionDecision {
  ok: boolean
  reason?: WaitReason
}

export class Admission {
  readonly wipLimit: number
  readonly leaseTtlMs: number
  readonly #now: () => number
  readonly #leases = new Map<string, number>()

  constructor(options: AdmissionOptions = {}) {
    this.wipLimit = options.wipLimit ?? 1
    this.leaseTtlMs = options.leaseTtlMs ?? LEASE_TTL_MS
    this.#now = options.now ?? Date.now
  }

  reserve(cardId: string): void {
    this.#leases.set(cardId, this.#now())
  }

  release(cardId: string): void {
    this.#leases.delete(cardId)
  }

  /** 过期租约：内存里没有记录（重启）或超过 TTL。 */
  expired(cards: readonly Card[]): string[] {
    const now = this.#now()
    return cards
      .filter((card) => card.deliveryState === 'leased')
      .filter((card) => {
        const at = this.#leases.get(card.id)
        return at === undefined || now - at > this.leaseTtlMs
      })
      .map((card) => card.id)
  }

  /** 这张卡现在能不能派；不能则给一个可解释的原因。 */
  decide(card: Card, cards: readonly Card[]): AdmissionDecision {
    if (card.deliveryState !== 'waiting') return { ok: false, reason: 'queued' }
    const sessionId = card.origin?.sessionId
    if (!sessionId) return { ok: true }
    const inFlight = inFlightOf(cards, sessionId).filter((other) => other.id !== card.id)
    if (!inFlight.length) return { ok: true }
    const reasons: WaitReason[] = inFlight.map((other) =>
      other.deliveryState === 'dispatched' ? 'awaiting-receipt' : 'wip-limit',
    )
    return { ok: false, reason: pickWaitReason(reasons) ?? 'wip-limit' }
  }
}
