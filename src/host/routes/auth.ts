// 人机边界：面板令牌 + 审计可见性。
//
// 威胁模型（写进 docs/contracts.md）：同一宿主内的 root agent 可以伪装成面板，
// 令牌挡的是「误触发与普通自动化」，不是对 root 的强制边界；真正的保障是
// 审计日志 + 卡上的「非面板来源」标记 + 人工复核。
//
// 令牌只在 presence 通道下发：要求浏览器 UA + 面板来源（Origin/Referer），
// 并记录签发指纹（UA/Origin/脚本特征），特权写时落 audit 并在卡上打标。

import { randomUUID } from 'node:crypto'

import { StoreError } from '../cards/store'

const TOKEN_TTL_MS = 30 * 60 * 1000
const TOKEN_KEY = Symbol.for('dsh-task-cards.panel-tokens')
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/

function normalized(value: string): { protocol: string; host: string } | null {
  try {
    const url = new URL(value)
    return { protocol: url.protocol, host: url.host }
  } catch {
    return null
  }
}

/**
 * 允许的来源 = 当前部署的实际来源（DSH_PUBLIC_URL / DSH_TRUSTED_HOSTS）+ loopback 兜底。
 *
 * 不能写死 loopback：面板常用局域网地址访问（如 http://192.168.1.4:3080），
 * 只认 127.0.0.1 会让真实面板拿不到令牌、所有特权动作 403。
 */
export function originAllowed(origin: string): boolean {
  if (LOOPBACK_ORIGIN.test(origin)) return true
  const target = normalized(origin)
  if (!target) return false
  const candidates: string[] = []
  if (process.env.DSH_PUBLIC_URL) candidates.push(process.env.DSH_PUBLIC_URL)
  for (const raw of (process.env.DSH_TRUSTED_HOSTS ?? '').split(',')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    candidates.push(trimmed.includes('://') ? trimmed : `http://${trimmed}`)
  }
  for (const candidate of candidates) {
    const allowed = normalized(candidate)
    if (allowed && allowed.protocol === target.protocol && allowed.host === target.host) return true
  }
  return false
}
const BROWSER_UA = /(Mozilla|Chrome|Safari|Firefox|Edg)\//
const SCRIPT_UA = /(curl|wget|python-requests|node-fetch|axios|go-http-client|httpclient|okhttp)/i

export interface PanelTokenMeta {
  token: string
  ua: string
  origin: string
  /** 签发时不像浏览器 → 后续特权写要打可见标记。 */
  scripted: boolean
  expiresAt: number
}

interface HeadersLike {
  headers?: Record<string, string | string[] | undefined>
}

function tokens(): Map<string, PanelTokenMeta> {
  const bag = globalThis as unknown as Record<symbol, Map<string, PanelTokenMeta> | undefined>
  const existing = bag[TOKEN_KEY]
  if (existing) return existing
  const created = new Map<string, PanelTokenMeta>()
  bag[TOKEN_KEY] = created
  return created
}

function headerOf(req: HeadersLike, name: string): string {
  const raw = req.headers?.[name]
  return (Array.isArray(raw) ? raw[0] : raw) ?? ''
}

/** 来源必须是面板（Origin/Referer 必须存在且指向本机面板端口）。 */
export function assertPanelOrigin(req: HeadersLike): string {
  const origin = headerOf(req, 'origin') || headerOf(req, 'referer')
  if (!origin || !originAllowed(origin))
    throw new StoreError('PANEL_ORIGIN_REJECTED', '请求来源不是面板')
  return origin
}

export function isBrowserRequest(req: HeadersLike): boolean {
  const ua = headerOf(req, 'user-agent')
  if (!ua || SCRIPT_UA.test(ua)) return false
  return BROWSER_UA.test(ua)
}

/** presence 通道建立时调用：只允许浏览器 + 面板来源，并记录签发指纹。 */
export function issuePanelToken(req: HeadersLike): PanelTokenMeta {
  const origin = assertPanelOrigin(req)
  if (!isBrowserRequest(req))
    throw new StoreError('PANEL_BROWSER_REQUIRED', '只有面板页面（浏览器）能领取令牌')
  const ua = headerOf(req, 'user-agent')
  const meta: PanelTokenMeta = {
    token: randomUUID(),
    ua,
    origin,
    scripted: false,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  }
  tokens().set(meta.token, meta)
  if (tokens().size > 50) {
    const now = Date.now()
    for (const [key, value] of tokens()) if (value.expiresAt < now) tokens().delete(key)
  }
  return meta
}

export function revokePanelToken(token: string | undefined): void {
  if (token) tokens().delete(token)
}

/** 特权写校验：令牌有效 + 来源是面板（缺 Origin/Referer 直接拒）。返回签发指纹。 */
export function assertPanelToken(req: HeadersLike): PanelTokenMeta {
  assertPanelOrigin(req)
  const token = headerOf(req, 'x-panel-token')
  const meta = token ? tokens().get(token) : undefined
  if (!meta || meta.expiresAt < Date.now())
    throw new StoreError('PANEL_TOKEN_REQUIRED', '这个动作要人在面板上操作（缺少面板令牌）')
  return meta
}
