// 阶段 A：三账分离的落盘事实——plans.json 与 approval-policy.json 真实生成且不同名。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { Store } from '../../src/host/cards/store'
import { PlansStore } from '../../src/host/plans/store'
import { APPROVAL_POLICY_FILE, ApprovalPolicyStore } from '../../src/host/policy/store'

describe('账本落盘', () => {
  it('plans.json / approval-policy.json 首次使用即生成，且与工具白名单 policy.json 不同名', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-ledgers-'))
    const cards = new Store(path.join(dir, 'cards.json'))
    const dataDir = path.dirname(cards.file)
    const plans = new PlansStore(path.join(dataDir, 'plans.json'))
    const approval = new ApprovalPolicyStore(path.join(dataDir, APPROVAL_POLICY_FILE))
    await plans.ensureFile()
    await approval.ensureFile()

    expect(fs.existsSync(path.join(dataDir, 'plans.json'))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, APPROVAL_POLICY_FILE))).toBe(true)
    expect(APPROVAL_POLICY_FILE).not.toBe('policy.json')
    expect(APPROVAL_POLICY_FILE).toBe('approval-policy.json')

    await plans.upsert({
      id: 'p-1',
      cardId: 'c-1',
      sessionId: 's-1',
      instruction: 'x',
      effect: 'read',
      acceptance: [],
      executionMode: 'dispatch',
      priority: 0,
      dependsOn: [],
      idempotencyKey: 'k-1',
      lease: null,
      attempts: [],
      cancelled: false,
      failed: false,
    })
    expect(plans.get('p-1')?.cardId).toBe('c-1')
    const policy = await approval.write({ version: 2 })
    expect(policy.version).toBe(2)
    // 默认值 bug 回归：新文件/空文件读出三档规则非空。
    const defaults = approval.read()
    expect(defaults.tiers.auto.length).toBeGreaterThan(0)
    expect(defaults.tiers.delegated.length).toBeGreaterThan(0)
    expect(defaults.tiers.user.length).toBeGreaterThan(0)
    // 历史 bug 文件（三档全空）读取时自愈。
    fs.writeFileSync(
      approval.file,
      JSON.stringify({ version: 1, tiers: { auto: [], delegated: [], user: [] }, updatedAt: 0 }),
      'utf8',
    )
    const healed = new ApprovalPolicyStore(approval.file).read()
    expect(healed.tiers.auto.length).toBeGreaterThan(0)
    expect(healed.tiers.delegated.length).toBeGreaterThan(0)
    expect(healed.tiers.user.length).toBeGreaterThan(0)
    // boot 归一化：空档旧文件会被真正写回磁盘（不是只在内存自愈），且幂等。
    const normalized = new ApprovalPolicyStore(approval.file)
    expect(await normalized.normalize()).toBe(true)
    const onDisk = JSON.parse(fs.readFileSync(approval.file, 'utf8')) as {
      tiers: { auto: string[]; delegated: string[]; user: string[] }
    }
    expect(onDisk.tiers.auto.length).toBeGreaterThan(0)
    expect(onDisk.tiers.delegated.length).toBeGreaterThan(0)
    expect(onDisk.tiers.user.length).toBeGreaterThan(0)
    expect(await normalized.normalize()).toBe(false)
  })
})

describe('delegated Verdict 账本', () => {
  it('secretary 路由写 Verdict（authority/policyVersion/rationale/confidence/evidenceRefs）', async () => {
    const fsmod = await import('node:fs')
    const osmod = await import('node:os')
    const pathmod = await import('node:path')
    const { applyAdvice } = await import('../../src/host/decision/apply')
    const { PlansStore } = await import('../../src/host/plans/store')
    const { DEFAULT_TIERS } = await import('../../src/host/policy/store')
    const dir = fsmod.mkdtempSync(pathmod.join(osmod.tmpdir(), 'dtc-verdict-'))
    const { Store } = await import('../../src/host/cards/store')
    const cards = new Store(pathmod.join(dir, 'cards.json'))
    const plans = new PlansStore(pathmod.join(dir, 'plans.json'))
    const card = await cards.create('委派票', { kind: 'decision', origin: { sessionId: 's-1' } })
    const policy = { version: 3, tiers: DEFAULT_TIERS, updatedAt: 1 }
    await applyAdvice(
      cards,
      cards.find(card.id) as never,
      {
        cardId: card.id,
        verdict: 'approve',
        summary: '执行',
        options: [
          { name: '执行', cost: '', gain: '', worst: '', answer: '执行', verdict: 'approve' },
        ],
        basis: '同类判例',
        precedentIds: ['p-1'],
        confidence: 'high',
        question: '',
        chosen: 0,
        autoApply: false,
        lane: 'decision',
        effect: 'write-code',
        reversible: true,
        action: 'run',
        scope: '',
        candidates: [],
        blockedReasons: [],
      } as never,
      { policy, recordVerdict: (verdict) => plans.recordVerdict(verdict) },
    )

    const verdicts = plans.verdictsOf(card.id)
    expect(verdicts).toHaveLength(1)
    const verdict = verdicts[0]
    expect(verdict?.authority).toBe('delegated')
    expect(verdict?.policyVersion).toBe(3)
    expect(verdict?.actorType).toBe('secretary')
    expect(verdict?.rationale).toBeTruthy()
    expect(verdict?.confidence).toBeGreaterThanOrEqual(0.9)
    expect(verdict?.evidenceRefs).toEqual(['p-1'])
    expect(fsmod.existsSync(plans.file)).toBe(true)
  })
})
