// P1 授权反转 hook：goalId/result/defaultAnswer 落盘、exception-only 过滤、ask 通道独立账本。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { AskStore } from '../../src/host/asks/store'
import { Store } from '../../src/host/cards/store'
import { classifyDraft, draftCreateOptions, shouldKeepDraft } from '../../src/host/observer/create'
import type { CardDraft } from '../../src/shared/contract'

const origin = { sessionId: 's-1', turn: 7 } as never
const base = (over: Partial<CardDraft>): CardDraft =>
  ({
    title: 'x',
    detail: '',
    kind: 'info',
    severity: 'normal',
    action: null,
    reason: '',
    ...over,
  }) as CardDraft

describe('P1/P3 卡字段', () => {
  it('goalId 默认 session:turn；result/defaultAnswer/blocking 落盘', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-deleg-'))
    const cards = new Store(path.join(dir, 'cards.json'))
    expect(
      classifyDraft(base({ title: '完成 delegation 探测：probe-ok 已写入' }), 'exception-only'),
    ).toEqual({ keep: true, result: true })
    const options = draftCreateOptions(
      base({ title: '目标完成', result: true, defaultAnswer: '继续', blocking: true }),
      origin,
      false,
    )
    const card = await cards.create('目标完成', options)
    expect(card.goalId).toBe('s-1:7')
    expect(card.result).toBe(true)
    expect(card.defaultAnswer).toBe('继续')
    expect(card.blocking).toBe(true)
  })

  it('exception-only：过程/例行 info 不建，风险/结果/决策保留', () => {
    expect(shouldKeepDraft(base({ title: '例行进展：看了下日志' }), 'exception-only')).toBe(false)
    expect(
      shouldKeepDraft(base({ title: '证书 2 天后到期', severity: 'high' }), 'exception-only'),
    ).toBe(true)
    expect(shouldKeepDraft(base({ title: '目标完成', result: true }), 'exception-only')).toBe(true)
    expect(shouldKeepDraft(base({ title: '生产库缺表' }), 'exception-only')).toBe(true)
    expect(shouldKeepDraft(base({ title: '要我拍板', kind: 'decision' }), 'exception-only')).toBe(
      true,
    )
    // standard 模式保持旧行为
    expect(shouldKeepDraft(base({ title: '例行进展' }), 'standard')).toBe(true)
  })
})

describe('ask 通道独立账本（不落 cards.json）', () => {
  it('创建 ask：kind=ask、带默认答案/blocking/回滚 ref；答后 answeredAt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-ask-'))
    const asks = new AskStore(path.join(dir, 'asks.json'))
    const { ask } = await asks.create({
      goalId: 'g-1',
      sessionId: 's-1',
      question: '生产库要删表？',
      defaultAnswer: '不执行（保持现状）',
      blocking: true,
      reason: 'prod-db',
      effect: 'destructive',
      beforeRef: 'abc123',
      rollback: { kind: 'git-checkout', ref: 'abc123' },
      policyVersion: 1,
    })
    expect(ask.kind).toBe('ask')
    expect(ask.defaultAnswer).toBeTruthy()
    expect(ask.blocking).toBe(true)
    expect(fs.existsSync(path.join(dir, 'asks.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'cards.json'))).toBe(false)
    const answered = await asks.answer(ask.id, '继续')
    expect(answered?.answeredAt).toBeTruthy()
    expect(asks.open()).toHaveLength(0)
  })
})

describe('审计载荷（beforeRef/rollback/policyVersion）', () => {
  it('gitSnapshot 在真实 repo 返回可回滚 ref（干净=HEAD，脏=stash ref）', async () => {
    const { gitSnapshot, rollbackOf } = await import('../../src/host/autonomy/audit')
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-git-'))
    const git = (args: string[]) =>
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('node:child_process').execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
    git(['init', '-q'])
    git(['config', 'user.email', 't@t'])
    git(['config', 'user.name', 't'])
    fs.writeFileSync(path.join(repo, 'a.txt'), '1')
    git(['add', '.'])
    git(['commit', '-qm', 'init'])
    const clean = gitSnapshot(repo)
    expect(clean.beforeRef).toMatch(/^[0-9a-f]{7,40}$/)
    expect(clean.dirty).toBe(false)
    expect(rollbackOf(clean).ref).toBe(clean.beforeRef)
    fs.writeFileSync(path.join(repo, 'a.txt'), '2')
    const dirty = gitSnapshot(repo)
    expect(dirty.dirty).toBe(true)
    expect(dirty.beforeRef.length).toBeGreaterThan(0)
    expect(rollbackOf(dirty).kind).toBe('git-stash-checkout')
  })
})

describe('P3：一目标一结果，过程不建卡', () => {
  it('10 条过程 + 1 结果 + 1 风险 → 只有结果卡与风险卡；结果卡 goalId 非空/kind=info/result=true', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-goal-'))
    const cards = new Store(path.join(dir, 'cards.json'))
    const drafts: CardDraft[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        base({ title: `探索第 ${i + 1} 步`, detail: '看了日志/跑了命令，中间结论' }),
      ),
      base({ title: '完成 APK 发布收尾', result: true, detail: '做了什么…产物…验证…风险：无' }),
      base({ title: '证书 2 天后到期', severity: 'high', detail: '风险卡' }),
    ]
    for (const raw of drafts) {
      const verdict = classifyDraft(raw, 'exception-only')
      if (!verdict.keep) continue
      const draft = verdict.result && !raw.result ? { ...raw, result: true } : raw
      await cards.create(draft.title, draftCreateOptions(draft, origin, false))
    }
    const list = cards.list()
    expect(list).toHaveLength(2)
    const result = list.find((card) => card.result)
    expect(result?.goalId).toBe('s-1:7')
    expect(result?.kind).toBe('info')
    expect(list.find((card) => card.severity === 'high')?.title).toContain('证书')
  })
})
