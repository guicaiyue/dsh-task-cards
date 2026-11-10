// 对账（M1 确定性部分）：被同会话更新的同类卡取代 → 旧卡失效，可重开。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { Store } from '../../src/host/cards/store'
import { Journal } from '../../src/host/kernel/journal'
import { applyTransition } from '../../src/host/kernel/transition'
import { reconcileCards } from '../../src/host/reconcile/reconcile'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-rec-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const journal = new Journal(path.join(dir, 'journal'))
  const apply = (req: Parameters<typeof applyTransition>[1]) =>
    applyTransition({ cards, journal }, req)
  const reconcile = (exists?: (target: string) => Promise<boolean>) =>
    reconcileCards({ getCards: () => cards.list(), apply, ...(exists ? { exists } : {}) })
  return { cards, journal, apply, reconcile }
}

async function card(cards: Store, title: string, sessionId: string, createdAt: number) {
  const created = await cards.create(title, {
    kind: 'decision',
    source: 'agent',
    origin: { sessionId, turn: 1 },
  })
  await cards.patch(created.id, { createdAt }, 'seed')
  return cards.find(created.id) as NonNullable<ReturnType<Store['find']>>
}

describe('按产物存在性失效（失败/过期卡）', () => {
  async function failedCard(cards: Store, artifacts: string[], effect?: 'destructive' | 'spend') {
    const created = await cards.create('记录 settings 持久化重试再次失败', {
      kind: 'info',
      source: 'agent',
      origin: { sessionId: 's-1', turn: 20 },
      artifacts,
    })
    if (effect) await cards.patch(created.id, { advice: { effect } as never }, 'seed')
    return cards.find(created.id) as NonNullable<ReturnType<Store['find']>>
  }

  it('产物全部已存在 → 自动失效（reason=artifacts-exist，可重开）', async () => {
    const { cards, reconcile } = setup()
    const card = await failedCard(cards, ['lib/remote_settings.dart', 'lib/get_settings.dart'])
    const summary = await reconcile(async () => true)
    expect(summary.invalidated.map((item) => item.id)).toEqual([card.id])
    expect(summary.invalidated[0]?.reason).toContain('artifacts-exist')
    const after = cards.find(card.id)
    expect(after?.deliveryState).toBe('invalidated')
    expect(after?.status).toBe('dismissed')
  })

  it('产物不全 → 不动', async () => {
    const { cards, reconcile } = setup()
    const card = await failedCard(cards, ['a.dart', 'b.dart'])
    const summary = await reconcile(async (target) => target === 'a.dart')
    expect(summary.invalidated).toHaveLength(0)
    expect(cards.find(card.id)?.deliveryState).not.toBe('invalidated')
  })

  it('没有 artifacts / destructive 类卡 → 不自动失效', async () => {
    const { cards, reconcile } = setup()
    const plain = await cards.create('失败但没给产物路径', {
      kind: 'info',
      source: 'agent',
      origin: { sessionId: 's-1' },
    })
    const destructive = await failedCard(cards, ['migrations/x.sql'], 'destructive')
    const summary = await reconcile(async () => true)
    expect(summary.invalidated).toHaveLength(0)
    expect(cards.find(plain.id)?.deliveryState).not.toBe('invalidated')
    expect(cards.find(destructive.id)?.deliveryState).not.toBe('invalidated')
  })
})

describe('对账', () => {
  it('同会话、同标题、新卡已结束 → 旧卡失效并留证据', async () => {
    const { cards, reconcile } = setup()
    const older = await card(cards, '整理发布说明', 's-1', 1000)
    const newer = await card(cards, '整理 发布说明', 's-1', 2000)
    await cards.patch(newer.id, { deliveryState: 'confirmed' }, 'seed')

    const summary = await reconcile()
    expect(summary.scanned).toBe(2)
    expect(summary.invalidated.map((x) => x.id)).toEqual([older.id])
    expect(summary.invalidated[0]?.reason).toContain(`superseded-by:${newer.id}`)
    expect(cards.find(older.id)?.deliveryState).toBe('invalidated')
    expect(cards.find(older.id)?.invalidatedReason).toContain('superseded')
  })

  it('不同会话或新卡未结束 → 不动', async () => {
    const { cards, reconcile } = setup()
    const a = await card(cards, '同一件事', 's-1', 1000)
    const otherSession = await card(cards, '同一件事', 's-2', 2000)
    await cards.patch(otherSession.id, { deliveryState: 'confirmed' }, 'seed')
    const unfinished = await card(cards, '同一件事', 's-1', 3000)

    const summary = await reconcile()
    expect(summary.invalidated).toHaveLength(0)
    expect(cards.find(a.id)?.deliveryState).not.toBe('invalidated')
    expect(cards.find(unfinished.id)?.deliveryState).not.toBe('invalidated')
  })

  it('失效后可重开（用户角色）', async () => {
    const { cards, apply, reconcile } = setup()
    const older = await card(cards, '重复卡', 's-1', 1000)
    const newer = await card(cards, '重复卡', 's-1', 2000)
    await cards.patch(newer.id, { deliveryState: 'confirmed' }, 'seed')
    await reconcile()

    const reopened = await apply({
      cardId: older.id,
      to: 'idle',
      actor: 'user',
      authority: 'user',
      reason: '误判，重开',
      expectedSeq: cards.find(older.id)?.decisionSeq ?? 0,
    })
    expect(reopened.card.deliveryState).toBe('idle')
    expect(reopened.card.invalidatedReason).toBeNull()
  })
})
