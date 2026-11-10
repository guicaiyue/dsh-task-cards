// 对账（确定性部分）：只按可核对的事实失效，不做猜测。
//
// 两条判据：① 被同会话更新的同类卡取代；② 卡上列的产物（artifacts）全部已存在——
// 说明「失败/没做完」的结论已经过期。destructive/spend 类卡不自动失效，只能提议。

import fsp from 'node:fs/promises'

import type { Card } from '../../shared/contract'
import type { Log } from '../host-api'
import type { TransitionOutcome, TransitionRequest } from '../kernel/transition'

export interface ReconcileDeps {
  getCards: () => Card[]
  apply: (req: TransitionRequest) => Promise<TransitionOutcome>
  log?: Log
  /** 产物是否存在（测试可注入）。 */
  exists?: (path: string) => Promise<boolean>
}

export interface ReconcileSummary {
  scanned: number
  invalidated: Array<{ id: string; reason: string }>
  stale: string[]
  unchanged: number
}

function normalize(title: string): string {
  return title.replace(/\s+/g, '').toLowerCase()
}

function isFinished(card: Card): boolean {
  return card.deliveryState === 'confirmed' || card.deliveryState === 'failed'
}

async function defaultExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

/** destructive / spend 类卡不自动失效：这类结论必须由人确认（设计 TODO-RECONCILE §5.5）。 */
function autoInvalidatable(card: Card): boolean {
  const effect = card.advice?.effect
  return effect !== 'destructive' && effect !== 'spend'
}

/** 产物全存在 → 这张卡（「做失败了 / 还没做完」）已经过期，可直接失效。 */
async function artifactInvalidation(
  deps: ReconcileDeps,
  card: Card,
  exists: (path: string) => Promise<boolean>,
): Promise<string | null> {
  if (!card.artifacts?.length || !autoInvalidatable(card)) return null
  const found = await Promise.all(card.artifacts.map((target) => exists(target)))
  if (!found.every(Boolean)) return null
  void deps
  return `artifacts-exist:${card.artifacts.join(', ')}`
}

/** 同会话、同标题、更新的卡已结束 → 旧卡失效（可重开）。 */
export async function reconcileCards(deps: ReconcileDeps): Promise<ReconcileSummary> {
  const cards = deps.getCards()
  const summary: ReconcileSummary = {
    scanned: cards.length,
    invalidated: [],
    stale: [],
    unchanged: 0,
  }
  const open = cards.filter(
    (card) => card.deliveryState !== 'invalidated' && !card.invalidatedReason,
  )

  const exists = deps.exists ?? defaultExists
  for (const card of open) {
    const byArtifact = await artifactInvalidation(deps, card, exists)
    if (byArtifact) {
      await deps.apply({
        cardId: card.id,
        to: 'invalidated',
        actor: 'system',
        authority: 'system',
        reason: byArtifact,
        expectedSeq: card.decisionSeq ?? 0,
        evidenceRefs: card.artifacts ?? [],
      })
      summary.invalidated.push({ id: card.id, reason: byArtifact })
      deps.log?.(`对账失效：${card.id} → ${byArtifact}`)
      continue
    }
    const newer = cards
      .filter(
        (other) =>
          other.id !== card.id &&
          other.origin?.sessionId === card.origin?.sessionId &&
          other.createdAt > card.createdAt &&
          normalize(other.title) === normalize(card.title) &&
          isFinished(other),
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0]

    if (!newer) {
      summary.unchanged += 1
      continue
    }
    const reason = `superseded-by:${newer.id}（同会话更新的同类卡已结束）`
    await deps.apply({
      cardId: card.id,
      to: 'invalidated',
      actor: 'system',
      authority: 'system',
      reason,
      expectedSeq: card.decisionSeq ?? 0,
      evidenceRefs: [`card:${newer.id}`],
    })
    summary.invalidated.push({ id: card.id, reason })
    deps.log?.(`对账失效：${card.id} → ${reason}`)
  }
  return summary
}
