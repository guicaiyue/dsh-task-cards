// 执行回执：dispatched 只是「话投出去了」，回执（origin 会话又跑完一轮）才落 executed。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { Store } from '../../src/host/cards/store'
import { ReceiptTracker } from '../../src/host/execution/receipt'
import { Journal } from '../../src/host/kernel/journal'
import { applyTransition } from '../../src/host/kernel/transition'
import type { Card } from '../../src/shared/contract'

type Handler = (...args: unknown[]) => void

function setup(over: { timeoutMs?: number } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-receipt-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const journal = new Journal(path.join(dir, 'journal'))
  let clock = 1_700_000_000_000
  const apply = (req: Parameters<typeof applyTransition>[1]) =>
    applyTransition({ cards, journal, now: () => clock }, req)
  const verified: string[] = []
  const tracker = new ReceiptTracker({
    cards,
    journal,
    apply,
    log: () => {},
    now: () => clock,
    timeoutMs: over.timeoutMs ?? 60_000,
    verify: async (id: string) => {
      verified.push(id)
    },
  })
  const handlers = new Map<string, Handler>()
  const root = {
    on(type: string, handler: Handler) {
      handlers.set(type, handler)
      return () => handlers.delete(type)
    },
  }
  return {
    cards,
    journal,
    apply,
    tracker,
    handlers,
    root,
    verified,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const session = { id: 's-1' }

function feed(handlers: Map<string, Handler>, event: Record<string, unknown>): void {
  handlers.get('session/event')?.(session, event)
}

function idle(handlers: Map<string, Handler>): void {
  handlers.get('agent/status')?.({ agent: { id: 's-1' }, status: 'idle' })
}

async function until(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error(`等待超时：${label}`)
}

const message = (text: string, turn: number) => ({
  type: 'assistant/message',
  data: { turn, message: { content: [{ type: 'text', text }] } },
})

/** 造一张已派发的卡：dispatched 事件的 meta.turn 是派发时的回合号。 */
async function dispatched(
  cards: Store,
  apply: (req: Parameters<typeof applyTransition>[1]) => Promise<unknown>,
  turn = 1,
): Promise<Card> {
  const card = await cards.create('跑测试并提交', {
    kind: 'decision',
    source: 'agent',
    origin: { sessionId: 's-1', turn },
  })
  for (const [to, actor] of [
    ['waiting', 'scheduler'],
    ['leased', 'scheduler'],
  ] as const) {
    await apply({ cardId: card.id, to, actor, authority: 'system', reason: to })
  }
  await apply({
    cardId: card.id,
    to: 'dispatched',
    actor: 'scheduler',
    authority: 'system',
    reason: '已派发，等回执',
    meta: { turn },
  })
  return (await cards.find(card.id)) as Card
}

describe('执行回执', () => {
  it('回执到（origin 会话 idle 且 turn 前进 + 回复非空）→ executed，并在之后触发一次验收', async () => {
    const { cards, apply, tracker, handlers, root, verified } = setup()
    const card = await dispatched(cards, apply, 1)
    await tracker.attach(root)

    feed(handlers, message('改完了，测试全绿', 2))
    idle(handlers)

    await until(() => cards.find(card.id)?.deliveryState === 'executed', '落 executed')
    await until(() => verified.length === 1, '之后触发一次验收')
    expect(verified).toEqual([card.id])
  })

  it('两次 idle 不重复验收（幂等）', async () => {
    const { cards, apply, tracker, handlers, root, verified } = setup()
    const card = await dispatched(cards, apply, 1)
    await tracker.attach(root)
    feed(handlers, message('改完了', 2))
    idle(handlers)
    idle(handlers)
    idle(handlers)
    await until(() => verified.length > 0, '第一次验收')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(verified).toEqual([card.id])
  })

  it('turn 没前进的 idle 不算回执：仍停在 dispatched', async () => {
    const { cards, apply, tracker, handlers, root, verified } = setup()
    const card = await dispatched(cards, apply, 3)
    await tracker.attach(root)
    feed(handlers, message('同一个回合的旧回复', 3))
    idle(handlers)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(cards.find(card.id)?.deliveryState).toBe('dispatched')
    expect(verified).toEqual([])
  })

  it('超过 TTL 没回执 → failed/no-receipt，并留 lastError', async () => {
    const { cards, apply, tracker, root, advance } = setup({ timeoutMs: 1_000 })
    const card = await dispatched(cards, apply, 1)
    await tracker.attach(root)
    advance(2_000)
    await tracker.sweep()
    const after = cards.find(card.id)
    expect(after?.deliveryState).toBe('failed')
    expect(after?.lastError).toContain('no-receipt')
    expect(after?.waitReason).toBe('awaiting-user-escalation')
  })

  it('回执回合回复为空 → failed/empty-reply，不冒充完成', async () => {
    const { cards, apply, tracker, handlers, root } = setup()
    const card = await dispatched(cards, apply, 1)
    await tracker.attach(root)
    feed(handlers, message('', 2))
    idle(handlers)
    await until(() => cards.find(card.id)?.deliveryState === 'failed', '判失败')
    await until(() => Boolean(cards.find(card.id)?.lastError), '留 lastError')
    expect(cards.find(card.id)?.lastError).toContain('empty-reply')
  })

  it('origin 会话报错 → failed/receipt-error', async () => {
    const { cards, apply, tracker, handlers, root } = setup()
    const card = await dispatched(cards, apply, 1)
    await tracker.attach(root)
    handlers.get('agent/error')?.({ agent: { id: 's-1' }, error: { message: 'boom' } })
    await until(() => cards.find(card.id)?.deliveryState === 'failed', '报错失败')
    await until(() => Boolean(cards.find(card.id)?.lastError), '留 lastError')
    expect(cards.find(card.id)?.lastError).toContain('receipt-error')
  })

  it('重启恢复：attach 从 journal 的 dispatched 事件 meta.turn 找回在飞回执', async () => {
    const { cards, apply, tracker, handlers, root, verified } = setup()
    const card = await dispatched(cards, apply, 4)
    // 没有任何 track() 调用：恢复只能来自 journal 里 dispatched 事件的 meta.turn。
    const restored = await tracker.attach(root)
    expect(restored).toBe(1)
    // 恢复出来的 dispatchedTurn=4：turn 5 的 idle 才算回执；turn 4 的不算。
    feed(handlers, message('还是派发时的回合', 4))
    idle(handlers)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(cards.find(card.id)?.deliveryState).toBe('dispatched')
    feed(handlers, message('继续跑完了', 5))
    idle(handlers)
    await until(() => verified.length === 1, '恢复后仍能结算回执')
    expect(cards.find(card.id)?.deliveryState).toBe('executed')
  })
})
