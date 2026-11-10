// 观察者兜底：漏事件 / 坏回合 / 被跳过的回合，定时扫描 + 会话日志重建补一次。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/host/cards/defaults'
import { RecordStore } from '../../src/host/cards/store'
import { FallbackSweeper, rebuildTurnState } from '../../src/host/observer/fallback'
import type { Observer } from '../../src/host/observer/observer'
import { SeenTracker } from '../../src/host/observer/seen'
import type { ObserverTurnInput } from '../../src/host/observer/session'
import { createHandlers } from '../../src/host/observer/trigger'
import type { TurnState } from '../../src/host/observer/turns'
import type { Settings } from '../../src/shared/contract'

type Event = { type: string; data?: Record<string, unknown>; time?: number }

const session = { id: 's-1', header: { cwd: '/tmp/project' } }

const humanEvent = (text: string, time: number): Event => ({
  type: 'user/message',
  time,
  data: { message: { content: [{ type: 'text', text }] } },
})

const triggerEvent = (kind: string, text: string, time: number): Event => ({
  type: 'user/message',
  time,
  data: { source: { kind }, message: { content: [{ type: 'text', text }] } },
})

const replyEvent = (text: string, turn: number, time: number): Event => ({
  type: 'assistant/message',
  time,
  data: { turn, message: { content: [{ type: 'text', text }] } },
})

function setup(over: { settings?: Partial<Settings>; log?: Event[] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-fallback-'))
  const records = new RecordStore(path.join(dir, 'records.json'))
  const tracker = new Map<string, TurnState>()
  const observed: Array<{ sessionId: string; why: string; reply: string }> = []
  let clock = 1_700_000_000_000
  const settings: Settings = { ...DEFAULT_SETTINGS, ...over.settings }
  const sweeper = new FallbackSweeper({
    settings: () => settings,
    tracker: () => tracker,
    records,
    log: () => {},
    now: () => clock,
    readSession: async () => (over.log ? (over.log as never) : null),
    observe: async (sessionId, state, why) => {
      observed.push({ sessionId, why, reply: state.lastReply })
      return true
    },
  })
  return {
    records,
    tracker,
    sweeper,
    observed,
    clock: () => clock,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

async function idleTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('重建一轮素材', () => {
  it('从事件流重建：真人输入 + 最后一条回复 + turn 号', () => {
    const state = rebuildTurnState([
      humanEvent('继续', 1),
      replyEvent('改完了，测试全绿', 3, 2),
    ] as never)
    expect(state?.lastReply).toBe('改完了，测试全绿')
    expect(state?.turn).toBe(3)
    expect(state?.hasTurnTrigger).toBe(true)
  })

  it('只有 assistant 回复、没有轮次触发器 → 没东西可观察', () => {
    expect(rebuildTurnState([replyEvent('只有回复', 2, 1)] as never)).toBeNull()
  })
})

describe('兜底扫描', () => {
  it('tracker 没状态时用会话日志重建并补观察一次，同指纹不重复', async () => {
    const { sweeper, observed, advance } = setup({
      log: [humanEvent('继续', 1), replyEvent('改完了', 2, 2)],
    })
    await sweeper.noteSkip('s-1', undefined, '没有累积状态')
    advance(3_000)
    expect(await sweeper.sweep()).toEqual(['s-1'])
    expect(observed).toHaveLength(1)
    advance(60_000)
    expect(await sweeper.sweep()).toEqual([])
    expect(observed).toHaveLength(1)
  })

  it('tracker 有素材但美国…回合结束事件漏了：超时后补观察', async () => {
    const { sweeper, tracker, observed, advance, clock } = setup()
    tracker.set('s-1', {
      ...(rebuildTurnState([
        humanEvent('继续', clock() - 5_000),
        replyEvent('做完了', 2, clock() - 4_000),
      ] as never) as TurnState),
    })
    // 事件刚结束，还不该补（避免在半截回合里观察）
    expect(await sweeper.sweep()).toEqual([])
    advance(200_000)
    expect(await sweeper.sweep()).toEqual(['s-1'])
    expect(observed[0]?.reply).toBe('做完了')
  })

  it('关掉 fallbackObserve 就完全不扫、也不写跳过记录', async () => {
    const { sweeper, records } = setup({ settings: { fallbackObserve: false } })
    await sweeper.noteSkip('s-1', undefined, '没有累积状态')
    expect(await sweeper.sweep()).toEqual([])
    expect(records.list()).toHaveLength(0)
  })
})

describe('触发端接线', () => {
  function wiring(over: { log?: Event[] } = {}) {
    const captured: ObserverTurnInput[] = []
    const { records, tracker, sweeper } = setup(over)
    const observer = {
      waiter: { finish: () => {}, cancel: () => {} },
      enqueue: <T>(job: () => Promise<T>) => job(),
      run: async (input: ObserverTurnInput) => {
        captured.push(input)
        return null
      },
    }
    const handlers = createHandlers({
      observer: observer as unknown as Observer,
      settings: () => ({ ...DEFAULT_SETTINGS }),
      log: () => {},
      captureQuestion: async () => {},
      tracker,
      seen: new SeenTracker(),
      fallback: sweeper,
    })
    return { captured, records, handlers, tracker }
  }

  it('tool-jobs 触发的回合也算一轮：会被观察', async () => {
    const { handlers, captured } = wiring()
    handlers.onSessionEvent(session, triggerEvent('tool-jobs', '后台任务完成', 1))
    handlers.onSessionEvent(session, replyEvent('继续做完了', 2, 2))
    handlers.onAgentStatus({ agent: { id: 's-1' }, status: 'idle' })
    await idleTick()
    await idleTick()
    expect(captured).toHaveLength(1)
    expect(captured[0]?.triggerSourceKind).toBe('system')
  })

  it('只有 time-context 心跳的回合被跳过，并写一条 records(status=skipped)', async () => {
    const { handlers, captured, records } = wiring()
    handlers.onSessionEvent(session, triggerEvent('time-context', 'Time sampled', 1))
    handlers.onSessionEvent(session, replyEvent('这轮没有真人输入', 1, 2))
    handlers.onAgentStatus({ agent: { id: 's-1' }, status: 'idle' })
    await idleTick()
    await idleTick()
    await new Promise((resolve) => setTimeout(resolve, 5))
    const list = records.list()
    expect(captured).toHaveLength(0)
    expect(list).toHaveLength(1)
    expect(list[0]?.status).toBe('skipped')
    expect(list[0]?.skipReason).toContain('没有轮次触发器')
  })
})
