// 判例：用户的决定落库，以及「这个决定后来返工了」的显式标记。
//
// 判例只由用户的动作产生（作答 / 完成 / 忽略 / 采纳方案）。代理人只读判例，
// 不写、更不自己判 valid——那等于自己给自己发合格证。

import type { Card, Precedent } from '../../shared/contract'
import type { PrecedentStore, Store } from '../cards/store'
import { asString } from '../host-api'

/** 动作 → 判例里的「他怎么定的」。 */
const CHOICE_OF_ACTION: Record<string, string> = {
  complete: '批了',
  dismiss: '不批，忽略',
}

function cjkBigrams(run: string): string[] {
  const grams: string[] = []
  for (let i = 0; i < run.length - 1; i += 1) grams.push(run.slice(i, i + 2))
  return grams
}

/**
 * 粗糙切词就够：中文按 2-gram（中文没空格），英文/数字按整词；去重取前 8 个。
 * 目的是让决策会话能按关键词找到同类判例，不追求分词正确。
 */
export function keywordsOf(title: string): string[] {
  const words: string[] = []
  for (const token of String(title || '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)) {
    if (!token) continue
    if (/[\u4e00-\u9fff]/.test(token)) {
      words.push(...cjkBigrams(token.replace(/[a-z0-9]+/g, '')))
      const latin = token.replace(/[\u4e00-\u9fff]+/g, '')
      if (latin.length >= 2) words.push(latin)
    } else if (token.length >= 2) {
      words.push(token)
    }
  }
  return [...new Set(words)].slice(0, 8)
}

/**
 * 判例的「当时的问法」：详情优先（详情里通常写着要定什么），没有就用标题。
 * 标题已经单独存了，不再重复；也绝不拿票拟的 basis 冒充——那是理由不是问题，
 * 混进去会让同类匹配失准。
 */
export function questionTextOf(card: Card): string {
  const detail = String(card.detail || '').trim()
  return (detail || String(card.title || '').trim()).slice(0, 2000)
}

export function choiceOfAction(action: string): string | null {
  return CHOICE_OF_ACTION[action] ?? null
}

/** 一次人的决定落一条判例，outcome 留 unknown（验收只能由人后来给）。 */
export async function recordChoice(
  precedents: PrecedentStore,
  card: Card,
  choice: string,
): Promise<Precedent> {
  const text = asString(choice).trim() || '（未填写）'
  return precedents.add({
    cardId: card.id,
    title: card.title,
    question: questionTextOf(card),
    choice: text.slice(0, 2000),
    outcome: 'unknown',
    keywords: keywordsOf(card.title),
  })
}

export interface ReworkResult {
  precedent: Precedent
  /** true = 这张卡原先没有判例，返工事实本身补成了一条。 */
  created: boolean
}

/**
 * 标记「后来返工了」。没有判例的旧卡就地补一条：返工本身就是判例，
 * 丢掉它就等于下次还会照着做。
 */
export async function markReworked(
  cards: Store,
  precedents: PrecedentStore,
  card: Card,
  note: string,
): Promise<ReworkResult> {
  const reason = asString(note).trim().slice(0, 1000)
  const existing = precedents.latestForCard(card.id)
  const precedent = existing
    ? await precedents.update(
        existing.id,
        reason ? { outcome: 'reworked', note: reason } : { outcome: 'reworked' },
      )
    : await precedents.add({
        cardId: card.id,
        title: card.title,
        question: questionTextOf(card),
        choice: asString(card.answer).trim() || '（未记录）',
        outcome: 'reworked',
        note: reason,
        keywords: keywordsOf(card.title),
      })
  // 卡上留痕：返工标记不改状态、不执行任何动作，只让下次读卡时看得见。
  await cards.patch(card.id, {}, 'reworked')
  return { precedent, created: !existing }
}
