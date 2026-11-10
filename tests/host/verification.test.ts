// 验收：纯判断规则 + 落到状态机的执行器。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Store } from '../../src/host/cards/store'
import { EvidenceStore } from '../../src/host/evidence/store'
import { Journal } from '../../src/host/kernel/journal'
import { applyTransition } from '../../src/host/kernel/transition'
import { TodoStore } from '../../src/host/todo/store'
import { Verifier } from '../../src/host/verification/verifier'
import { verifyCard } from '../../src/host/verification/verify'
import type { Card } from '../../src/shared/contract'
import type { EvidenceRecord } from '../../src/shared/evidence'
import type { TodoList } from '../../src/shared/todo'

function todoOf(items: TodoList['items'], frozen = true): TodoList {
  return {
    caseId: 'c-1',
    items,
    baselineIds: items.filter((item) => !item.parentId).map((item) => item.id),
    frozen,
    revision: 1,
    updatedAt: 1,
  }
}

function item(id: string, status: TodoList['items'][number]['status'], over = {}) {
  return { id, text: id, status, updatedAt: 1, ...over }
}

function evidence(ok: boolean, level: EvidenceRecord['level'] = 'E2'): EvidenceRecord {
  return {
    id: `ev-${ok ? 'ok' : 'bad'}-${level}`,
    caseId: 'c-1',
    at: 1,
    spec: { kind: 'file', path: '/x', expect: 'exists' },
    ok,
    level,
    sourceRef: 'plan#check',
    detail: ok ? '存在' : '不存在',
    durationMs: 5,
  }
}

const CARD = { id: 'c-1', title: '跑测试并提交', origin: { sessionId: 's-1' } } as Card

describe('三级验收（R1：system / decision / user）', () => {
  const withAcceptance = (over: Record<string, unknown>) =>
    ({ ...CARD, acceptance: [{ id: 'sem', ...over }] }) as Card

  it('system 级：机器证据通过 → confirmed，verifier=system', () => {
    const card = withAcceptance({
      verifier: 'system',
      level: 'E2',
      spec: { kind: 'exit', cmd: 'pnpm test', expect: 0 },
    })
    const out = verifyCard({ card, todo: null, evidence: [evidence(true, 'E2')], retries: 0 })
    expect(out.verified).toBe('confirmed')
    expect(out.verifier).toBe('system')
    expect(out.semanticNeeded).toBe(false)
  })

  it('decision 级：语义项 → semanticNeeded + verifier=decision，消费后写 Outcome.verifier=model', async () => {
    const card = withAcceptance({
      verifier: 'decision',
      level: 'E2',
      spec: { kind: 'file', path: '/x', expect: 'exists' },
    })
    const out = verifyCard({ card, todo: null, evidence: [evidence(true, 'E2')], retries: 0 })
    expect(out.verified).toBe('unknown')
    expect(out.verifier).toBe('decision')
    expect(out.semanticNeeded).toBe(true)

    const { recordSemanticOutcome } = await import('../../src/host/verification/semantic')
    const written: Array<Record<string, unknown>> = []
    const ticket = {
      ...card,
      semantic: { planId: 'p-1', verifier: 'decision', sourceCardId: 'c-1', criteria: ['sem'] },
      advice: { verdict: 'approve' },
    } as never
    const ok = await recordSemanticOutcome(
      { recordOutcome: async (o) => written.push(o as never) },
      ticket,
      'approve',
    )
    expect(ok).toBe(true)
    expect(written[0]?.verifier).toBe('model')
    expect(written[0]?.verified).toBe('confirmed')
  })

  it('user 级：destructive 强制用户拍板 → verifier=user，消费后 Outcome.verifier=user', async () => {
    const card = {
      ...withAcceptance({
        verifier: 'decision',
        level: 'E3',
        spec: { kind: 'exit', cmd: 'rm -rf /tmp/x', expect: 0 },
      }),
      advice: { effect: 'destructive' },
    } as Card
    const out = verifyCard({ card, todo: null, evidence: [], retries: 0 })
    expect(out.verified).toBe('unknown')
    expect(out.verifier).toBe('user')
    expect(out.semanticNeeded).toBe(true)

    const { recordSemanticOutcome } = await import('../../src/host/verification/semantic')
    const written: Array<Record<string, unknown>> = []
    const ticket = {
      ...card,
      semantic: { planId: 'p-2', verifier: 'user', sourceCardId: 'c-1', criteria: ['sem'] },
    } as never
    await recordSemanticOutcome(
      { recordOutcome: async (o) => written.push(o as never) },
      ticket,
      'approve',
    )
    expect(written[0]?.verifier).toBe('user')
    expect(written[0]?.verified).toBe('confirmed')
  })
})

