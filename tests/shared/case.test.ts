// 状态机测试：迁移表、阶段映射、重放确定性。
//
// 这些用例不碰存储，纯函数穷举；任何一条挂了都说明「事件流不再可信」。

import { describe, expect, it } from 'vitest'
import {
  type CaseEvent,
  canTransition,
  phaseOf,
  pickWaitReason,
  replay,
  transition,
} from '../../src/shared/case'
import type { Actor, DeliveryState } from '../../src/shared/contract'
import { DELIVERY_STATES } from '../../src/shared/contract'

const ACTORS: Actor[] = [
  'observer',
  'decision',
  'scheduler',
  'executor',
  'verifier',
  'user',
  'system',
]

function event(over: Partial<CaseEvent> = {}): CaseEvent {
  return {
    id: 'e-1',
    caseId: 'c-1',
    traceId: 'tr-1',
    at: 1,
    phase: 'execute',
    from: 'idle',
    to: 'waiting',
    actor: 'scheduler',
    authority: 'system',
    reason: 'test',
    evidenceRefs: [],
    policyVersion: 3,
    ...over,
  }
}

describe('阶段映射', () => {
  it('每个投递状态都有确定的阶段，不会漏', () => {
    for (const state of DELIVERY_STATES) {
      expect(phaseOf(state)).toBeTruthy()
    }
    expect(phaseOf('idle')).toBe('sense')
    expect(phaseOf('waiting')).toBe('decide')
    expect(phaseOf('dispatched')).toBe('execute')
    expect(phaseOf('verifying')).toBe('verify')
    expect(phaseOf('failed')).toBe('closed')
    expect(phaseOf('invalidated')).toBe('closed')
  })
})

describe('迁移表', () => {
  it('合法路径能被对应角色推进', () => {
    expect(canTransition('idle', 'waiting', 'scheduler')).toBe(true)
    expect(canTransition('waiting', 'leased', 'scheduler')).toBe(true)
    expect(canTransition('leased', 'dispatched', 'executor')).toBe(true)
    expect(canTransition('dispatched', 'executed', 'executor')).toBe(true)
    expect(canTransition('executed', 'verifying', 'verifier')).toBe(true)
    expect(canTransition('verifying', 'confirmed', 'system')).toBe(true)
    expect(canTransition('verifying', 'failed', 'decision')).toBe(true)
    expect(canTransition('failed', 'idle', 'scheduler')).toBe(true)
    expect(canTransition('unknown', 'idle', 'decision')).toBe(true)
    expect(canTransition('invalidated', 'idle', 'user')).toBe(true)
  })

  it('非法路径一律拒绝：跨层跳、越权、回退', () => {
    expect(canTransition('idle', 'confirmed', 'system')).toBe(false)
    expect(canTransition('waiting', 'dispatched', 'scheduler')).toBe(false)
    expect(canTransition('dispatched', 'confirmed', 'executor')).toBe(false)
    expect(canTransition('confirmed', 'dispatched', 'system')).toBe(false)
    expect(canTransition('verifying', 'confirmed', 'executor')).toBe(false)
    expect(canTransition('invalidated', 'confirmed', 'system')).toBe(false)
  })

  it('每个状态都至少有一条出边（没有死胡同）', () => {
    for (const from of DELIVERY_STATES) {
      const hasExit = DELIVERY_STATES.some(
        (to) => from !== to && ACTORS.some((actor) => canTransition(from, to, actor)),
      )
      expect(hasExit, `${from} 是死胡同`).toBe(true)
    }
  })

  it('穷举 10×10 组合：能走的必须给 phase，不能走的必须给错误码', () => {
    let allowedCount = 0
    for (const from of DELIVERY_STATES) {
      for (const to of DELIVERY_STATES) {
        if (from === to) continue
        const anyActor = ACTORS.some((actor) => canTransition(from, to, actor))
        if (!anyActor) continue
        allowedCount += 1
        const result = transition({
          from,
          to,
          actor: ACTORS.filter((actor) => canTransition(from, to, actor))[0] as Actor,
          authority: 'system',
          reason: 'matrix',
          policyVersion: 3,
        })
        expect(result.ok, `${from} → ${to} 应通过`).toBe(true)
        if (result.ok) expect(result.phase).toBe(phaseOf(to))
      }
    }
    expect(allowedCount).toBeGreaterThan(15)
  })

  it('同态与未知状态被拒绝，并给出错误码', () => {
    const same = transition({
      from: 'idle',
      to: 'idle',
      actor: 'scheduler',
      authority: 'system',
      reason: 'noop',
      policyVersion: 3,
    })
    expect(same.ok).toBe(false)
    if (!same.ok) expect(same.code).toBe('SAME_STATE')

    const bogus = transition({
      from: 'idle',
      to: 'nope' as DeliveryState,
      actor: 'scheduler',
      authority: 'system',
      reason: 'bogus',
      policyVersion: 3,
    })
    expect(bogus.ok).toBe(false)
    if (!bogus.ok) expect(bogus.code).toBe('ILLEGAL_TRANSITION')

    const unauthorized = transition({
      from: 'verifying',
      to: 'confirmed',
      actor: 'executor',
      authority: 'system',
      reason: 'self-certify',
      policyVersion: 3,
    })
    expect(unauthorized.ok).toBe(false)
    if (!unauthorized.ok) expect(unauthorized.code).toBe('ACTOR_NOT_ALLOWED')
  })
})

