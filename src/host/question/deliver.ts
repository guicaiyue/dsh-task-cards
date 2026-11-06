// 投递回原会话：人工批红与票拟自动执行共用这一条路。
//
// 只走 question/answer.ts 的 answerQuestion：普通回复卡没有 question.items，
// 会自然落到 sessionController.prompt 分支，不另开第二套投递。
// 投不回去（没有 origin.sessionId / 会话已死 / 宿主缺服务）也照样把卡标 done：
// 卡不能因为投递失败而卡死，返回 { pushed: false, reason } 交给调用方记录。

import type { Card } from '../../shared/contract'
import { isClosed } from '../../shared/state'
import type { Store } from '../cards/store'
import type { HostRuntime, Log } from '../host-api'
import { answerQuestion } from './answer'

export interface DeliverResult {
  /** 那句话是不是真的发回原会话了。 */
  pushed: boolean
  /** no-session / already-closed，或投递时抛出的原因。 */
  reason?: string
  /** 调用后的卡（不管推没推出去，卡都已经结束）。 */
  card?: Card
}

export interface DeliverOptions {
  cards: Store
  getCtx: () => HostRuntime | null
  log: Log
  card: Card
  text: string
  /** 卡上记的事件类型：approved（人批红）/ advice-applied（票拟自动执行）。 */
  event: string
  /**
   * 投递失败时要不要把卡关掉。人工批红关（他已经表态了，卡不该再占车道）；
   * 系统自动执行**不关**：你没表态，投递又失败，卡必须留在「要我决策」里让你看见。
   */
  closeOnFailure?: boolean
}

function messageOf(err: unknown): string {
  return (err as Error)?.message || String(err)
}

export async function deliverToOrigin(options: DeliverOptions): Promise<DeliverResult> {
  const { cards, getCtx, log, card, text, event } = options
  const closeOnFailure = options.closeOnFailure !== false
  // 已经结束的卡不重推：同一条批准点两次不该往会话里灌两遍。
  if (isClosed(card.status)) return { pushed: false, reason: 'already-closed', card }
  if (!card.origin?.sessionId) {
    const patched = await cards.patch(card.id, { status: 'done' }, `${event}:no-session`)
    log(`投递回原会话：${card.id} 没有 origin.sessionId，卡照样结束`)
    return { pushed: false, reason: 'no-session', card: patched }
  }
  try {
    const result = await answerQuestion(card, text, getCtx())
    const patched = await cards.patch(
      card.id,
      { status: 'done', answer: text, answeredAt: Date.now(), answeredVia: 'card' },
      event,
    )
    log(`投递回原会话：${card.id} → ${card.origin.sessionId}（${result.via}）`)
    return { pushed: true, card: patched }
  } catch (err) {
    // 没投出去也把决定留在卡上（answer），但不写 answeredAt / answeredVia：
    // 那两项的意思是「回给原会话了」，投递失败时不能冒充。
    const reason = messageOf(err)
    const changes = closeOnFailure
      ? { status: 'done' as const, answer: text }
      : { answer: text, lastError: reason }
    const patched = await cards.patch(card.id, changes, `${event}:failed`)
    log(`投递回原会话失败：${card.id} — ${reason}`)
    return { pushed: false, reason, card: patched }
  }
}
