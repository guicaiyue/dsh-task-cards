// 三个确定性检查器：exit / file / http。
//
// 它们是「取证」的全部：不递归、不解读、不调模型。超时即 unknown。

import { exec } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { promisify } from 'node:util'

import type { CheckContext, CheckSpec } from '../../shared/evidence'
import { CHECK_TIMEOUT_MS } from '../../shared/evidence'

const run = promisify(exec)

export interface CheckOutcome {
  ok: boolean
  detail: string
  sha256?: string
  error?: string
}

const MAX_HASH_BYTES = 2 * 1024 * 1024

function messageOf(err: unknown): string {
  return (err as Error)?.message || String(err)
}

async function checkExit(
  spec: Extract<CheckSpec, { kind: 'exit' }>,
  timeoutMs: number,
): Promise<CheckOutcome> {
  const started = Date.now()
  try {
    const { stdout } = await run(spec.cmd, {
      timeout: timeoutMs,
      // 不设 maxBuffer 时大量输出会直接抛错，这里给 1MB 够取证用。
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
    return {
      ok: true,
      detail: `exit=0（${stdout.trim().split('\n').slice(-1)[0]?.slice(0, 80) || '无输出'}，${Date.now() - started}ms）`,
    }
  } catch (err) {
    const code = (err as { code?: number }).code
    return {
      ok: code === spec.expect,
      detail: `exit=${code ?? 'unknown'}（期望 ${spec.expect}）`,
      error: code === spec.expect ? undefined : messageOf(err),
    }
  }
}

async function checkFile(spec: Extract<CheckSpec, { kind: 'file' }>): Promise<CheckOutcome> {
  try {
    const info = await stat(spec.path)
    if (spec.expect === 'absent') return { ok: false, detail: '文件仍然存在' }
    let sha256: string | undefined
    if (info.size <= MAX_HASH_BYTES) {
      sha256 = createHash('sha256')
        .update(await readFile(spec.path))
        .digest('hex')
    }
    return {
      ok: true,
      detail: `存在（${info.size} B${sha256 ? `，sha256 ${sha256.slice(0, 12)}` : '，大文件不哈希'}）`,
      ...(sha256 ? { sha256 } : {}),
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: spec.expect === 'absent', detail: '文件不存在' }
    }
    return { ok: false, detail: `读取失败：${messageOf(err)}`, error: messageOf(err) }
  }
}

const PRIVATE_HOST =
  /^(localhost|127\..*|\[?::1\]?|10\..*|192\.168\..*|172\.(1[6-9]|2\d|3[01])\..*|0\.0\.0\.0|.*\.local)$/i

function assertUrlAllowed(raw: string, allowPrivate: boolean): URL {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`只允许 http/https：${url.protocol}`)
  }
  if (!allowPrivate && PRIVATE_HOST.test(url.hostname)) {
    throw new Error(`默认拒绝内网地址：${url.hostname}（需显式 allowPrivate）`)
  }
  return url
}

async function checkHttp(
  spec: Extract<CheckSpec, { kind: 'http' }>,
  ctx: CheckContext,
): Promise<CheckOutcome> {
  const url = assertUrlAllowed(spec.url, ctx.allowPrivate === true)
  // 不跟随重定向：证据要记录「实际返回的状态」，而不是跟随后的最终页。
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ctx.timeoutMs ?? CHECK_TIMEOUT_MS),
    redirect: 'manual',
  })
  return {
    ok: res.status === spec.expect,
    detail: `HTTP ${res.status}（期望 ${spec.expect}）`,
  }
}

/** 跑一条检查；任何异常都收敛成 ok:false + detail，不向上抛。 */
export async function runCheck(spec: CheckSpec, ctx: CheckContext = {}): Promise<CheckOutcome> {
  const timeoutMs = ctx.timeoutMs ?? CHECK_TIMEOUT_MS
  try {
    if (spec.kind === 'exit') return await checkExit(spec, timeoutMs)
    if (spec.kind === 'file') return await checkFile(spec)
    return await checkHttp(spec, { ...ctx, timeoutMs })
  } catch (err) {
    return { ok: false, detail: `检查失败：${messageOf(err)}`, error: messageOf(err) }
  }
}
