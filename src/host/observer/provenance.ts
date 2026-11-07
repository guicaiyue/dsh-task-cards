// 一条 user/message 到底是谁发的。
//
// 同一个事件类型下混着三种东西：真人输入、任务卡系统代发的答复、运行时上下文
// （time-context 心跳）。观察者过去一律当「用户」，于是 17:35:32 那条自动投递的
// 卡片答案被记成了用户原话。这里把来源拆开，后面的窗口和卡片只认 human。

import type { OrderSource } from '../../shared/contract'
import { asRecord, asString } from '../host-api'

export const CARD_ANSWER_MARK = '〔任务卡答复'

export interface Provenance {
  kind: OrderSource
  /** 系统代发时来自哪张卡；解析不到为空串。 */
  cardId: string
}

/** 文本兜底：即使宿主不保留 rpcId，投递时加的标记也能认出来。 */
const CARD_MARK = /〔任务卡答复\s*[:：]?\s*(c-[A-Za-z0-9_-]+)?/

export function provenanceOf(data: Record<string, unknown> | undefined): Provenance {
  const value = asRecord(data)
  const source = asRecord(value.source)
  const kind = asString(source.kind)
  const rpcId = asString(source.rpcId)
  const text = asString(value.text) || messageTextOf(value)
  if (kind === 'time-context') return { kind: 'system', cardId: '' }
  if (kind && kind !== 'user') return { kind: 'system', cardId: '' }
  if (rpcId.startsWith('card-answer-')) return { kind: 'card-answer', cardId: cardIdFromText(text) }
  if (text.startsWith(CARD_ANSWER_MARK))
    return { kind: 'card-answer', cardId: cardIdFromText(text) }
  return { kind: 'human', cardId: '' }
}

/** 从 `〔任务卡答复 c-xxx「标题」〕` 里取卡片 id。 */
export function cardIdFromText(text: string): string {
  const match = CARD_MARK.exec(text)
  return match && match[1] ? match[1] : ''
}

function messageTextOf(value: Record<string, unknown>): string {
  const content = Array.isArray(value.content)
    ? value.content
    : Array.isArray(asRecord(value.message).content)
      ? (asRecord(value.message).content as unknown[])
      : []
  return content
    .map((block) => asString(asRecord(block).text))
    .filter(Boolean)
    .join('\n')
}
