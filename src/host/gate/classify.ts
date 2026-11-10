// 回合内危险动作分类：纯函数，输入一次工具调用，输出该不该拦 + 判定依据。
//
// 原则：宁可漏一条模式，也不误伤日常开发。边界匹配写死：
//   - 容器名按完整词匹配（生产 `postgres`；dev 叫 `story-dev-postgres`，不是子串命中）；
//   - 库名 `-d story` 不能匹配 `-d story_dev`（`_` 是词字符，`\b` 天然挡住）。
// 每条命中都带 `rule:<名字>` / `prod-db:<片段>`，写进卡上的 gate.reasons 供审计。

import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

import type { Effect } from '../../shared/contract'
import { RULES } from './rules'
import { nestedCommands, SHELL_DESTRUCTIVE, splitSegments } from './segments'

export type TurnGateMode = 'off' | 'high-risk' | 'all'

export interface TurnCallInput {
  tool: string
  args?: Record<string, unknown>
  cwd?: string
}

export interface GateDecision {
  /** 这次调用要不要拦。 */
  gate: boolean
  effect: Effect
  /** 命令片段 / 被写路径（截断），给卡片正文与日志用。 */
  target: string
  /** 判定依据：`rule:git-push-main`、`prod-db:psql -d story`。 */
  reasons: string[]
  /** 旧字段（兼容面板/卡片）：语义身份的哈希。新逻辑请用 permitKey。 */
  argHash: string
  /** 真正参与身份的行字符串：`tool\u0000effect\u0000target`（debug 用）。 */
  identity: string
}

const COMMAND_TOOLS = new Set(['bash', 'pwsh', 'sh', 'shell', 'terminal_open', 'terminal_send'])
const WRITE_TOOLS = new Set(['edit', 'write', 'str_replace_editor'])

const DDL_DML = /\b(alter|create|drop|truncate|insert|update|delete|grant|revoke)\b/i
const SPEND = /\b(stripe|paypal|charge|purchase|billing)\b|支付|下单|付款|购买|充值|扣费/i
const SECRET_PATH =
  /(^|\/)(\.env(\.[^/]*)?|id_rsa|id_ed25519|credentials)(\/|$)|(^|\/)\.ssh(\/|$)|^\/etc\//i