describe('todo 三类分流（阶段 D，D3）', () => {
  it('A 异常中断：无回执无证据 → unknown/inconclusive，原因标「执行中断」', () => {
    const out = verifyCard({ card: CARD, todo: null, evidence: [], retries: 0 })
    expect(out.verified).toBe('unknown')
    expect(out.action).toBe('inconclusive')
    expect(out.reason).toContain('执行中断（A 类')
  })

  it('B 正常结束但忘更新：只给一次对账机会，第二次转升级', () => {
    const todo = todoOf([item('a', 'done'), item('b', 'doing')])
    const first = verifyCard({ card: CARD, todo, evidence: [], retries: 0 })
    expect(first.action).toBe('continue-session')
    expect(first.reason).toContain('1/1')
    const second = verifyCard({ card: CARD, todo, evidence: [], retries: 1 })
    expect(second.action).toBe('escalate')
  })

  it('C 代价变高/被阻塞 → 交决策者评估（继续/缩小/终止）', () => {
    const out = verifyCard({
      card: CARD,
      todo: todoOf([item('a', 'blocked', { blocker: '超出范围' })]),
      evidence: [],
      retries: 0,
    })
    expect(out.verified).toBe('unknown')
    expect(out.action).toBe('escalate')
    expect(out.reason).toContain('继续/缩小/终止')
  })
})

describe('验收规则（阶段 D：按 effect 选最低证据级）', () => {
  it('destructive 卡：E2 证据不足 → 不 confirmed；E3 才 confirmed', () => {
    const destructive = {
      ...CARD,
      advice: { effect: 'destructive' } as never,
    } as Card
    const todo = todoOf([item('a', 'done')])
    const withE2 = verifyCard({
      card: destructive,
      todo,
      evidence: [evidence(true, 'E2')],
      retries: 0,
    })
    expect(withE2.verified).not.toBe('confirmed')
    const withE3 = verifyCard({
      card: destructive,
      todo,
      evidence: [evidence(true, 'E3')],
      retries: 0,
    })
    expect(withE3.verified).toBe('confirmed')
  })

  it('spend 卡要 E4；write-code 最低 E2', () => {
    const spend = { ...CARD, advice: { effect: 'spend' } as never } as Card
    const todo = todoOf([item('a', 'done')])
    expect(
      verifyCard({ card: spend, todo, evidence: [evidence(true, 'E3')], retries: 0 }).verified,
    ).not.toBe('confirmed')
    expect(
      verifyCard({ card: spend, todo, evidence: [evidence(true, 'E4')], retries: 0 }).verified,
    ).toBe('confirmed')
    const write = { ...CARD, advice: { effect: 'write-code' } as never } as Card
    expect(
      verifyCard({ card: write, todo, evidence: [evidence(true, 'E1')], retries: 0 }).verified,
    ).not.toBe('confirmed')
    expect(
      verifyCard({ card: write, todo, evidence: [evidence(true, 'E2')], retries: 0 }).verified,
    ).toBe('confirmed')
  })
})

