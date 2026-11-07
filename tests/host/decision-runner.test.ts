import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { Card } from '../../src/shared/contract'

// 必须在 import 插件之前改 DSH_HOME：workspace 目录与默认数据路径都按它算。
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-runner-'))
process.env.DSH_HOME = HOME

const { PrecedentStore, RecordStore, SettingsStore, Store } = await import(
  '../../src/host/cards/store'
)
const { Decision } = await import('../../src/host/decision/runner')
const { DECISION_PRESET_ID } = await import('../../src/host/decision/defaults')
const { isDecisionSession } = await import('../../src/host/decision/ids')

type StoreClass = InstanceType<typeof Store>
type SettingsClass = InstanceType<typeof SettingsStore>
type PrecedentClass = InstanceType<typeof PrecedentStore>
type RecordClass = InstanceType<typeof RecordStore>
type DecisionClass = InstanceType<typeof Decision>

interface FakeHost {
  runtime: import('../../src/host/host-api').HostRuntime
  created: Array<Record<string, unknown>>
  prompts: Array<{ sessionId: string; text: string }>
  selected: string[]
}

/** 假宿主：agents.create 立刻返回句柄；prompt 投递后用一个微任务冒充回合结束。 */
function fakeHost(getDecision: () => DecisionClass): FakeHost {
  const created: Array<Record<string, unknown>> = []
  const prompts: Array<{ sessionId: string; text: string }> = []
  const selected: string[] = []
  const runtime: import('../../src/host/host-api').HostRuntime = {
    agents: {
      async create(options: Record<string, unknown>) {
        created.push(options)
        return { agent: { ctx: {} }, dispose: async () => undefined }
      },
    },
    sessionController: {
      async prompt(request, signal) {
        expect(signal).toBeInstanceOf(AbortSignal)
        prompts.push({
          sessionId: request.sessionId,
          text: request.content.map((block) => block.text).join('\n'),
        })
        reply(getDecision(), request.sessionId, '')
        return {}
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    agentPresets: {
      async register() {
        return () => undefined
      },
      async select(_agent: unknown, presetId: string) {
        selected.push(presetId)
        return {}
      },
    },
  }
  return { runtime, created, prompts, selected }
}

/** 让指定的会话「跑完一个回合」：喂一条 assistant/message 再让它 idle。 */
function reply(decision: DecisionClass, sessionId: string, text: string): void {
  queueMicrotask(() => {
    decision.waiter.acceptEvent(sessionId, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text }] } },
    })
    decision.waiter.finish(sessionId)
  })
}

function fresh(): {
  cards: StoreClass
  settings: SettingsClass
  precedents: PrecedentClass
  records: RecordClass
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-runner-case-'))
  return {
    cards: new Store(path.join(dir, 'cards.json')),
    settings: new SettingsStore(path.join(dir, 'settings.json')),
    precedents: new PrecedentStore(path.join(dir, 'precedents.json')),
    records: new RecordStore(path.join(dir, 'records.json')),
  }
}

interface Rig {
  decision: DecisionClass
  cards: StoreClass
  settings: SettingsClass
  precedents: PrecedentClass
  records: RecordClass
  host: FakeHost
}

function rig(): Rig {
  const { cards, settings, precedents, records } = fresh()
  let decision: DecisionClass | null = null
  const host = fakeHost(() => {
    if (!decision) throw new Error('decision 尚未创建')
    return decision
  })
  decision = new Decision({
    getCtx: () => host.runtime,
    settings,
    cards,
    precedents,
    records,
    log: () => {},
  })
  return { decision, cards, settings, precedents, records, host }
}

async function seedDecisionCard(cards: StoreClass, title: string): Promise<Card> {
  return cards.create(title, { kind: 'decision', detail: '现状能跑但结构乱' })
}

const VALID = JSON.stringify({
  decisions: [
    {
      cardId: 'PLACEHOLDER',
      lane: 'info',
      verdict: 'modify',
      summary: '先跑通最小验证',
      options: [
        { name: '先跑通', answer: '先跑通最小验证再谈重构', verdict: 'approve' },
        { name: '直接重构', answer: '直接重构', verdict: 'reject' },
      ],
      basis: '无同类判例',
      confidence: 'normal',
    },
  ],
})