describe('重放', () => {
  it('顺序重放得到最终状态与阶段', () => {
    const events = [
      event({ from: 'idle', to: 'waiting' }),
      event({ from: 'waiting', to: 'leased', phase: 'execute' }),
      event({ from: 'leased', to: 'dispatched', phase: 'execute' }),
      event({ from: 'dispatched', to: 'executed', phase: 'execute' }),
      event({ from: 'executed', to: 'verifying', phase: 'verify' }),
      event({ from: 'verifying', to: 'failed', phase: 'closed' }),
    ]
    const state = replay(events)
    expect(state.deliveryState).toBe('failed')
    expect(state.phase).toBe('closed')
    expect(state.revisions).toBe(events.length)
  })

  it('空事件流回到 idle，坏事件被跳过', () => {
    expect(replay([])).toEqual({ deliveryState: 'idle', phase: 'sense', revisions: 0 })
    const dirty = [
      event({ to: 'waiting' }),
      event({ to: 'bogus' as DeliveryState }),
      event({ to: 'leased' }),
    ]
    const state = replay(dirty)
    expect(state.deliveryState).toBe('leased')
    expect(state.revisions).toBe(2)
  })

  it('重放与逐条 transition 的结果一致', () => {
    const chain: Array<[DeliveryState, DeliveryState, Actor]> = [
      ['idle', 'waiting', 'scheduler'],
      ['waiting', 'leased', 'scheduler'],
      ['leased', 'dispatched', 'executor'],
      ['dispatched', 'executed', 'executor'],
      ['executed', 'verifying', 'verifier'],
      ['verifying', 'confirmed', 'system'],
    ]
    const events: CaseEvent[] = []
    for (const [from, to, actor] of chain) {
      expect(canTransition(from, to, actor)).toBe(true)
      events.push(event({ from, to, actor }))
    }
    expect(replay(events).deliveryState).toBe(chain[chain.length - 1]?.[1])
  })
})

describe('等待原因优先级', () => {
  it('决策类原因优先于资源类原因', () => {
    expect(pickWaitReason(['queued', 'wip-limit'])).toBe('wip-limit')
    expect(pickWaitReason(['wip-limit', 'awaiting-user-escalation'])).toBe(
      'awaiting-user-escalation',
    )
    expect(pickWaitReason(['session-busy', 'awaiting-decision'])).toBe('awaiting-decision')
  })

  it('空集合返回 null，未知原因保底返回第一个', () => {
    expect(pickWaitReason([])).toBeNull()
    expect(pickWaitReason(['lease-expired', 'queued'])).toBe('lease-expired')
  })
})
