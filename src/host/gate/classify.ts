// 回合内危险动作分类：纯函数，输入一次工具调用，输出该不该拦 + 判定依据。
//
// 原则：宁可漏一条模式，也不误伤日常开发。边界匹配写死：
//   - 容器名按完整词匹配（生产 `postgres`；dev 叫 `story-dev-postgres`，不是子串命中）；
//   - 库名 `-d story` 不能匹配 `-d story_dev`（`_` 是词字符，`\b` 天然挡住）。
// 每条命中都带 `rule:<名字>` / `prod-db:<片段>`，写进卡上的 gate.reasons 供审计。

import { isAbsolute, resolve } from 'node:path'

import type { Effect } from '../../shared/contract'
import {
  DEV_TCP,
  devContainerReason,
  gitPushReason,
  isEnvTemplate,
  looksLikeSecretContent,
  reversibleWriteEffect,
  sqlDestructiveReason,
  templateOnlySecretWrite,
} from './converge'
import { hashOf, identityOf as makeIdentity } from './identity'
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

/** 真正把 SQL 交给数据库客户端执行的命令（文件内容里的 SQL 不算）。 */
const SQL_CLIENT =
  /\b(psql|mysql|mariadb|sqlite3)\b|\bdocker\s+(?:exec|compose\s+exec)\b[^\n]*\b(psql|mysql|mariadb|sqlite3)\b/i

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

/**
 * 语义身份：tool + effect + 归一化目标。
 *
 * 不能用「整个 arguments 哈希」——agent 重试同一命令时 `description`/`timeoutMs`
 * 之类易变字段会变，哈希就变了，批准发的券对不上重试的调用 → 批准后又被拦
 * （真实 bug：同一 target 两张卡、两个 argHash）。description 等不影响执行语义，
 * 不该进身份。
 */
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
    if (/^\/(dev\/null|dev\/tcp|dev\/udp|tmp\/|proc\/)/.test(target)) continue
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
    let segCwd = cwd
    for (const rule of RULES) {
      if (rule.pattern.test(command)) hit(rule.effect, `rule:${rule.name}:whole`)
    }
    const wholeSql = sqlDestructiveReason(command)
    if (wholeSql) hit('destructive', wholeSql)
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
      const wholeHit = segmentHit(segment, segCwd, cwd)
      const segHit = wholeHit
      if (segHit) hit(segHit.effect, `${segHit.reason}:seg#${index + 1}`)
      for (const rule of RULES) {
        if (rule.pattern.test(segment)) hit(rule.effect, `rule:${rule.name}:seg#${index + 1}`)
      }
      const sql = sqlDestructiveReason(segment)
      if (sql) hit('destructive', `${sql}:seg#${index + 1}`)
      if (SPEND.test(segment)) hit('spend', `rule:spend:seg#${index + 1}`)
    }
    if (SPEND.test(command)) hit('spend', 'rule:spend')
    if (SECRET_PATH.test(command) && / >|\b(tee|cat\s*>|cp|mv|chmod)\b/.test(command)) {
      if (templateOnlySecretWrite(command)) reasons.push('allow:env-template')
      else hit('write-code', 'rule:secret-path')
    }
    if (DEV_TCP.test(command)) reasons.push('allow:dev-tcp-probe')
  }

  if (path && (WRITE_TOOLS.has(input.tool) || input.tool.startsWith('mcp__'))) {
    const content = String(input.args?.content ?? input.args?.new_str ?? input.args?.text ?? '')
    if (SECRET_PATH.test(path)) {
      if (isEnvTemplate(path) && !looksLikeSecretContent(content)) {
        reasons.push('allow:env-template')
      } else if (isEnvTemplate(path)) {
        hit('write-code', 'rule:secret-env-content')
      } else {
        hit('write-code', 'rule:secret-path')
      }
    }
    if (!isInside(cwd, path)) hit('write-code', 'rule:write-outside')
    else if (!reasons.includes('rule:secret-path')) {
      effect = 'write-code'
      reasons.push('allow:reversible-write')
    }
  }
  if (SPEND.test(JSON.stringify(input.args ?? {}))) hit('spend', 'rule:spend')

  const reversible = reversibleWriteEffect(command)
  if (reversible) {
    effect = reversible
    reasons.push('allow:reversible-write')
  }
  const allMode = mode === 'all' && (isWriteTool(input.tool) || Boolean(command) || Boolean(path))
  const blocking = reasons.some((reason) => !reason.startsWith('allow:'))
  const gate = mode !== 'off' && ((effect !== null && blocking) || allMode)
  const finalEffect = effect ?? 'read'
  const target = (command || path).replace(/\s+/g, ' ').trim().slice(0, 120)
  const identity = makeIdentity(input.tool, finalEffect, target)
  return {
    gate,
    effect: finalEffect,
    target,
    reasons,
    argHash: hashOf(identity),
    identity,
  }
}
