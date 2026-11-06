// 决策会话的输入构造：本次新建的卡 + 同类判例。纯函数，先测再加逻辑。
//
// 用户硬规则：outcome=reworked 的判例一条都不送——那条路他走过并且返工了，
// 再建议等于让他重犯。条数按 decisionPrecedentLimit 截断，按时间倒序。

import type { Card, Precedent } from '../../shared/contract'
import { truncateBytes } from '../observer/payload'

export const DECISION_INPUT_MAX_BYTES = 16000

const HEADER = [
  '请对下面这些新建的卡各出一张票拟，只输出 JSON。',
  '一张卡一条 decisions，不要合并也不要拆分；没有要判断的就输出 {"decisions":[]}。',
].join('\n')

/** 判例只是参照：单字段截短，别让它把卡的预算挤掉。 */
const PRECEDENT_FIELD_MAX = 600
const CARD_DETAIL_MAX = 1000
const CARD_ACTION_MAX = 400
/** 模板与两个标签本身的字节，留给它们再给卡/判例分配预算。 */
const WRAPPER_BYTES = 800

interface DecisionCardRow {
  id: string
  title: string
  detail: string
  kind: string
  severity: string
  action: string
}

interface DecisionPrecedentRow {
  id: string
  title: string
  question: string
  choice: string
  outcome: string
  note: string
  keywords: string[]
}

function clip(value: unknown, max: number): string {
  return String(value ?? '')
    .trim()
    .slice(0, max)
}

function cardRow(card: Card): DecisionCardRow {
  return {
    id: card.id,
    title: clip(card.title, 200),
    detail: clip(card.detail, CARD_DETAIL_MAX),
    kind: card.kind,
    severity: card.severity,
    // 非空说明这张卡已经被安排过到点动作，决策时不该再重复安排。
    action: card.action ? clip(card.action.input, CARD_ACTION_MAX) : '',
  }
}

function precedentRow(precedent: Precedent): DecisionPrecedentRow {
  return {
    id: precedent.id,
    title: clip(precedent.title, 200),
    question: clip(precedent.question, PRECEDENT_FIELD_MAX),
    choice: clip(precedent.choice, PRECEDENT_FIELD_MAX),
    outcome: precedent.outcome,
    note: clip(precedent.note, PRECEDENT_FIELD_MAX),
    keywords: precedent.keywords.map((word) => String(word)).slice(0, 12),
  }
}

/** 装行：装不下就丢后面的（越靠后越旧/越次要），保证输出是合法 JSON。 */
function fitRows(rows: unknown[], maxBytes: number): string {
  const kept: unknown[] = []
  for (const row of rows) {
    const candidate = kept.concat([row])
    const size = Buffer.byteLength(JSON.stringify(candidate), 'utf8')
    if (size > maxBytes && kept.length) break
    kept.push(row)
  }
  return truncateBytes(JSON.stringify(kept), Math.max(2, maxBytes))
}

/**
 * 决策会话的 user 文本。
 * @param cards 本次新建的卡（已按需要筛选过状态）
 * @param precedents 判例库（本函数自己排序、剔除 reworked、按 limit 截断）
 * @param limit 最多带几条判例
 * @param maxBytes 输入总字节上限（默认 16 KB，调用方用 settings.maxInputBytes）
 */
export function buildDecisionInput(
  cards: Card[],
  precedents: Precedent[],
  limit: number,
  maxBytes: number = DECISION_INPUT_MAX_BYTES,
): string {
  const usable = precedents
    .filter((item) => item.outcome !== 'reworked')
    .sort((left, right) => (right.at || 0) - (left.at || 0))
    .slice(0, Math.max(0, limit))
  const cardBudget = Math.max(300, maxBytes - WRAPPER_BYTES)
  const cardsText = fitRows(cards.map(cardRow), cardBudget)
  const precedentBudget = Math.max(120, maxBytes - WRAPPER_BYTES - Buffer.byteLength(cardsText))
  const precedentsText = fitRows(usable.map(precedentRow), precedentBudget)
  const text = [
    HEADER,
    '',
    '<cards>',
    cardsText,
    '</cards>',
    '',
    '<precedents>',
    precedentsText,
    '</precedents>',
  ].join('\n')
  // 最后再兜一刀：模板本身也有字节，任何情况下都不突破调用方给的预算。
  return truncateBytes(text, Math.max(2, maxBytes))
}
