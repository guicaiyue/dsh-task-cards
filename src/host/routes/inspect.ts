// GET /inspect：诊断一次观察者请求的请求头与事件；events=1 时列最近事件。

import { StoreError } from '../cards/store'
import { asRecord } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { sendJson } from '../http'
import { messageText } from '../observer/payload'
import { param, type RouteDeps } from './deps'

export function createInspectHandler({ runtime }: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const id = param(req.url, 'id')
    const query = runtime()?.sessionQuery
    if (!query) throw new StoreError('NO_QUERY', '宿主没有 sessionQuery')
    const snapshot = await query.readSession(id)
    const events = snapshot.events || []
    if (param(req.url, 'events') === '1') {
      const recent = events.slice(-40).map((event) => {
        const data = asRecord(event.data)
        return {
          type: event.type,
          keys: event.data && typeof event.data === 'object' ? Object.keys(event.data) : [],
          name: data.name,
          callId: data.callId,
          args: data.arguments ? JSON.stringify(data.arguments).slice(0, 200) : undefined,
        }
      })
      return sendJson(res, 200, { ok: true, sessionId: id, events: recent })
    }
    const { header, userMessages } = readHeaderAndMessages(events)
    const config = asRecord(header?.config)
    const tools = Array.isArray(header?.tools)
      ? (header?.tools as Array<Record<string, unknown>>)
      : []
    return sendJson(res, 200, {
      ok: true,
      sessionId: id,
      model: config.model ?? null,
      provider: config.provider ?? null,
      tools: tools.map((tool) => tool.name),
      toolCount: tools.length,
      userMessages: userMessages.map((item) => item.slice(0, 2000)),
      eventTypes: [...new Set(events.map((event) => event.type))],
    })
  }
}

interface HeaderAndMessages {
  header: Record<string, unknown> | null
  userMessages: string[]
}

function readHeaderAndMessages(
  events: Array<{ type: string; data?: Record<string, unknown> }>,
): HeaderAndMessages {
  let header: Record<string, unknown> | null = null
  const userMessages: string[] = []
  for (const event of events) {
    const data = asRecord(event.data)
    if (event.type === 'request/header') header = asRecord(data.header)
    if (event.type === 'user/message') {
      const text =
        messageText(data.message) ||
        messageText(data) ||
        (typeof data.text === 'string' ? data.text : '') ||
        JSON.stringify(data).slice(0, 800)
      if (text) userMessages.push(text)
    }
  }
  return { header, userMessages }
}
