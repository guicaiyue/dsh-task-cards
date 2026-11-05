// 信任栅栏：跨站拒绝 → 宿主栅栏（有就用）→ 无栅栏时只认回环/白名单。

import { asString } from './host-api'

export interface FenceCtx {
  get?(name: string): unknown
  connection?: unknown
}

function isLoopbackHostname(hostname: string): boolean {
  const name = String(hostname || '')
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
  if (!name) return false
  if (name === 'localhost' || name.endsWith('.localhost') || name === '::1') return true
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name)
  if (!parts) return false
  if (Number(parts[1]) !== 127) return false
  return [parts[2], parts[3], parts[4]].every((n) => Number(n) <= 255)
}

interface ConnLike {
  requestRejection(req: unknown): unknown
}

export function makeFence(ctx: FenceCtx): (req: HttpRequestLikeLike) => number {
  const trusted = String(process.env.DSH_TASK_CARDS_TRUSTED_HOSTS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  function hostFence(): ConnLike | null {
    try {
      const fromGet = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
      const conn = fromGet || ctx.connection
      if (conn && typeof (conn as ConnLike).requestRejection === 'function') return conn as ConnLike
      return null
    } catch {
      return null
    }
  }

  return function rejection(req: HttpRequestLikeLike): number {
    try {
      const headers = req?.headers || {}
      if (asString(headers['sec-fetch-site']).toLowerCase() === 'cross-site') return 403

      let hostUrl: URL
      try {
        hostUrl = new URL(`http://${asString(headers.host)}`)
      } catch {
        return 403
      }
      const authority = hostUrl.host.toLowerCase()

      const origin = headers.origin
      if (typeof origin === 'string' && origin && origin !== 'null') {
        let originUrl: URL
        try {
          originUrl = new URL(origin)
        } catch {
          return 403
        }
        if (originUrl.host.toLowerCase() !== authority) return 403
      }

      const conn = hostFence()
      if (!conn) {
        if (!isLoopbackHostname(hostUrl.hostname)) {
          const ok = trusted.some((entry) =>
            entry.includes(':') ? entry === authority : entry === hostUrl.hostname.toLowerCase(),
          )
          if (!ok) return 403
        }
        return 0
      }
      const code = conn.requestRejection(req)
      if (code === undefined || code === null || code === false) return 0
      return typeof code === 'number' ? code : 403
    } catch {
      return 403
    }
  }
}

/** 栅栏只关心 method/headers 这几项。 */
export interface HttpRequestLikeLike {
  headers: Record<string, string | string[] | undefined>
}