describe('验收规则', () => {
  it('清单项被阻塞 / 代价变高 → 不判失败，交决策者', () => {
    const blocked = verifyCard({
      card: CARD,
      todo: todoOf([item('a', 'blocked', { blocker: '超出范围' })]),
      evidence: [],
      retries: 0,
    })
    expect(blocked.verified).toBe('unknown')
    expect(blocked.action).toBe('escalate')

    const costly = verifyCard({
      card: CARD,
      todo: todoOf([item('a', 'doing', { cost: { delta: 'up', reason: '要改架构' } })]),
      evidence: [],
      retries: 0,
    })
    expect(costly.action).toBe('escalate')
  })

  it('证据不通过：先重试一次，再升级', () => {
    const first = verifyCard({ card: CARD, todo: null, evidence: [evidence(false)], retries: 0 })
    expect(first.verified).toBe('failed')
    expect(first.action).toBe('retry')

    const again = verifyCard({ card: CARD, todo: null, evidence: [evidence(false)], retries: 1 })
    expect(again.action).toBe('escalate')
  })

  it('清单没做完：先让会话补更新，只给一次', () => {
    const todo = todoOf([item('a', 'done'), item('b', 'pending')])
    const first = verifyCard({ card: CARD, todo, evidence: [], retries: 0 })
    expect(first.verified).toBe('failed')
    expect(first.action).toBe('continue-session')

    const again = verifyCard({ card: CARD, todo, evidence: [], retries: 1 })
    expect(again.action).toBe('escalate')
  })

  it('清单完成 + 证据全过 → 确认', () => {
    const outcome = verifyCard({
      card: CARD,
      todo: todoOf([item('a', 'done'), item('b', 'done')]),
      evidence: [evidence(true)],
      retries: 0,
    })
    expect(outcome.verified).toBe('confirmed')
    expect(outcome.action).toBe('close')
    expect(outcome.criteria).toHaveLength(1)
  })

  it('没有清单也没有证据 → 判不了，交人/决策者', () => {
    const outcome = verifyCard({ card: CARD, todo: null, evidence: [], retries: 0 })
    expect(outcome.verified).toBe('unknown')
    expect(outcome.action).toBe('inconclusive')
    expect(outcome.semanticNeeded).toBe(true)
  })

  it('决策卡没有清单/证据也没有回执 → 判不了（不按 kind 白名单放行）', () => {
    const decision = { ...CARD, kind: 'decision' } as Card
    const outcome = verifyCard({ card: decision, todo: null, evidence: [], retries: 0 })
    expect(outcome.verified).toBe('unknown')
    expect(outcome.action).toBe('inconclusive')
  })

  it('回执成立（派发后会话又跑完一轮、回复非空）→ confirmed，不要求 E2 产物', () => {
    const decision = { ...CARD, kind: 'decision' } as Card
    const outcome = verifyCard({
      card: decision,
      todo: null,
      evidence: [],
      retries: 0,
      receipt: {
        planId: CARD.id,
        executor: 'session',
        status: 'succeeded',
        dispatchedTurn: 1,
        receiptTurn: 2,
        replyChars: 120,
        durationMs: 1000,
        at: 1,
      },
    })
    expect(outcome.verified).toBe('confirmed')
    expect(outcome.action).toBe('close')
    expect(outcome.semanticNeeded).toBe(false)
    expect(outcome.reason).toContain('回执')
  })

  it('回执回合回复为空 → 不算回执', () => {
    const decision = { ...CARD, kind: 'decision' } as Card
    const outcome = verifyCard({
      card: decision,
      todo: null,
      evidence: [],
      retries: 0,
      receipt: {
        planId: CARD.id,
        executor: 'session',
        status: 'succeeded',
        dispatchedTurn: 1,
        receiptTurn: 2,
        replyChars: 0,
        durationMs: 1000,
        at: 1,
      },
    })
    expect(outcome.verified).toBe('unknown')
  })
})

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-verify-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const journal = new Journal(path.join(dir, 'journal'))
  const todo = new TodoStore({ dir: path.join(dir, 'todo') })
  const evidenceStore = new EvidenceStore({ dir: path.join(dir, 'evidence') })
  const apply = (req: Parameters<typeof applyTransition>[1]) =>
    applyTransition({ cards, journal }, req)
  const verifier = new Verifier({ cards, journal, todo, evidence: evidenceStore, apply })
  const card = await cards.create('验收卡', {
    kind: 'decision',
    source: 'agent',
    origin: { sessionId: 's-1', turn: 1 },
  })
  for (const [to, actor] of [
    ['waiting', 'scheduler'],
    ['leased', 'scheduler'],
    ['dispatched', 'executor'],
    ['executed', 'executor'],
  ] as const) {
    await apply({ cardId: card.id, to, actor, authority: 'system', reason: to })
  }
  return { cards, journal, todo, evidenceStore, apply, verifier, id: card.id }
}

