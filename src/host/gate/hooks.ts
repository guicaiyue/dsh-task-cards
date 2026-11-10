// 把闸门的 pre-execute 监听器挂到 agent 作用域。
//
// 宿主按 ctx 作用域过滤 listener：插件根 ctx 可能收不到某个 agent 的工具调用，
// 而 agent.ctx 一定收得到（这正是 dsh 的 scope 语义）。

import type { Card, Settings } from '../../shared/contract'
import { asRecord, asString, type ToolExecutionLike } from '../host-api'
import {
  ALLOW_GRACE_MS,
  cardIdOfAllow,
  consumeAllow,
  issueAllow,
  permitKey,
  revokeAllow,
  usedAtOf,
} from './allow'
import { classifyTurnCall, type GateDecision } from './classify'

const CARD_REF_TTL_MS = 15 * 60 * 1000
const HOOKS_KEY = Symbol.for('dsh-task-cards.gate-hooks')

export interface GateRootLike {
  inject(names: string[], callback: (ctx: unknown) => void): unknown
  on(
    type: string,
    handler: (...args: unknown[]) => unknown,
    options?: { prepend?: boolean; global?: boolean },
  ): unknown
  effect(fn: () => (() => void) | undefined, label: string): unknown
}

interface HookEntry {
  owner: object
  dispose: () => void
}

function hooksRegistry(): { current?: HookEntry } {
  const bag = globalThis as unknown as Record<symbol, { current?: HookEntry } | undefined>
  const existing = bag[HOOKS_KEY]
  if (existing) return existing
  const created: { current?: HookEntry } = {}
  bag[HOOKS_KEY] = created
  return created
}

export interface HookInstallOptions {
  owner: object
  handler: (...args: unknown[]) => Promise<unknown>
  guardCall: (exec: unknown) => string | undefined
  selfTest: () => void
  log: (line: string) => void
}

/**
 * 注册工具门禁监听器（单实例）。
 *
 * 为什么单实例：HMR 会留下旧实例的 listener，两条都跑会出现「先放行又被第二条拦」、
 * 同一命令出现多个 hash/多张卡。新实例 attach 时先 dispose 上一个实例的注册。
 */
function installOnCtx(
  ctx: unknown,
  options: HookInstallOptions,
  keep: (value: unknown) => void,
): { guardActive: boolean; listenerRegistered: boolean } {
  const tools = asRecord(ctx).tools
  const guard = asRecord(tools).guard
  let guardActive = false
  let listenerRegistered = false
  if (typeof guard === 'function') {
    keep(guard.call(tools, (exec: unknown) => options.guardCall(exec)))
    guardActive = true
  }
  const on = asRecord(ctx).on
  const effect = asRecord(ctx).effect
  if (typeof on === 'function') {
    keep(on.call(ctx, 'tools/pre-execute', options.handler, { prepend: true, global: true }))
    listenerRegistered = true
    // 照抄宿主自带插件（dsh-experimental-auto-review）的 effect 生成器写法。
    if (typeof effect === 'function')
      effect.call(ctx, function* register() {
        yield on.call(ctx, 'tools/pre-execute', options.handler, { prepend: true, global: true })
      })
  }
  return { guardActive, listenerRegistered }
}

export function installHooks(
  root: GateRootLike,
  options: HookInstallOptions,
): { mode: 'guard' | 'pre-execute'; listenerRegistered: boolean; guardActive: boolean } {
  const registry = hooksRegistry()
  registry.current?.dispose()
  const disposers: Array<() => void> = []
  const keep = (value: unknown) => {
    if (typeof value === 'function') disposers.push(value as () => void)
  }
  let guardActive = false
  let listenerRegistered = false
  let dispatchSeen = false
  const { handler, log } = options

  registry.current = {
    owner: options.owner,
    dispose: () => {
      for (const fn of disposers.reverse()) {
        try {
          fn()
        } catch {
          // 注册器随宿主回收：忽略重复 dispose。
        }
      }
    },
  }
  root.inject(['tools'], (ctx: unknown) => {
    const state = installOnCtx(ctx, options, keep)
    guardActive = state.guardActive
    listenerRegistered = state.listenerRegistered
    log(`回合内闸门：已注册 listener=${listenerRegistered} · guard=${guardActive}`)
    options.selfTest()
  })
  keep(root.on('tools/pre-execute', handler, { prepend: true, global: true }))
  listenerRegistered = true
  log(`回合内闸门：根 ctx listener 已注册=${listenerRegistered}`)
  root.on('internal/dispatch', (...args: unknown[]) => {
    if (dispatchSeen || asString(args[1]) !== 'tools/pre-execute') return
    dispatchSeen = true
    log('闸门探针：本 ctx 收到 tools/pre-execute 派发')
  })
  root.effect(
    () => () => {
      const current = hooksRegistry().current
      if (current?.owner !== options.owner) return undefined
      current.dispose()
      hooksRegistry().current = undefined
      return undefined
    },
    'dsh-task-cards: gate hooks',
  )
  return { mode: guardActive ? 'guard' : 'pre-execute', listenerRegistered, guardActive }
}