/** 从工具参数里取命令文本（bash/pwsh/terminal 系）。 */
export function commandOf(tool: string, args: Record<string, unknown> = {}): string {
  if (!COMMAND_TOOLS.has(tool)) return ''
  for (const key of ['command', 'cmd', 'script', 'input', 'text']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

/** 从工具参数里取被写的路径（edit/write/str_replace_editor）。 */
export function pathOf(tool: string, args: Record<string, unknown> = {}): string {
  if (!WRITE_TOOLS.has(tool)) return ''
  for (const key of ['path', 'file_path', 'filePath', 'file', 'target']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

export function isWriteTool(tool: string): boolean {
  return WRITE_TOOLS.has(tool) || tool.startsWith('mcp__')
}

function hashOf(identity: string): string {
  return createHash('sha256').update(identity).digest('hex').slice(0, 32)
}

/**
 * 语义身份：tool + effect + 归一化目标。
 *
 * 不能用「整个 arguments 哈希」——agent 重试同一命令时 `description`/`timeoutMs`
 * 之类易变字段会变，哈希就变了，批准发的券对不上重试的调用 → 批准后又被拦
 * （真实 bug：同一 target 两张卡、两个 argHash）。description 等不影响执行语义，
 * 不该进身份。
 */
function identityOf(tool: string, effect: string, target: string): string {
  return `${tool}\u0000${effect}\u0000${target}`
}

function isInside(cwd: string, target: string): boolean {
  if (!target.startsWith('/')) return true // 相对路径按工作区内算
  if (!cwd) return false
  const base = cwd.replace(/\/+$/, '')
  return target === base || target.startsWith(`${base}/`)
}

/** 单独一段是否命中破坏性规则（含 cd 跟随后的相对路径）。 */
function segmentHit(
  segment: string,
  cwd: string,
  workspace: string,
): { effect: Effect; reason: string } | null {
  const prod = prodDbReason(segment)
  if (prod) return { effect: 'destructive', reason: prod }
  const dev = devContainerReason(segment)
  if (dev) return { effect: 'destructive', reason: `rule:${dev}` }
  const push = gitPushReason(segment)
  if (push) return { effect: 'destructive', reason: `rule:${push}` }
  const rm = rmReason(segment, cwd, workspace)
  if (rm) return { effect: 'destructive', reason: `rule:${rm}` }
  const redirect = redirectReason(segment, cwd, workspace)
  if (redirect) return { effect: 'write-code', reason: `rule:${redirect}` }
  if (SHELL_DESTRUCTIVE.some((rule) => rule.test(segment)))
    return { effect: 'destructive', reason: 'rule:composite-destructive' }
  return null
}

/** 生产库写入：目标库/容器按词边界判生产，语句必须含 DDL/DML。 */
function prodDbReason(command: string): string | null {
  if (
    !/\b(psql|mysql|mariadb)\b/.test(command) &&
    !/\bdocker\s+(exec|compose\s+exec)\b/.test(command)
  )
    return null
  if (!DDL_DML.test(command)) return null
  const devDb = /(?:-d|--dbname)[=\s]+(?:story_dev|story_test|[A-Za-z0-9_]+_(?:dev|test))\b/i.test(
    command,
  )
  if (devDb && !/\b(drop\s+database|truncate)\b/i.test(command)) return null
  const prodDb = /(?:-d|--dbname)[=\s]+(?:story|postgres)\b(?!_)/i.test(command)
  const prodConn = /\/postgres(?:[?"'\s]|$)|\/story(?:[?"'\s]|$)/i.test(command)
  const container = prodContainerOf(command)
  if (!prodDb && !prodConn && !container) return null
  const basis = container ? `container:${container}` : prodDb ? 'db:prod' : 'conn:prod'
  return `prod-db:${basis}`
}

/** docker exec / compose exec 的目标容器：完整词匹配，不用子串（dev 叫 story-dev-postgres）。 */
function prodContainerOf(command: string): string | null {
  const match =
    /\bdocker\s+(?:compose\s+(?:-f\s+\S+\s+)?exec|exec)\s+(?:-\S+\s+)*([A-Za-z0-9_.-]+)/.exec(
      command,
    )
  const name = match?.[1]
  if (!name) return null
  if (name === 'postgres' || name === 'postgresql' || name === 'pg') return name
  return /^prod-[a-z0-9-]+$/.test(name) ? name : null
}

/** 停/重启/删开发容器 → 会把正在跑的会话打死。启动（up/start）不算。 */
function devContainerReason(command: string): string | null {
  const compose = /\bdocker\s+compose\s+(?:-f\s+\S+\s+)?(down|restart)\b/.exec(command)
  if (compose) {
    const touched = /\b(dsh-dev|story-[a-z0-9-]+)\b/.exec(command)
    return touched ? `dev-container:compose-${compose[1]}:${touched[0]}` : null
  }
  const direct = /\bdocker\s+(stop|restart|rm)\b/.exec(command)
  if (!direct) return null
  const touched = /\b(dsh-dev|story-[a-z0-9-]+)\b/.exec(command)
  return touched ? `dev-container:${direct[1]}:${touched[0]}` : null
}

/** git push：推 main/master（含 --force）拦，推特性分支放行。 */
function gitPushReason(command: string): string | null {
  const push = /\bgit\s+push\b/.exec(command)
  if (!push) return null
  const force = /\s(--force|-f)\b/.test(command)
  const target = /\b(main|master)\b/.exec(command)
  if (target) return `git-push-${target[1]}${force ? ':force' : ''}`
  if (force) return 'git-push:force'
  return null
}

/** rm 递归删：删到工作区外 / 工作区根本身才拦。 */
function absoluteOf(cwd: string, target: string): string {
  return isAbsolute(target) ? target : resolve(cwd, target)
}

function rmReason(command: string, cwd: string, workspace: string): string | null {
  const rm = /\brm\s+((?:-[a-zA-Z]+\s+)*)(.+)$/.exec(command.split(/[;&|]/)[0] ?? command)
  if (!rm) return null
  const flags = rm[1] ?? ''
  if (!/r/.test(flags)) return null
  const targets = (rm[2] ?? '').trim().split(/\s+/).filter(Boolean)
  const root = cwd.replace(/\/+$/, '')
  for (const target of targets) {
    if (root && target.replace(/\/+$/, '') === root) return `rm-workspace-root:${target}`
    // 相对路径按「当前段 cwd」解析，再用工作区根判定：cd /tmp 后的 probe-d = /tmp/probe-d。
    if (!isInside(workspace, absoluteOf(cwd, target))) return `rm-outside:${target}`
  }
  return null
}

/** sed -i / tee / 重定向 写到工作区外。 */
function redirectReason(command: string, cwd: string, workspace: string): string | null {
  const targets: string[] = []
  const sedInPlace = /\bsed\s+-i\b[^;&|]*\s(\/[^\s'"]+)/.exec(command)
  if (sedInPlace?.[1]) targets.push(sedInPlace[1])
  const tee = /\btee\s+(?:-a\s+)?(\/[^\s'"]+)/.exec(command)
  if (tee?.[1]) targets.push(tee[1])
  const redirect = /(?:^|\s)>{1,2}\s*(\/[^\s'"]+)/.exec(command)
  if (redirect?.[1]) targets.push(redirect[1])
  for (const target of targets) {
    if (/^\/(dev\/null|tmp\/|proc\/)/.test(target)) continue
    if (!isInside(workspace, absoluteOf(cwd, target))) return `write-outside:${target}`
  }
  return null
}

const EFFECT_STRENGTH: Record<Effect, number> = {
  read: 0,
  'write-code': 1,
  external: 2,
  spend: 3,
  destructive: 4,
}

function stronger(current: Effect | null, next: Effect): Effect {
  if (!current) return next
  return EFFECT_STRENGTH[next] > EFFECT_STRENGTH[current] ? next : current
}

/**
 * 分类一次工具调用。
 *
 * - `high-risk`（默认）：只拦下面这些，工作区内正常读写放行；
 * - `all`：连工作区内所有写工具都拦（极端场景用）；
 * - `off`：完全不拦（仍然分类，便于日志/测试）。
 */
export function classifyTurnCall(
  input: TurnCallInput,
  options: { mode?: TurnGateMode; cwd?: string } = {},
): GateDecision {
  const mode = options.mode ?? 'high-risk'
  const cwd = options.cwd ?? input.cwd ?? ''
  const command = commandOf(input.tool, input.args)
  const path = pathOf(input.tool, input.args)
  const reasons: string[] = []
  let effect: Effect | null = null
  const hit = (next: Effect, reason: string) => {
    effect = stronger(effect, next)
    reasons.push(reason)
  }

  if (command) {
    // 复合命令：分段 → 跟踪 cd → 每段单独判；任一段命中即拦（reason 带段号）。
    let segCwd = cwd
    // 跨段模式（curl|sh、docker … 之类）先按整串判一次，避免被分段拆散。
    for (const rule of RULES) {
      if (rule.pattern.test(command)) hit(rule.effect, `rule:${rule.name}:whole`)
    }
    const segments = splitSegments(command)
    for (const [index, segment] of segments.entries()) {
      const cd = /^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/.exec(segment)
      if (cd) {
        const target = cd[1] ?? cd[2] ?? cd[3] ?? ''
        segCwd = target.startsWith('/') ? target : `${segCwd.replace(/\/+$/, '')}/${target}`
        continue
      }
      for (const inner of nestedCommands(segment)) {
        for (const innerSegment of splitSegments(inner)) {
          const nestedHit = segmentHit(innerSegment, segCwd, cwd)
          if (nestedHit) hit(nestedHit.effect, `${nestedHit.reason}:nested#${index + 1}`)
        }
      }
      // 跨段规则（如 `curl … | sh`）在整串上先判一次。
      const wholeHit = segmentHit(segment, segCwd, cwd)
      const segHit = wholeHit
      if (segHit) hit(segHit.effect, `${segHit.reason}:seg#${index + 1}`)
      for (const rule of RULES) {
        if (rule.pattern.test(segment)) hit(rule.effect, `rule:${rule.name}:seg#${index + 1}`)
      }
      if (SPEND.test(segment)) hit('spend', `rule:spend:seg#${index + 1}`)
    }
    // DELETE 没有 WHERE 是全表删：单独判（有多条语句时宁可漏也不误伤）。
    if (/\bdelete\s+from\b/i.test(command) && !/\bwhere\b/i.test(command))
      hit('destructive', 'rule:delete-no-where')
    if (SPEND.test(command)) hit('spend', 'rule:spend')
    if (SECRET_PATH.test(command) && /\b(tee|cat\s*>|>|cp|mv|chmod)\b/.test(command))
      hit('write-code', 'rule:secret-path')
  }

  if (path && (WRITE_TOOLS.has(input.tool) || input.tool.startsWith('mcp__'))) {
    if (SECRET_PATH.test(path)) hit('write-code', 'rule:secret-path')
    if (!isInside(cwd, path)) hit('write-code', 'rule:write-outside')
  }
  if (SPEND.test(JSON.stringify(input.args ?? {}))) hit('spend', 'rule:spend')

  const allMode = mode === 'all' && (isWriteTool(input.tool) || Boolean(command) || Boolean(path))
  const gate = mode !== 'off' && (effect !== null || allMode)
  const finalEffect = effect ?? 'read'
  const target = (command || path).replace(/\s+/g, ' ').trim().slice(0, 120)
  const identity = identityOf(input.tool, finalEffect, target)
  return {
    gate,
    effect: finalEffect,
    target,
    reasons,
    argHash: hashOf(identity),
    identity,
  }
}
