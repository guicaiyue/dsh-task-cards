// GET /timeline：详情弹窗用，一个会话里「用户输入 + 模型最终输出」，中间过程全略。

import { StoreError } from '../cards/store'
import { asRecord } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { sendJson } from '../http'
import { messageText } from '../observer/payload'
import { param, type RouteDeps } from './deps'

interface Turn {
  user: string
  assistant: string
  at: number | null
}

/** 只要人真正说的那句：注入的 system-reminder 等也是 user/message，但 source.kind 不是 user。 */
function isRealUserMessage(data: Record<string, unknown>): boolean {
  const kind = asRecord(data.source).kind
  return kind === undefined || kind === 'user'
}

function collectTurns(
  events: Array<{ type: string; time?: number; data?: Record<string, unknown> }>,
): Turn[] {
  const pairs: Turn[] = []
  let current: Turn | null = null
  for (const event of events) {
    const data = asRecord(event.data)
    if (event.type === 'user/message') {
      if (!isRealUserMessage(data)) continue
      const text = messageText(data.message) || messageText(data) || ''
      if (!text) continue
      current = { user: text, assistant: '', at: event.time ?? null }
      pairs.push(current)
    } else if (event.type === 'assistant/message') {
      const text = messageText(data.message)
      if (!text) continue
      // 中间步骤的 assistant 文本不单独成轮：挂到最近一轮用户输入下，
      // 最后一轮会覆盖前面的中间输出，弹窗里只留模型最终那段。
      if (!current) {
        current = { user: '', assistant: '', at: event.time ?? null }
        pairs.push(current)
      }
      current.assistant = text
      current.at = event.time ?? current.at
    }
  }
  return pairs
}

export function createTimelineHandler({ runtime }: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const id = param(req.url, 'id')
    const query = runtime()?.sessionQuery
    if (!query) throw new StoreError('NO_QUERY', '宿主没有 sessionQuery')
    if (!id) throw new StoreError('MISSING_ID', '缺少会话 id')
    const snapshot = await query.readSession(id)
    const events = snapshot.events || []
    let title = ''
    for (const event of events) {
      const data = asRecord(event.data)
      if (event.type === 'session/title' && typeof data.title === 'string') title = data.title
    }
    return sendJson(res, 200, {
      ok: true,
      sessionId: id,
      title,
      turns: collectTurns(events).slice(-12),
    })
  }
}
