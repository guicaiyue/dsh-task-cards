// HTTP 出入库：读 JSON 体、回 JSON、统一错误形状，外加路由注册的类型。

import { StoreError } from './cards/store'

export const MAX_BODY = 256 * 1024

export interface HttpRequestLike {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<Buffer | string>
}

export interface HttpResponseLike {
  headersSent?: boolean
  writableEnded?: boolean
  writeHead(code: number, headers?: Record<string, string>): unknown
  setHeader(name: string, value: string): unknown
  end(body?: string): unknown
  destroy(): unknown
}

export interface RouteSpec {
  kind: 'exact'
  path: string
  methods: string[]
  handler: (req: HttpRequestLike, res: HttpResponseLike) => Promise<unknown> | unknown
}

export async function readJson(req: HttpRequestLike): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > MAX_BODY) throw new StoreError('BODY_TOO_LARGE', '请求体过大')
    chunks.push(buffer)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    throw new StoreError('BAD_JSON', '请求体不是合法 JSON')
  }
}

export function sendJson(res: HttpResponseLike, code: number, payload: unknown): boolean {
  if (!res || res.headersSent || res.writableEnded) return false
  try {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(JSON.stringify(payload))
    return true
  } catch {
    try {
      res.destroy()
    } catch {
      /* 连接已断 */
    }
    return false
  }
}

/** 对外只回稳定 code + 一句人话；原始 message 只进日志（它常带绝对路径）。 */
export function fail(
  res: HttpResponseLike,
  code: number,
  errorCode: string,
  message: string,
  err?: unknown,
): boolean {
  if (err !== undefined) {
    try {
      console.warn(`[dsh-task-cards] ${errorCode}: ${(err as Error)?.message || String(err)}`)
    } catch {
      /* 日志本身失败不影响响应 */
    }
  }
  return sendJson(res, code, {
    ok: false,
    code: errorCode,
    error: message,
    // 500 时带上真实原因，面板上能直接看到（本机插件，不涉及泄漏）
    ...(err !== undefined ? { detail: (err as Error)?.message || String(err) } : {}),
  })
}
