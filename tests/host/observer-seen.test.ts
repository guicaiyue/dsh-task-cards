// 「用户已经回到原会话」的判定：游标 + 建卡选项。
//
// 这条链路要回答两件事：
//   ① 回合结束时记下的游标，之后用户再说话就变成「已看过」；
//   ② 已看过的草稿，只有 info 卡才落成免打扰（决策卡永远要人回应）。

import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '../../src/host/cards/defaults'
import { draftCreateOptions, laneGate } from '../../src/host/observer/create'
import type { Observer } from '../../src/host/observer/observer'
import { SeenTracker } from '../../src/host/observer/seen'
import type { ObserverTurnInput } from '../../src/host/observer/session'
import { createHandlers } from '../../src/host/observer/trigger'
import type { CardDraft } from '../../src/shared/contract'

describe('SeenTracker', () => {
  it('游标之后的用户发言才算「回来了」', () => {
    const seen = new SeenTracker()
    seen.markUser('s-1', 1000)
    const mark = seen.mark('s-1')

    seen.markUser('s-1', 1500)
    expect(seen.seenSince('s-1', mark)).toBe(true)
    // 换了会话不串味
    expect(seen.seenSince('s-2', mark)).toBe(false)
  })

  it('从没说过话的会话游标是 0，不会误判', () => {
    const seen = new SeenTracker()
    expect(seen.mark('s-new')).toBe(0)
    expect(seen.seenSince('s-new', seen.mark('s-new'))).toBe(false)
  })
})

describe('draftCreateOptions', () => {
  const origin = { sessionId: 's-1', turn: 1, observerSessionId: 'o-1', reason: '' }
  const draft = (kind: CardDraft['kind']): CardDraft => ({
    title: '一条卡',
    detail: '',
    kind,
    severity: 'normal',
    action: null,
    reason: '',
  })

  it('系统代发触发时，judgment 卡硬降为 info；许可/澄清不降', () => {
    const system = { ...origin, sourceKind: 'card-answer' as const }
    expect(laneGate({ ...draft('decision'), ask: 'judgment' }, system)).toEqual({
      kind: 'info',
      downgraded: true,
    })
    expect(laneGate({ ...draft('decision'), ask: 'permission' }, system)).toEqual({
      kind: 'decision',
      downgraded: false,
    })
    expect(laneGate({ ...draft('decision'), ask: 'clarification' }, system)).toEqual({
      kind: 'decision',
      downgraded: false,
    })
    expect(laneGate({ ...draft('decision'), ask: 'judgment' }, origin)).toEqual({
      kind: 'decision',
      downgraded: false,
    })
    const downgraded = draftCreateOptions({ ...draft('decision'), ask: 'judgment' }, system, false)
    expect(downgraded.kind).toBe('info')
    expect(String(downgraded.detail)).toContain('已降为通知')
  })

  it('只有自动卡保留 action；决策/通知卡即使草稿带了 action 也丢掉', () => {
    const withAction = (kind: CardDraft['kind']): CardDraft => ({
      ...draft(kind),
      action: { type: 'prompt', delayMs: 0, input: '到点发' },
    })
    expect(draftCreateOptions(withAction('auto'), origin, false).action).toBeTruthy()
    expect(draftCreateOptions(withAction('decision'), origin, false).action).toBeNull()
    expect(draftCreateOptions(withAction('info'), origin, false).action).toBeNull()
  })

  it('已看过 + info → 免打扰；决策卡即使已看过也不免打扰', () => {
    expect(draftCreateOptions(draft('info'), origin, true).silent).toBe(true)
    expect(draftCreateOptions(draft('decision'), origin, true).silent).toBe(false)
    expect(draftCreateOptions(draft('info'), origin, false).silent).toBe(false)
  })
})

interface StubObserver {
  waiter: { cancel: (sessionId: string, reason: string) => void }
  enqueue: <T>(job: () => Promise<T>) => Promise<T>
  run: (input: ObserverTurnInput) => Promise<null>
}

/** 只验触发端记的游标：观察者本身换成桩，不跑模型。 */
function makeHandlers() {
  const captured: ObserverTurnInput[] = []
  const stub: StubObserver = {
    waiter: { cancel: () => {} },
    enqueue: (job) => job(),
    run: async (input) => {
      captured.push(input)
      return null
    },
  }
  const seen = new SeenTracker()
  const handlers = createHandlers({
    observer: stub as unknown as Observer,
    settings: () => DEFAULT_SETTINGS,
    log: () => {},
    captureQuestion: async () => {},
    tracker: new Map(),
    seen,
  })
  return { handlers, seen, captured }
}

const session = { id: 's-1', header: { cwd: '/tmp/project' } }
const userEvent = {
  type: 'user/message',
  data: { message: { content: [{ type: 'text', text: '继续' }] } },
}
const replyEvent = {
  type: 'assistant/message',
  data: { message: { content: [{ type: 'text', text: '改完了，测试全绿' }] }, turn: 3 },
}

describe('触发端记录的 seenMark', () => {
  it('回合结束时记下用户最后发言的游标；用户之后回来说话即视为看过', async () => {
    const { handlers, seen, captured } = makeHandlers()
    handlers.onSessionEvent(session, userEvent)
    handlers.onSessionEvent(session, replyEvent)
    handlers.onAgentStatus({ agent: { id: 's-1' }, status: 'idle' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(captured).toHaveLength(1)
    const mark = captured[0]?.seenMark
    expect(typeof mark).toBe('number')
    // 建卡时用户还没回来
    expect(seen.seenSince('s-1', mark as number)).toBe(false)

    handlers.onSessionEvent(session, userEvent)
    expect(seen.seenSince('s-1', mark as number)).toBe(true)
  })
})

describe('来源过滤：系统注入不占用户轮次', () => {
  const timeContext = {
    type: 'user/message',
    data: {
      source: { kind: 'time-context' },
      content: [{ type: 'text', text: 'Time sampled while preparing turn 4' }],
    },
  }
  const cardAnswer = {
    type: 'user/message',
    data: {
      source: { kind: 'user', rpcId: 'card-answer-mw4s44xw' },
      content: [{ type: 'text', text: '〔任务卡答复 c-1「要不要再跑一次」〕\n跑一次' }],
    },
  }

  it('time-context 不入轮次，也不把用户标成「已回来」', async () => {
    const { handlers, seen, captured } = makeHandlers()
    handlers.onSessionEvent(session, timeContext)
    expect(seen.mark('s-1')).toBe(0)
    handlers.onSessionEvent(session, replyEvent)
    handlers.onAgentStatus({ agent: { id: 's-1' }, status: 'idle' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // 只有心跳、没有真人输入：不触发观察者
    expect(captured).toHaveLength(0)
  })

  it('card-answer 触发观察者，但标记为系统代发且不标「已回来」', async () => {
    const { handlers, seen, captured } = makeHandlers()
    handlers.onSessionEvent(session, cardAnswer)
    expect(seen.mark('s-1')).toBe(0)
    handlers.onSessionEvent(session, replyEvent)
    handlers.onAgentStatus({ agent: { id: 's-1' }, status: 'idle' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(captured).toHaveLength(1)
    expect(captured[0]?.triggerSourceKind).toBe('card-answer')
    expect(captured[0]?.triggerCardId).toBe('c-1')
    expect(captured[0]?.turns?.[0]?.provenance).toBe('card-answer')
  })
})
