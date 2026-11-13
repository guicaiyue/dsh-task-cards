// 阻塞超 30 分钟且 askTimeoutAction=suggest 时的「默认建议」（不自动执行）。

import { ASK_SUGGEST_THRESHOLD_MS, askWaitMs } from '../../shared/state'
import type { Card } from '../types'

export function suggestOfAsk(
  enabled: boolean | undefined,
  card: Card,
): { n: number; suggest: string } | null {
  if (!enabled) return null
  const waited = askWaitMs(card as never, Date.now())
  if (waited === null || waited < ASK_SUGGEST_THRESHOLD_MS || !card.advice) return null
  const suggest = card.advice.options[card.advice.chosen]?.name ?? card.advice.summary
  return { n: Math.round(waited / 60_000), suggest }
}
