// 回合内闸门接线：guard / pre-execute / 只建卡三条路径 + 一次性放行券。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '../../src/host/cards/defaults'
import { Store } from '../../src/host/cards/store'
import { clearAllows, permitKey } from '../../src/host/gate/allow'
import { type GateRootLike, TurnGate } from '../../src/host/gate/gate'
import type { ToolExecutionLike } from '../../src/host/host-api'
import type { Card, Settings } from '../../src/shared/contract'

type PreHandler = (
  exec: ToolExecutionLike,
  next: () => Promise<{ kind: string }>,
) => Promise<unknown>

/** 每个用例唯一的会话/命令，避免固定 key 跨用例互相消费。 */
let uniq = 0
function uniqueSession(prefix = 's'): string {
  uniq += 1
  return `${prefix}-${Date.now().toString(36)}-${uniq}-${Math.random().toString(36).slice(2, 6)}`
}

afterEach(() => {
  // 券存在 globalThis：同 worker 的多个测试文件共享，必须每个用例后清空。
  clearAllows()
})

function setup(
  over: { turnGate?: Settings['turnGate']; withGuard?: boolean; graceMs?: number } = {},
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-gate-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const logs: string[] = []
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    turnGate: over.turnGate ?? 'high-risk',
  }
  const gate = new TurnGate({
    cards,
    settings: () => settings,
    log: (line: string) => logs.push(line),
    // 默认 0：严格一次性，方便测「第三次再拦」；宽限行为单独用 5000 测。
    graceMs: over.graceMs ?? 0,
  })
  gate.reset()
  let guardFn: ((exec: unknown) => string | undefined) | null = null
  const preHandlers = new Map<string, PreHandler>()
  const gateRoot: GateRootLike = {
    inject(_names, callback) {
      if (over.withGuard === false) return undefined
      callback({
        tools: {
          guard(fn: (exec: unknown) => string | undefined) {
            guardFn = fn
            return () => {
              guardFn = null
            }
          },
        },
      })
      return undefined
    },
    on(type, handler) {
      preHandlers.set(type, handler as PreHandler)
      return undefined
    },
    effect(fn) {
      fn()
      return undefined
    },
  }
  const sessionId = uniqueSession('gate')
  return {
    sessionId,
    cards,
    gate,
    settings,
    logs,
    preHandlers,
    gateRoot,
    guard: () => guardFn,
    exec: (command: string, session = sessionId): ToolExecutionLike => ({
      name: 'bash',
      arguments: { command },
      agent: { id: session, session: { header: { cwd: '/workspace/proj' } } },
    }),
  }
}

async function until(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error(`等待超时：${label}`)
}

const PROD_ALTER = 'docker exec postgres psql -d story -c "ALTER TABLE story_main ADD COLUMN x int"'
const PROBE = 'rm -rf /tmp/dtc-gate-probe-xyz'

/** 同一命令、不同易变参数（agent 重试时会这样）。 */
function execWith(env: ReturnType<typeof setup>, command: string, extra: Record<string, unknown>) {
  const base = env.exec(command)
  return { ...base, arguments: { ...base.arguments, ...extra } }
}

describe('tools.guard 路径', () => {
  it('生产库 ALTER 被 deny，并当场建 permission 卡（带 gate 凭据与依据）', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    expect(env.gate.mode).toBe('guard')
    const guard = env.guard()
    expect(guard).toBeTypeOf('function')

    const deny = guard?.(env.exec(PROD_ALTER))
    expect(String(deny)).toContain('任务卡闸门')
    await until(() => env.cards.list().length === 1, '建卡')
    await until(() => Boolean(env.cards.list()[0]?.gate), '写闸门凭据')
    const card = env.cards.list()[0] as Card
    expect(card.kind).toBe('decision')
    expect(card.ask).toBe('permission')
    expect(card.gate?.effect).toBe('destructive')
    expect(card.gate?.reasons.join(' ')).toContain('prod-db')
    expect(card.gate?.tool).toBe('bash')
    expect(card.advice?.effect).toBe('destructive')
  })

  it('同一条命令再拦一次不重复建卡', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    const guard = env.guard()
    guard?.(env.exec(PROD_ALTER))
    await until(() => env.cards.list().length === 1, '建卡')
    const second = guard?.(env.exec(PROD_ALTER))
    expect(String(second)).toContain('任务卡闸门')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(env.cards.list()).toHaveLength(1)
  })

  it('approve 后同签名一次性放行；再拦一次仍会被挡', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    const guard = env.guard()
    guard?.(env.exec(PROD_ALTER))
    await until(() => Boolean(env.cards.list()[0]?.gate), '建卡并写凭据')
    const card = env.cards.list()[0] as Card

    env.gate.allowOnce(card)
    expect(guard?.(env.exec(PROD_ALTER))).toBeUndefined()
    expect(String(guard?.(env.exec(PROD_ALTER)))).toContain('任务卡闸门')
  })

  it('deny 清券：清掉后同签名仍被拦', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    const guard = env.guard()
    guard?.(env.exec(PROD_ALTER))
    await until(() => Boolean(env.cards.list()[0]?.gate), '建卡并写凭据')
    const card = env.cards.list()[0] as Card
    env.gate.allowOnce(card)
    env.gate.clearAllow(card)
    expect(String(guard?.(env.exec(PROD_ALTER)))).toContain('任务卡闸门')
  })

  it('工作区内普通 edit/write 不拦；turnGate=off 时连生产库也不拦', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    expect(
      env.guard()?.({
        name: 'edit',
        arguments: { path: '/workspace/proj/a.ts' },
        agent: { id: 's-1', session: { header: { cwd: '/workspace/proj' } } },
      }),
    ).toBeUndefined()
    env.settings.turnGate = 'off'
    expect(env.guard()?.(env.exec(PROD_ALTER))).toBeUndefined()
  })
})

