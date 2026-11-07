// 卡片里的「三张旧卡 / 这几张卡」如果没有可核对的 id，就不该让用户点批准：
// 决策代理人只能从 relatedCards 猜，猜错了就会批错对象。

import type { Card } from '../../shared/contract'
import type { AdviceDraft } from './parse'

const VAGUE = /(三张|两张|这几张|那几张|多张|这批).{0,8}卡|卡.{0,8}(三张|两张|这几张|那几张)/
const CARD_ID = /\bc-[a-z0-9]{4,}-[a-z0-9]+\b/g

/** 卡自己（标题/明细/触发输入）提到多张卡，却没有给出任何卡片 id。 */
export function unresolvedCardReference(card: Card): boolean {
  const text = `${card.title}\n${card.detail}\n${card.origin?.triggerText ?? ''}`
  if (!VAGUE.test(text)) return false
  return (text.match(CARD_ID) || []).length === 0
}

/** 把「没有 id 的多卡指代」强制改成澄清，避免批准一个不知道对象是什么的动作。 */
export function guardVagueReference(card: Card, draft: AdviceDraft): AdviceDraft {
  if (!unresolvedCardReference(card) || draft.ask === 'clarification') return draft
  return {
    ...draft,
    ask: 'clarification',
    verdict: 'wait',
    summary: '缺少卡片 id，先问清是哪几张',
    question: '你指的是哪几张卡？请给出卡片 id。',
    answer: '',
    effect: 'read',
    requires: ['session.reply'],
    autoApply: false,
    reversible: true,
    blockedReasons: ['missing-card-ids'],
  }
}