describe('决策会话', () => {
  it('成功一次：开无工具会话、带上决策 preset、写回 advice 并纠正车道', async () => {
    const { decision, cards, host } = rig()
    const target = await seedDecisionCard(cards, '要不要把登录页重做')
    const text = VALID.replace('PLACEHOLDER', target.id)
    host.runtime.sessionController = {
      async prompt(request, signal) {
        expect(signal).toBeInstanceOf(AbortSignal)
        host.prompts.push({ sessionId: request.sessionId, text: '' })
        reply(decision, request.sessionId, text)
        return {}
      },
    }

    const result = await decision.run([target.id])
    expect(result.ok).toBe(true)
    expect(result.advised).toBe(1)
    expect(result.attempts).toBe(1)

    const after = cards.find(target.id)
    expect(after?.kind).toBe('info') // decision → info：唯一允许的自动纠正
    expect(after?.advice?.applied).toBe(true)
    expect(after?.advice?.verdict).toBe('modify')
    expect(after?.advice?.options.map((option) => option.name)).toEqual(['先跑通', '直接重构'])
    expect(after?.events.map((event) => event.type)).toEqual(['created', 'lane:info', 'advised'])

    expect(host.created).toHaveLength(1)
    const started = host.created[0]
    expect(String(started?.sessionId).startsWith('card-dec-')).toBe(true)
    expect(isDecisionSession(started?.sessionId)).toBe(true)
    const meta = started?.meta as Record<string, unknown> | undefined
    expect(meta?.agentPreset).toBe(DECISION_PRESET_ID)
    expect(host.selected).toEqual([DECISION_PRESET_ID])
    expect(decision.waiter.pending.size).toBe(0)
  })

  it('输入里带上本次的卡与已存的判例', async () => {
    const { decision, cards, host } = rig()
    const target = await seedDecisionCard(cards, '要不要加缓存')
    host.runtime.sessionController = {
      async prompt(request) {
        host.prompts.push({
          sessionId: request.sessionId,
          text: request.content.map((block) => block.text).join('\n'),
        })
        reply(decision, request.sessionId, VALID.replace('PLACEHOLDER', target.id))
        return {}
      },
    }

    await decision.run([target.id])
    const prompt = host.prompts[0]?.text ?? ''
    expect(prompt).toContain('<cards>')
    expect(prompt).toContain(target.id)
    expect(prompt).toContain('要不要加缓存')
    expect(prompt).toContain('<precedents>')
  })

  it('第一次输出不可解析 → 重试一次成功', async () => {
    const { decision, cards, host } = rig()
    const target = await seedDecisionCard(cards, '要不要重构')
    const replies = ['这不是 JSON', VALID.replace('PLACEHOLDER', target.id)]
    host.runtime.sessionController = {
      async prompt(request) {
        host.prompts.push({ sessionId: request.sessionId, text: '' })
        reply(decision, request.sessionId, replies.shift() ?? '')
        return {}
      },
    }

    const result = await decision.run([target.id])
    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(2)
    expect(host.prompts).toHaveLength(2)
    expect(cards.find(target.id)?.advice).not.toBeNull()
  })

  it('两次都失败：只记日志与卡事件，不抛出，卡仍然可用', async () => {
    const { decision, cards, host } = rig()
    const target = await seedDecisionCard(cards, '要不要删旧表')
    const replies = ['完全不是 JSON', '{"foo":1}']
    host.runtime.sessionController = {
      async prompt(request) {
        host.prompts.push({ sessionId: request.sessionId, text: '' })
        reply(decision, request.sessionId, replies.shift() ?? '')
        return {}
      },
    }

    const result = await decision.run([target.id])
    expect(result.ok).toBe(false)
    expect(result.advised).toBe(0)
    expect(result.reason).toBeTruthy()
    expect(host.prompts).toHaveLength(2)
    const after = cards.find(target.id)
    expect(after?.advice).toBeNull()
    expect(after?.status).toBe('open')
    expect(after?.events.map((event) => event.type)).toContain('decision-failed')
  })

  it('未知 cardId 丢弃：不出票拟，也不算失败', async () => {
    const { decision, cards, host } = rig()
    const target = await seedDecisionCard(cards, '要不要换配色')
    host.runtime.sessionController = {
      async prompt(request) {
        host.prompts.push({ sessionId: request.sessionId, text: '' })
        reply(decision, request.sessionId, '{"decisions":[{"cardId":"c-nope","summary":"不认识"}]}')
        return {}
      },
    }

    const result = await decision.run([target.id])
    expect(result.ok).toBe(true)
    expect(result.advised).toBe(0)
    expect(cards.find(target.id)?.advice).toBeNull()
  })

  it('decisionEnabled=false 时自动阶段不跑会话', async () => {
    const { decision, cards, settings, host } = rig()
    await settings.set({ decisionEnabled: false })
    const target = await seedDecisionCard(cards, '要不要上线')
    const result = await decision.run([target.id])
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('关闭')
    expect(host.prompts).toHaveLength(0)
  })

  it('redecide 走强制路径（不看 decisionEnabled 开关）', async () => {
    const { decision, cards, settings, host } = rig()
    await settings.set({ decisionEnabled: false })
    const target = await seedDecisionCard(cards, '要不要发版')
    host.runtime.sessionController = {
      async prompt(request) {
        host.prompts.push({ sessionId: request.sessionId, text: '' })
        reply(decision, request.sessionId, VALID.replace('PLACEHOLDER', target.id))
        return {}
      },
    }

    const result = await decision.run([target.id], true)
    expect(result.ok).toBe(true)
    expect(host.prompts).toHaveLength(1)
    expect(cards.find(target.id)?.advice).not.toBeNull()
  })

  it('已结束的卡不重跑（没有需要决策的卡）', async () => {
    const { decision, cards, host } = rig()
    const target = await seedDecisionCard(cards, '已经处理过的卡')
    await cards.patch(target.id, { status: 'done' }, 'completed')
    const result = await decision.run([target.id])
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('没有需要决策的卡')
    expect(host.prompts).toHaveLength(0)
  })

  const ORIGIN = 's-origin'

  function adviceJson(cardId: string, chosen: number, autoApply: boolean): string {
    return JSON.stringify({
      decisions: [
        {
          cardId,
          lane: 'decision',
          ask: 'judgment',
          verdict: 'modify',
          effect: 'read',
          requires: ['session.reply'],
          summary: '先跑通最小验证',
          chosen,
          autoApply,
          options: [
            { name: '先跑通', answer: '先跑通最小验证再谈重构', verdict: 'approve' },
            { name: '直接重构', answer: '直接重构整个登录页', verdict: 'reject' },
          ],
          basis: '无同类判例',
          confidence: 'normal',
        },
      ],
    })
  }

  /** 让这次会话的回复可预期：决策会话回票拟，投递回原会话只记账。 */
  function replyWith(decision: DecisionClass, host: FakeHost, replyText: string): void {
    host.runtime.sessionController = {
      async prompt(request) {
        host.prompts.push({
          sessionId: request.sessionId,
          text: request.content.map((block) => block.text).join('\n'),
        })
        reply(decision, request.sessionId, replyText)
        return {}
      },
    }
  }

  function seedWithOrigin(cards: StoreClass, title: string): Promise<Card> {
    return cards.create(title, {
      kind: 'decision',
      detail: '现状能跑但结构乱',
      origin: { sessionId: ORIGIN },
    })
  }

  it('票拟 autoApply=true：自动推回原会话、卡变 done，且不落判例', async () => {
    const { decision, cards, precedents, records, host } = rig()
    const target = await seedWithOrigin(cards, '要不要把登录页重做')
    replyWith(decision, host, adviceJson(target.id, 0, true))

    const result = await decision.run([target.id])
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const after = cards.find(target.id)
    expect(after?.status).toBe('done')
    expect(after?.answer).toBe('先跑通最小验证再谈重构')
    expect(after?.answeredVia).toBe('card')
    expect(after?.advice?.autoApply).toBe(true)
    expect(after?.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['advised', 'advice-applied']),
    )

    // 推给了原会话，不是决策会话
    const delivered = host.prompts.filter((item) => item.sessionId === ORIGIN)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.text).toContain('先跑通最小验证再谈重构')

    // 自动执行不落判例：判例只能由人的动作产生
    expect(precedents.list()).toHaveLength(0)

    expect(records.listByPhase('decision')[0]).toMatchObject({
      status: 'ok',
      cardsCreated: 1,
      applied: 1,
      corrected: 0,
    })
  })

  it('票拟 autoApply=false：只写回 advice，不投递，卡不结束', async () => {
    const { decision, cards, host } = rig()
    const target = await seedWithOrigin(cards, '要不要加缓存')
    replyWith(decision, host, adviceJson(target.id, 0, false))

    const result = await decision.run([target.id])
    expect(result.applied).toBe(0)
    const after = cards.find(target.id)
    expect(after?.status).toBe('open')
    expect(after?.advice).not.toBeNull()
    expect(after?.answer).toBeUndefined()
    expect(host.prompts.filter((item) => item.sessionId === ORIGIN)).toHaveLength(0)
  })

  it('设置 decisionAutoApply=false：即使票拟 autoApply=true 也不执行', async () => {
    const { decision, cards, settings, host } = rig()
    await settings.set({ decisionAutoApply: false })
    const target = await seedWithOrigin(cards, '要不要删旧表')
    replyWith(decision, host, adviceJson(target.id, 1, true))

    const result = await decision.run([target.id])
    expect(result.applied).toBe(0)
    const after = cards.find(target.id)
    expect(after?.status).toBe('open')
    expect(after?.advice?.chosen).toBe(1)
    expect(host.prompts.filter((item) => item.sessionId === ORIGIN)).toHaveLength(0)
  })

  it('自动执行投递失败：只记事件与日志，票拟仍保留', async () => {
    const { decision, cards, host } = rig()
    const target = await seedWithOrigin(cards, '要不要换配色')
    host.runtime.sessionController = {
      async prompt(request) {
        if (request.sessionId === ORIGIN) throw new Error('目标会话已经结束')
        host.prompts.push({ sessionId: request.sessionId, text: '' })
        reply(decision, request.sessionId, adviceJson(target.id, 0, true))
        return {}
      },
    }

    const result = await decision.run([target.id])
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(0)
    const after = cards.find(target.id)
    expect(after?.advice).not.toBeNull()
    expect(after?.advice?.verdict).toBe('modify')
    expect(after?.events.map((event) => event.type)).toContain('advice-applied:failed')
    // 自动执行失败不关卡：用户没表态，卡必须留在待决策车道，并写明失败原因。
    expect(after?.status).toBe('open')
    expect(after?.lastError).toContain('目标会话已经结束')
  })

  it('每次运行都落一条 phase=decision 的记录：空产出记 empty', async () => {
    const { decision, cards, records, host } = rig()
    const target = await seedWithOrigin(cards, '要不要发版')
    replyWith(decision, host, '{"decisions":[]}')

    await decision.run([target.id])
    const [record] = records.listByPhase('decision')
    expect(record).toMatchObject({
      phase: 'decision',
      status: 'empty',
      originSessionId: ORIGIN,
      attempts: 1,
      cardsCreated: 0,
      applied: 0,
      corrected: 0,
    })
    expect(String(record?.observerSessionId).startsWith('card-dec-')).toBe(true)
    expect(record?.model).toBe('p/m')
    expect(record?.durationMs).toBeTypeOf('number')
    expect(record?.inputChars).toBeGreaterThan(0)
    expect(record?.excerpt).toBe('{"decisions":[]}')
  })

  it('两次都不可解析：记录 status=invalid 并带上原因', async () => {
    const { decision, cards, records, host } = rig()
    const target = await seedWithOrigin(cards, '要不要重构')
    const replies = ['这不是 JSON', '{"foo":1}']
    host.runtime.sessionController = {
      async prompt(request) {
        host.prompts.push({ sessionId: request.sessionId, text: '' })
        reply(decision, request.sessionId, replies.shift() ?? '')
        return {}
      },
    }

    await decision.run([target.id])
    const [record] = records.listByPhase('decision')
    expect(record).toMatchObject({ status: 'invalid', attempts: 2, cardsCreated: 0 })
    expect(record?.error).toContain('票拟 JSON')
  })

  it('listByPhase 只挑决策记录，观察者记录不进 /decisions', async () => {
    const { records } = rig()
    await records.add({ phase: 'observer', status: 'ok' })
    await records.add({ phase: 'decision', status: 'ok' })
    const rows = records.listByPhase('decision')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.phase).toBe('decision')
  })
})