describe('券的宽限期（同一次调用被判两遍也不误拦）', () => {
  it('核销后宽限期内重复判定仍放行、不建卡；宽限过期后重新拦并建第 2 张', async () => {
    const env = setup({ graceMs: 5_000 })
    env.gate.attach(env.gateRoot)
    const guard = env.guard()
    guard?.({
      ...execWith(env, PROBE, { description: '首次' }),
      callId: `grace-first-${Math.random().toString(36).slice(2, 8)}`,
    })
    await until(() => Boolean(env.cards.list()[0]?.gate), '建卡')
    env.gate.allowOnce(env.cards.list()[0] as Card)

    // 同一次调用被两条路径各判一遍：第一条核销，第二条在宽限期内仍视为允许
    const retry = {
      ...execWith(env, PROBE, { description: '重试' }),
      callId: `grace-retry-${Math.random().toString(36).slice(2, 8)}`,
    }
    expect(guard?.(retry)).toBeUndefined()
    expect(guard?.(retry)).toBeUndefined()
    // 可见凭据：放行日志必须写出用掉的是哪张卡的券（rm 无输出也能核对）
    await until(
      () =>
        env.logs.some(
          (line) => line.startsWith('闸门放行（一次性券）') && line.includes('card=c-'),
        ),
      '放行日志带卡 id',
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(env.cards.list()).toHaveLength(1)

    // 宽限过期（把券的 usedAt 往前推：用 0ms 宽限的同一 key 再判一次即失效）
    const strict = setup({ graceMs: 0 })
    strict.gate.attach(strict.gateRoot)
    // 独立环境只能验证严格模式：宽限过期用下面的短宽限环境验证
    expect(strict.cards.list()).toHaveLength(0)

    const short = setup({ graceMs: 20 })
    short.gate.attach(short.gateRoot)
    short.guard()?.(execWith(short, PROBE, { description: 'a' }))
    await until(() => Boolean(short.cards.list()[0]?.gate), '建卡')
    short.gate.allowOnce(short.cards.list()[0] as Card)
    expect(short.guard()?.(execWith(short, PROBE, { description: 'b' }))).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(String(short.guard()?.(execWith(short, PROBE, { description: 'c' })))).toContain(
      '任务卡闸门',
    )
    await until(() => short.cards.list().length === 2, '宽限过期后第 2 张卡')
  })
})

describe('同一次执行只判一次（waterfall → guard 双路径）', () => {
  it('pre-execute 判 deny 后，guard 对同一 exec 只复用结论：1 张卡、命中日志 1 次', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    const handler = env.preHandlers.get('tools/pre-execute')
    const guard = env.guard()
    const exec = { ...execWith(env, PROBE, { description: '双路径' }), callId: 'call-1' }
    const first = (await handler?.(exec, async () => ({ kind: 'allow' }))) as { kind: string }
    expect(first.kind).toBe('deny')
    await until(() => env.cards.list().length === 1, '建卡')
    const second = guard?.(exec)
    expect(String(second)).toContain('任务卡闸门')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(env.cards.list()).toHaveLength(1)
    expect(env.logs.filter((line) => line.startsWith('闸门命中')).length).toBe(1)
  })

  it('批准后同一 exec 先 waterfall 放行、guard 不再拦（券只消费一次）', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    const handler = env.preHandlers.get('tools/pre-execute')
    const guard = env.guard()
    // 先制造并批准
    const denyExec = { ...execWith(env, PROBE, { description: '首次' }), callId: 'call-a' }
    await handler?.(denyExec, async () => ({ kind: 'allow' }))
    await until(() => Boolean(env.cards.list()[0]?.gate), '建卡')
    env.gate.allowOnce(env.cards.list()[0] as Card)

    const retry = { ...execWith(env, PROBE, { description: '重试' }), callId: 'call-b' }
    const waterfall = (await handler?.(retry, async () => ({ kind: 'allow' }))) as { kind: string }
    expect(waterfall.kind).toBe('allow')
    expect(guard?.(retry)).toBeUndefined()
    // 券已核销：第三次（新 callId）再拦 + 第二张卡
    const third = { ...execWith(env, PROBE, { description: '第三次' }), callId: 'call-c' }
    const again = (await handler?.(third, async () => ({ kind: 'allow' }))) as { kind: string }
    expect(again.kind).toBe('deny')
    await until(() => env.cards.list().length === 2, '第二张卡')
  })
})