describe('验收执行器', () => {
  it('只有 E1 证据（自述/旧数据）→ 不得 confirmed', async () => {
    const { verifier, id, todo, evidenceStore } = await setup()
    await todo.apply(
      id,
      [
        { type: 'add', id: 't1', text: '跑测试' },
        { type: 'update', id: 't1', status: 'done' },
        { type: 'freeze' },
      ],
      'executor',
    )
    await evidenceStore.append(evidence(true, 'E1'))
    const outcome = await verifier.verify(id)
    expect(outcome?.verified).not.toBe('confirmed')
  })

  it('清单全绿但零证据 → 不得 confirmed（执行者自证不算验收）', async () => {
    const { verifier, id, todo } = await setup()
    await todo.apply(
      id,
      [
        { type: 'add', id: 't1', text: '跑测试' },
        { type: 'update', id: 't1', status: 'done' },
        { type: 'freeze' },
      ],
      'executor',
    )
    const outcome = await verifier.verify(id)
    expect(outcome?.verified).toBe('unknown')
  })

  it('清单完成 + 证据通过 → confirmed，并留验收事件', async () => {
    const { cards, journal, todo, evidenceStore, verifier, id } = await setup()
    await todo.apply(
      id,
      [
        { type: 'add', id: 't1', text: '跑测试' },
        { type: 'update', id: 't1', status: 'done' },
        { type: 'freeze' },
      ],
      'executor',
    )
    await evidenceStore.append({ ...evidence(true), caseId: id })

    const outcome = await verifier.verify(id)
    expect(outcome?.verified).toBe('confirmed')
    expect(cards.find(id)?.deliveryState).toBe('confirmed')
    const { events } = await journal.read(id)
    expect(events.some((event) => event.to === 'verifying')).toBe(true)
    expect(events.some((event) => event.to === 'confirmed')).toBe(true)
  })

  it('清单落后：退回队列并标记 verifyRetry（只一次）', async () => {
    const { cards, journal, todo, verifier, id } = await setup()
    await todo.apply(
      id,
      [{ type: 'add', id: 't1', text: '跑测试' }, { type: 'freeze' }],
      'executor',
    )

    const outcome = await verifier.verify(id)
    expect(outcome?.action).toBe('continue-session')
    expect(cards.find(id)?.deliveryState).toBe('waiting')
    const { events } = await journal.read(id)
    expect(events.some((event) => event.meta?.verifyRetry === true)).toBe(true)
  })

  it('代价变高：进 unknown 并升级给决策者', async () => {
    const { cards, todo, verifier, id } = await setup()
    await todo.apply(
      id,
      [
        { type: 'add', id: 't1', text: '改架构' },
        { type: 'update', id: 't1', cost: { delta: 'up', reason: '超出范围' } },
        { type: 'freeze' },
      ],
      'executor',
    )

    const outcome = await verifier.verify(id)
    expect(outcome?.action).toBe('escalate')
    expect(cards.find(id)?.deliveryState).toBe('unknown')
    expect(cards.find(id)?.waitReason).toBe('awaiting-user-escalation')
  })

  it('不在 executed 的卡不验收', async () => {
    const { cards, verifier } = await setup()
    const card = await cards.create('还没跑', { kind: 'decision' })
    expect(await verifier.verify(card.id)).toBeNull()
  })
})

describe('语义消费路径（R1：decision/user 两级真的落 Outcome）', () => {
  it('consumeDecisionSemantic：票拟 reject → Outcome verifier=model / failed', async () => {
    const { consumeDecisionSemantic } = await import('../../src/host/verification/semantic')
    const written: Array<Record<string, unknown>> = []
    const ticket = {
      id: 't-1',
      title: '语义票据',
      semantic: { planId: 'p-3', verifier: 'decision', sourceCardId: 'c-src', criteria: ['sem'] },
      advice: { verdict: 'reject' },
    } as never
    const ok = await consumeDecisionSemantic(ticket, async (o) => {
      written.push(o as never)
      return undefined
    })
    expect(ok).toBe(true)
    expect(written[0]?.verifier).toBe('model')
    expect(written[0]?.verified).toBe('failed')
  })

  it('consumeUserSemantic：用户拒绝 → Outcome verifier=user + 原卡 failed', async () => {
    const { consumeUserSemantic } = await import('../../src/host/verification/semantic')
    const written: Array<Record<string, unknown>> = []
    const patched: Array<Record<string, unknown>> = []
    const ticket = {
      id: 't-2',
      title: '用户语义票据',
      semantic: { planId: 'p-4', verifier: 'user', sourceCardId: 'c-src', criteria: ['sem'] },
    } as never
    const ok = await consumeUserSemantic(
      { patch: async (_id: string, changes: Record<string, unknown>) => patched.push(changes) },
      async (o) => {
        written.push(o as never)
        return undefined
      },
      ticket,
      'reject',
    )
    expect(ok).toBe(true)
    expect(written[0]?.verifier).toBe('user')
    expect(written[0]?.verified).toBe('failed')
    expect(patched[0]?.deliveryState).toBe('failed')
  })
})
