// 验收白名单：acceptance 里的 checker 只能是被允许的最小子集。
//
// 安全边界（审计 P0-4）：
// - exit 只允许固定前缀 + 禁 shell 元字符（observer/模型不能注入任意命令）；
// - file 路径必须在工作区内，且排除 .env/.ssh/credentials 等敏感路径；
// - http 只允许公网 https?（沿用 SSRF 拦截的判定口径：拒 loopback/内网/链路本地）。

import { isAbsolute, resolve } from 'node:path'

import type { Acceptance } from '../../shared/contract'

const EXIT_ALLOW =
  /^(pnpm (test|typecheck|build|lint)|npm (test|run [\w:-]+)|node scripts\/[\w./-]+)$/
const SHELL_META = /[;&|$`><\n]/
const SENSITIVE = /(^|\/)(\.env(\..*)?|id_rsa|id_ed25519|credentials)(\/|$)|(^|\/)\.ssh(\/|$)/i

export function sensitivePath(target: string): boolean {
  return SENSITIVE.test(target)
}

export function insideWorkspace(cwd: string, target: string): boolean {
  const root = resolve(cwd)
  const full = isAbsolute(target) ? resolve(target) : resolve(root, target)
  return full === root || full.startsWith(`${root}/`)
}

function privateUrl(target: string): boolean {
  try {
    const url = new URL(target)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return true
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.localhost')) return true
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/.test(host)) return true
    const v172 = /^172\.(\d+)\./.exec(host)
    if (v172 && Number(v172[1]) >= 16 && Number(v172[1]) <= 31) return true
    return false
  } catch {
    return true
  }
}

/** 过滤出一条合规的 acceptance 条目；不合规返回 null（调用方记日志后丢弃）。 */
export function sanitizeAcceptance(item: Acceptance, cwd: string): Acceptance | null {
  const spec = item.spec
  if (spec.kind === 'exit') {
    const command = spec.cmd.trim()
    if (!EXIT_ALLOW.test(command) || SHELL_META.test(command) || command.length > 200) return null
    return { ...item, spec: { ...spec, cmd: command } }
  }
  if (spec.kind === 'file') {
    if (!insideWorkspace(cwd, spec.path) || sensitivePath(spec.path)) return null
    return item
  }
  if (privateUrl(spec.url)) return null
  return item
}

export function sanitizeAll(items: readonly Acceptance[] | undefined, cwd: string): Acceptance[] {
  if (!items?.length) return []
  return items
    .map((item) => sanitizeAcceptance(item, cwd))
    .filter((item): item is Acceptance => item !== null)
    .slice(0, 5)
}