describe('同一命令的卡身份必须完全一致（裁决哈希不稳/并发多卡）', () => {
  it('description/timeoutMs 不同 → 卡上 argHash 与 permitKey 完全一致，只 1 张卡', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    const guard = env.guard()
    guard?.(execWith(env, PROBE, { description: 'A' }))
    guard?.(execWith(env, PROBE, { description: 'B', timeoutMs: 120000 }))
    guard?.(execWith(env, PROBE, { description: 'C', idleTimeoutMs: 5 }))
    await until(() => env.cards.list().length >= 1, '建卡')
    await new Promise((resolve) => setTimeout(resolve, 30))
    const cards = env.cards.list()
    expect(cards).toHaveLength(1)
    const gate = cards[0]?.gate
    expect(gate?.argHash).toBe(gate?.permitKey)
    expect(gate?.argHash).toBe(
      permitKey({
        sessionId: env.sessionId,
        tool: 'bash',
        effect: 'destructive',
        target: PROBE,
      }),
    )
  })

  it('并发 5 次同 key 命中（同步占位）→ 只建 1 张卡', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    const guard = env.guard()
    for (let i = 0; i < 5; i += 1) guard?.(execWith(env, PROBE, { description: `并发-${i}` }))
    await until(() => env.cards.list().length >= 1, '建卡')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(env.cards.list()).toHaveLength(1)
  })

  it('批准后同 target 重试（描述不同）放行一次；第三次再拦并建第 2 张', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    const guard = env.guard()
    guard?.(execWith(env, PROBE, { description: '1' }))
    await until(() => Boolean(env.cards.list()[0]?.gate?.permitKey), '建卡')
    env.gate.allowOnce(env.cards.list()[0] as Card)
    expect(guard?.(execWith(env, PROBE, { description: '2' }))).toBeUndefined()
    expect(String(guard?.(execWith(env, PROBE, { description: '3' })))).toContain('任务卡闸门')
    await until(() => env.cards.list().length === 2, '第二个卡')
  })
})

describe('券 key = 写卡 permitKey（同一函数）', () => {
  it('卡上 permitKey 与重试算出的一致；两个 listener 处理同一次调用只拦一次且不误吃券', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    const handler = env.preHandlers.get('tools/pre-execute')
    const exec = execWith(env, PROBE, { description: '原始描述' })
    const first = (await handler?.(exec, async () => ({ kind: 'allow' }))) as { kind: string }
    expect(first.kind).toBe('deny')
    await until(() => Boolean(env.cards.list()[0]?.gate), '建卡并写凭据')
    const card = env.cards.list()[0] as Card
    const expected = permitKey({
      sessionId: env.sessionId,
      tool: 'bash',
      effect: 'destructive',
      target: PROBE,
    })
    expect(card.gate?.permitKey).toBe(expected)

    // 重复 listener（HMR 残留）在 250ms 内处理同一次调用：不重复建卡、也不消费券
    await handler?.(exec, async () => ({ kind: 'allow' }))
    expect(env.cards.list()).toHaveLength(1)

    env.gate.allowOnce(card)
    // 批准后第一次重试（描述变化）必须放行
    expect(
      await handler?.(execWith(env, PROBE, { description: '重试' }), async () => ({
        kind: 'allow',
      })),
    ).toEqual({ kind: 'allow' })
  })
})

