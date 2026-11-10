// 旧卡迁移：补 traceId / deliveryState / decisionSeq，并留一条 migrate 事件。
//
// 幂等：已经有 traceId 与 deliveryState 的卡直接跳过。
// 迁移前先备份 cards.json，回滚只需把备份覆盖回去。

import fsp from 'node:fs/promises'
import path from 'node:path'
import type { CaseEvent } from '../../shared/case'
import type { Card, DeliveryState } from '../../shared/contract'
import type { Store } from '../cards/store'
import type { Journal } from './journal'
import { newTraceId } from './transition'

/** 幂等补齐 Card.decision（阶段 A：51 张旧卡 0/51 落盘）。 */
export async function migrateDecisions(deps: { cards: Store }): Promise<{ filled: number }> {
  let filled = 0
  for (const card of deps.cards.list()) {
    if (card.decision) continue
    await deps.cards.patch(card.id, {}, 'case:migrate-decision')
    filled += 1
  }
  return { filled }
}

export interface MigrateDeps {
  cards: Store
  journal: Journal
  now?: () => number
  nextId?: () => string
}

export interface MigrateResult {
  migrated: string[]
  skipped: number
  backup?: string
}

/** 旧 status → 新投递状态的映射；映射不到就留在 idle（不需要计划）。 */
export function legacyStateOf(card: Card): DeliveryState {
  if (card.status === 'scheduled') return 'waiting'
  if (card.status === 'done') return 'confirmed'
  return 'idle'
}

function needsMigration(card: Card): boolean {
  return !card.traceId || !card.deliveryState
}

/** 迁移所有旧卡；返回迁移了哪些、跳过了多少、备份落在哪。 */
export async function migrateCards(deps: MigrateDeps): Promise<MigrateResult> {
  const now = deps.now ?? Date.now
  const nextId = deps.nextId ?? (() => `e-migrate-${Math.random().toString(36).slice(2, 8)}`)
  const cards = deps.cards.list()
  const targets = cards.filter(needsMigration)
  if (!targets.length) return { migrated: [], skipped: cards.length }

  const backup = `${deps.cards.file}.bak-${now()}`
  await fsp.copyFile(deps.cards.file, backup).catch(() => undefined)

  const migrated: string[] = []
  for (const card of targets) {
    const traceId = card.traceId || newTraceId(now(), Math.random())
    const deliveryState = card.deliveryState ?? legacyStateOf(card)
    const seq = card.decisionSeq ?? 0
    const event: CaseEvent = {
      id: nextId(),
      caseId: card.id,
      traceId,
      at: now(),
      phase: deliveryState === 'confirmed' ? 'closed' : 'sense',
      from: 'idle',
      to: deliveryState,
      actor: 'system',
      authority: 'system',
      reason: 'migrate: 补齐 traceId 与投递状态',
      evidenceRefs: [],
      policyVersion: 3,
      meta: { migration: true, legacyStatus: card.status },
    }
    await deps.journal.append(event)
    await deps.cards.patch(
      card.id,
      { traceId, deliveryState, decisionSeq: seq + 1 },
      'case:migrate',
    )
    migrated.push(card.id)
  }
  return { migrated, skipped: cards.length - targets.length, backup }
}

/** 迁移目录：与 cards.json 同级的 journal/。 */
export function journalDirOf(cardsFile: string): string {
  return path.join(path.dirname(cardsFile), 'journal')
}
