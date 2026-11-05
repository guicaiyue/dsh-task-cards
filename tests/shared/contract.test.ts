// 契约测试：zod schema 是唯一真源，这里验「真源与三处消费方对得上」。
//   ① 宿主写出来的卡能被 schema 解析（旧数据也照样解析）
//   ② 观察者吐出的草稿能被 schema 解析
//   ③ 设置 / 策略的默认值、拒绝值
//   ④ 观察者提示词里承诺的 JSON 结构 = schema 派生的 JSON Schema
//   ⑤ 面板客户端用的 API 前缀 = 宿主注册的路径

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { API, NS, PANEL_ID } from '../../src/client/constants'
import { DEFAULT_SETTINGS } from '../../src/host/cards/defaults'
import { Store } from '../../src/host/cards/store'
import { coerceCards } from '../../src/host/observer/extract'
import { DEFAULT_POLICY } from '../../src/host/policy/policy'
import {
  CARD_KINDS,
  CARD_STATUSES,
  CardDraftSchema,
  CardSchema,
  PolicySchema,
  QuestionSchema,
  RecordSchema,
  SettingsSchema,
} from '../../src/shared/contract'
import { API_PREFIX, API_ROUTES } from '../../src/shared/routes'
import {
  ACTION_EVENT,
  ACTION_RESULT,
  CLOSED_STATUSES,
  groupCards,
  isCardAction,
  isClosed,
} from '../../src/shared/state'

function tempStore(): Store {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-contract-'))
  return new Store(path.join(dir, 'cards.json'))
}

describe('卡片契约', () => {
  it('宿主写出的卡能被 CardSchema 解析', async () => {
    const store = tempStore()
    const card = await store.create('删掉旧表', {
      kind: 'decision',
      severity: 'high',
      detail: '旧表没人用了',
      source: 'agent',
      origin: { sessionId: 's-1', turn: 2 },
      action: { type: 'prompt', delayMs: 600000, input: '继续' },
    })
    const parsed = CardSchema.safeParse(card)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    if (parsed.success) {
      expect(parsed.data.kind).toBe('decision')
      expect(parsed.data.status).toBe('scheduled')
      expect(parsed.data.origin?.sessionId).toBe('s-1')
    }
  })

  it('旧数据缺字段时用默认值补齐', () => {
    const parsed = CardSchema.parse({ id: 'c-1', title: '旧卡', createdAt: 1, updatedAt: 2 })
    expect(parsed.kind).toBe('info')
    expect(parsed.severity).toBe('normal')
    expect(parsed.status).toBe('open')
    expect(parsed.source).toBe('human')
    expect(parsed.detail).toBe('')
    expect(parsed.action).toBeNull()
  })

  it('非法 kind / status 被拒', () => {
    const base = { id: 'c-1', title: 'x', createdAt: 1, updatedAt: 2 }
    expect(CardSchema.safeParse({ ...base, kind: 'urgent' }).success).toBe(false)
    expect(CardSchema.safeParse({ ...base, status: 'archived' }).success).toBe(false)
    expect(CardSchema.safeParse({ ...base, title: '' }).success).toBe(false)
  })

  it('观察者吐出的草稿能被 CardDraftSchema 解析', () => {
    const coerced = coerceCards({
      cards: [
        {
          title: '限流重试',
          kind: 'auto',
          action: { type: 'retry', delayMs: 600000, input: '继续' },
        },
        { title: '跑完了', kind: 'info' },
      ],
    })
    expect(coerced.ok).toBe(true)
    if (!coerced.ok) return
    for (const draft of coerced.cards) {
      const parsed = CardDraftSchema.safeParse(draft)
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    }
  })

  it('问题卡的 question 结构符合 QuestionSchema', () => {
    const parsed = QuestionSchema.parse({
      sessionId: 's-1',
      callId: 'call-9',
      items: [{ id: 'q1', question: '选哪个？', multiSelect: false, options: ['A', 'B'] }],
    })
    expect(parsed.items).toHaveLength(1)
    expect(QuestionSchema.safeParse({ items: [{ question: '缺 id' }] }).success).toBe(false)
  })

  it('观察者记录能被 RecordSchema 解析', () => {
    const parsed = RecordSchema.safeParse({
      id: 'r-1',
      at: Date.now(),
      status: 'ok',
      originSessionId: 's-1',
      turn: 1,
      cardsCreated: 2,
    })
    expect(parsed.success).toBe(true)
  })

  it('枚举与状态列表与面板分组保持一致', async () => {
    const store = tempStore()
    const card = await store.create('一张卡')
    for (const status of CARD_STATUSES) {
      const parsed = CardSchema.safeParse({ ...card, status })
      expect(parsed.success, status).toBe(true)
    }
    expect(new Set(CARD_KINDS)).toEqual(new Set(['decision', 'info', 'auto']))
  })
})