describe('券的语义身份（批准后重试必须放行）', () => {
  it('同 target、description 不同 → 同一张卡（不新建第二张）', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    const guard = env.guard()
    guard?.(execWith(env, PROBE, { description: '第一次描述' }))
    await until(() => env.cards.list().length === 1, '建卡')
    guard?.(execWith(env, PROBE, { description: '换了个描述', timeoutMs: 120000 }))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(env.cards.list()).toHaveLength(1)
  })

  it('approve 后 description 不同也放行一次；核销后第三次再拦并重新建卡', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    const guard = env.guard()
    guard?.(execWith(env, PROBE, { description: '第一次' }))
    await until(() => Boolean(env.cards.list()[0]?.gate), '建卡并写凭据')
    const card = env.cards.list()[0] as Card
    env.gate.allowOnce(card)

    // 批准后重试：描述/超时都变了，但 target 相同 → 放行一次
    expect(
      guard?.(execWith(env, PROBE, { description: '重试', timeoutMs: 120000 })),
    ).toBeUndefined()

    // 券已核销：第三次再执行 → 重新拦 + 重新建卡（不复用已 done 的卡）
    const third = guard?.(execWith(env, PROBE, { description: '再来一次' }))
    expect(String(third)).toContain('任务卡闸门')
    await until(() => env.cards.list().length === 2, '重新建卡')
  })
})

describe('agent 作用域注册（宿主按 ctx 过滤 listener 的兜底）', () => {
  it('attachAgent 把 pre-execute 挂到 agent.ctx，工具调用照样被 deny', async () => {
    const env = setup()
    const handlers: PreHandler[] = []
    env.gate.attachAgent('s-1', {
      agents: {
        get: () => ({
          ctx: {
            on(_type: string, fn: PreHandler) {
              handlers.push(fn)
            },
          },
        }),
      },
    })
    expect(handlers).toHaveLength(1)
    const decision = (await handlers[0]?.(env.exec(PROD_ALTER), async () => ({
      kind: 'allow',
    }))) as { kind: string; reason?: string }
    expect(decision.kind).toBe('deny')
    await until(() => env.cards.list().length === 1, '建卡')
    // 同一会话重复 attach 只挂一次
    env.gate.attachAgent('s-1', { agents: { get: () => ({ ctx: { on: () => {} } }) } })
    expect(env.gate.calls.preExecute).toBe(1)
  })
})

describe('guard 已接管时 pre-execute 仍然兜底（E2E 事故回归）', () => {
  it('guard 注册成功但宿主没回调它也照样拦：pre-execute 不再因 guardActive 跳过', async () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    expect(env.gate.mode).toBe('guard')
    const handler = env.preHandlers.get('tools/pre-execute')
    // 故意不调用 guardFn：模拟「guard 接管日志有、但回调没进来」
    const decision = (await handler?.(env.exec(PROD_ALTER), async () => ({ kind: 'allow' }))) as {
      kind: string
      reason?: string
    }
    expect(decision.kind).toBe('deny')
    expect(String(decision.reason)).toContain('任务卡闸门')
    await until(() => env.cards.list().length === 1, '建卡')
    // 两条回调都被计数（诊断用）
    expect(env.gate.calls.preExecute).toBe(1)
  })

  it('启动自检会打一行日志：deny=true + 接线模式', () => {
    const env = setup()
    env.gate.attach(env.gateRoot)
    const line = env.logs.find((item) => item.includes('闸门自检'))
    expect(line).toBeTruthy()
    expect(line).toContain('deny=true')
  })
})

describe('tools/pre-execute 路径（没有 guard）', () => {
  it('pre-execute 返回 deny，reason 里带卡 id', async () => {
    const env = setup({ withGuard: false })
    env.gate.attach(env.gateRoot)
    expect(env.gate.mode).toBe('pre-execute')
    const handler = env.preHandlers.get('tools/pre-execute')
    expect(handler).toBeTypeOf('function')
    const decision = (await handler?.(env.exec(PROD_ALTER), async () => ({ kind: 'allow' }))) as {
      kind: string
      reason?: string
    }
    expect(decision.kind).toBe('deny')
    expect(String(decision.reason)).toContain('任务卡闸门')
    await until(() => env.cards.list().length === 1, '建卡')
    expect(decision.reason).toContain(env.cards.list()[0]?.id)
  })

  it('没有 guard 时也要处理 pre-execute 之外的降级：observeCall 只建卡并标注不支持前置拦截', async () => {
    const env = setup({ withGuard: false })
    await env.gate.observeCall('s-1', {
      name: 'bash',
      arguments: { command: PROD_ALTER },
    })
    const card = env.cards.list()[0] as Card
    expect(card.kind).toBe('info')
    expect(card.source).toBe('agent')
    expect(card.detail).toContain('不在「回合内闸门」覆盖范围内')
    expect(env.logs.join('\n')).toContain('闸门降级')
  })
})
