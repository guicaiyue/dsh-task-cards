// 草稿 → Store.create 的参数。
//
// 「免打扰」只有一种来源：用户在原会话里已经看过这条内容（见 seen.ts）。
// 而且只对 info 卡成立——决策卡永远要人回应，自动卡到点还要执行。

import type { CardDraft, CardOrigin } from '../../shared/contract'
import type { CreateCardOptions } from '../cards/store'

export function draftCreateOptions(
  draft: CardDraft,
  origin: CardOrigin,
  seen: boolean,
): CreateCardOptions {
  return {
    detail: draft.detail,
    kind: draft.kind,
    severity: draft.severity,
    action: draft.action,
    source: 'agent',
    ask: draft.ask ?? 'judgment',
    origin,
    silent: seen && draft.kind === 'info',
  }
}