export interface AgentScopeCtx {
  agents?: { get?(id: string): unknown }
}

/** 每个会话只挂一次；返回是否真的挂上了。 */
export function attachAgentScope(input: {
  sessionId: string
  ctx: AgentScopeCtx | null
  attached: Set<string>
  handler: (...args: unknown[]) => Promise<unknown>
  log?: (line: string) => void
}): boolean {
  const { sessionId, ctx, attached, handler, log } = input
  if (attached.has(sessionId)) return false
  if (!ctx?.agents?.get) return false
  const agent = asRecord(ctx.agents.get(sessionId))
  const target = asRecord(agent).ctx
  const on = asRecord(target).on
  if (typeof on !== 'function') return false
  attached.add(sessionId)
  on.call(target, 'tools/pre-execute', handler, { prepend: true })
  log?.(`闸门回调：已挂到 agent 作用域 ${sessionId}`)
  return true
}

/** 清掉过期的「同 key 已建卡」登记（以及可能残留的券）。 */
export function pruneCards(cards: Map<string, { cardId: string; at: number }>, now: number): void {
  for (const [key, ref] of cards) {
    if (now - ref.at < CARD_REF_TTL_MS) continue
    cards.delete(key)
    revokeAllow(key)
  }
}

/** 发券：approve 时把这张卡对应的「同签名一次放行」写进券表。 */
export function grantAllow(input: {
  card: Card
  cardsByKey: Map<string, { cardId: string; at: number }>
  key: string
  now: number
}): string | null {
  const gate = input.card.gate
  if (!gate) return null
  issueAllow(gate.permitKey || input.key, input.now, input.card.id)
  // 不删卡登记：宽限期内同 key 命中要能复用同一张卡（宽限过期由 inspectCall 清）。
  return `${input.card.id} → ${gate.tool}`
}

/** 清券：deny 时撤掉可能的放行券与去重登记。 */
export function revokeFor(
  card: Card,
  cardsByKey: Map<string, { cardId: string; at: number }>,
  key: string,
): void {
  if (!card.gate) return
  revokeAllow(key)
  cardsByKey.delete(key)
}

export interface Inspection {
  decision: GateDecision
  /** 语义身份 key（券与卡去重共用）。 */
  key: string
  sessionId: string
  toolName: string
  existing: string | null
}

/** 判定一次工具调用：要不要拦、有没有券、是不是已经建过卡。 */
export function inspectCall(input: {
  exec: ToolExecutionLike
  settings: () => Settings
  now: number
  cardsByKey: Map<string, { cardId: string; at: number }>
  log: (line: string) => void
  graceMs?: number
}): Inspection | null {
  const { exec, settings, now, cardsByKey, log } = input
  const mode = settings().turnGate ?? 'high-risk'
  if (mode === 'off') return null
  const agent = asRecord(exec.agent)
  const sessionId = asString(agent.id) || asString(agent.sessionId)
  const cwd = asString(asRecord(asRecord(agent.session).header).cwd)
  const decision = classifyTurnCall(
    { tool: exec.name, args: asRecord(exec.arguments), cwd },
    { mode, cwd },
  )
  if (!decision.gate) return null
  const key = permitKey({
    sessionId,
    tool: exec.name,
    effect: decision.effect,
    target: decision.target,
  })
  // 一次性调试：把真正参与券匹配的字符串打出来（排查「批准后仍拦」用）。
  const shownBag = globalThis as unknown as Record<symbol, boolean | undefined>
  const shownKey = Symbol.for('dsh-task-cards.gate-key-shown')
  if (!shownBag[shownKey]) {
    shownBag[shownKey] = true
    log(`闸门 key 调试：key=${key}`)
  }
  const usedBefore = usedAtOf(key)
  if (consumeAllow(key, now, input.graceMs ?? ALLOW_GRACE_MS)) {
    const cardId = cardsByKey.get(key)?.cardId ?? cardIdOfAllow(key)
    // 可见凭据：日志明确写出「哪张卡的券被用掉了」，agent 的 `rm` 无输出也能事后核对。
    log(
      `闸门放行（一次性券）：${exec.name} ${decision.target} key=${key} card=${cardId ?? '(未知)'}`,
    )
    return null
  }
  // 券已用且宽限已过（刚失效的这一下）：同 key 的卡登记一并清掉，
  // 下次命中重新建卡——「一次性」语义在宽限结束后仍然成立。
  if (usedBefore !== null) cardsByKey.delete(key)
  const existing = cardsByKey.get(key)?.cardId ?? null
  log(
    `闸门命中：${decision.reasons.join(',') || decision.effect} | ${decision.target} | ${existing ? `card=${existing}` : '待建卡'}`,
  )
  return { decision, key, sessionId, toolName: exec.name, existing }
}

/** 一张卡对应的券 key：优先用卡上存的 permitKey（新建卡都带），旧卡现算。 */
export function keyOfCard(card: Card): string | null {
  const gate = card.gate
  if (!gate) return null
  return (
    gate.permitKey ||
    permitKey({
      sessionId: gate.sessionId || card.origin?.sessionId || '',
      tool: gate.tool,
      effect: gate.effect,
      target: gate.target,
    })
  )
}