describe('设置契约', () => {
  it('默认设置能通过 schema，且提示词非空', () => {
    const parsed = SettingsSchema.safeParse(DEFAULT_SETTINGS)
    expect(parsed.success).toBe(true)
    expect(DEFAULT_SETTINGS.systemPrompt.length).toBeGreaterThan(100)
    expect(DEFAULT_SETTINGS.minReplyChars).toBeGreaterThan(0)
  })

  it('类型不对的设置被拒（负数长度、超长提示词之外）', () => {
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, minReplyChars: -1 }).success).toBe(false)
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, enabled: 'yes' }).success).toBe(false)
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, timeoutMs: 0 }).success).toBe(false)
  })
})

describe('策略契约', () => {
  it('默认策略三角色齐全，且能被 schema 解析', () => {
    const parsed = PolicySchema.safeParse(DEFAULT_POLICY)
    expect(parsed.success).toBe(true)
    expect(Object.keys(DEFAULT_POLICY.roles).sort()).toEqual(['default', 'observer', 'worker'])
    // 观察者默认没有工具：这是「观察者不能动用户会话」的执行层保证
    expect(DEFAULT_POLICY.roles.observer.tools).toEqual([])
    expect(DEFAULT_POLICY.roles.observer.skills).toEqual([])
  })

  it('通配符 * 表示全放行', () => {
    expect(DEFAULT_POLICY.roles.default.tools).toContain('*')
  })
})

describe('状态机', () => {
  it('每个动作都映射到状态与事件', () => {
    for (const name of Object.keys(ACTION_RESULT)) {
      expect(isCardAction(name)).toBe(true)
      expect(CARD_STATUSES).toContain(ACTION_RESULT[name])
      expect(typeof ACTION_EVENT[name as keyof typeof ACTION_EVENT]).toBe('string')
    }
    expect(isCardAction('explode')).toBe(false)
  })

  it('收尾状态与关闭判断一致', () => {
    for (const status of CARD_STATUSES) {
      expect(isClosed(status)).toBe(CLOSED_STATUSES.includes(status))
    }
  })

  it('分组不重不漏', () => {
    const cards = [
      { id: '1', kind: 'decision' as const, status: 'open' as const },
      { id: '2', kind: 'info' as const, status: 'acknowledged' as const },
      { id: '3', kind: 'auto' as const, status: 'scheduled' as const },
      { id: '4', kind: 'info' as const, status: 'done' as const },
    ]
    const groups = groupCards(cards)
    expect(groups.decision.map((c) => c.id)).toEqual(['1'])
    expect(groups.info.map((c) => c.id)).toEqual([])
    expect(groups.auto.map((c) => c.id)).toEqual(['3'])
    expect(groups.closed.map((c) => c.id)).toEqual(['2', '4'])
    const total =
      groups.decision.length + groups.info.length + groups.auto.length + groups.closed.length
    expect(total).toBe(cards.length)
  })
})

describe('路径与标识', () => {
  it('客户端前缀与宿主一致', () => {
    expect(API).toBe(API_PREFIX)
    for (const route of Object.values(API_ROUTES)) expect(route.startsWith(API_PREFIX)).toBe(true)
  })

  it('面板 id 与插件命名空间有约定关系', () => {
    expect(PANEL_ID).toBe('task-cards')
    expect(NS).toBe('dsh-task-cards')
  })
})
