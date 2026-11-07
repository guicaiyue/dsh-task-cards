// 澄清卡的自动回答：只有面板开着的卡能对得上时，才拿它替用户回答「是哪张卡」。

import type { Card } from '../../shared/contract'
import type { AdviceDraft } from './parse'

/** 面板当时开着的卡必须能对上，才允许拿它替用户回答「是哪张卡」。 */
const DEICTIC_CARD = /(这张卡|那张卡|哪张卡|哪个卡|指哪张|贴回)/

function autoClarificationTarget(card: Card, question = ''): string | null {
  const ui = card.origin?.uiCardId
  if (!ui) return null
  const text = `${card.title}\n${card.detail}\n${question}\n${card.advice?.question ?? ''}`
  if (!DEICTIC_CARD.test(text)) return null
  // 强证据：系统代发时就来自这张卡，或最近卡里只有它一张。
  if (card.origin?.sourceCardId && ui === card.origin.sourceCardId) return ui
  const related = card.origin?.relatedCardIds ?? []
  if (related.length === 1 && related[0] === ui) return ui
  return null
}

export function resolveClarification(card: Card, draft: AdviceDraft): AdviceDraft {
  if (draft.ask !== 'clarification' || draft.answer) return draft
  const target = autoClarificationTarget(card, draft.question)
  if (!target) return draft
  return {
    ...draft,
    answer: `补充信息：${target}。这是对「${draft.question || card.title}」的回答，继续。`,
    effect: 'read',
    requires: ['session.reply'],
    autoApply: true,
  }
}
