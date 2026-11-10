// 草稿 → Store.create 的参数。
//
// 「免打扰」只有一种来源：用户在原会话里已经看过这条内容（见 seen.ts）。
// 而且只对 info 卡成立——决策卡永远要人回应，自动卡到点还要执行。
//
// 另有一条硬门禁：这一轮如果是系统代发的卡片答复触发的，用户本人并没有说话，
// 就没有「他的意图」可判断。此时观察者给的 judgment 卡一律降成 info——把系统
// 自指的空转做成需要人拍板的决策，正是最初那次「信息断层」。

import type { CardDraft, CardKind, CardOrigin } from '../../shared/contract'
import type { CreateCardOptions } from '../cards/store'
import { sanitizeAll } from '../evidence/guard'

/** 系统代发触发的回合里，judgment 车道没有现实依据。 */
export function laneGate(
  draft: CardDraft,
  origin: CardOrigin,
): { kind: CardKind; downgraded: boolean } {
  const systemTriggered = origin.sourceKind === 'card-answer'
  if (systemTriggered && draft.kind === 'decision' && (draft.ask ?? 'judgment') === 'judgment') {
    return { kind: 'info', downgraded: true }
  }
  return { kind: draft.kind, downgraded: false }
}

export function draftCreateOptions(
  draft: CardDraft,
  origin: CardOrigin,
  seen: boolean,
): CreateCardOptions {
  const lane = laneGate(draft, origin)
  return {
    detail: lane.downgraded
      ? `${draft.detail}${draft.detail ? '\n' : ''}（本轮由系统代发的卡片答复触发，没有用户本人的意图可判断，已降为通知。）`.slice(
          0,
          1000,
        )
      : draft.detail,
    kind: lane.kind,
    severity: draft.severity,
    // 只有自动卡才允许带「到点替用户发一句话」的动作；决策/通知卡带 action 会被扫描器误当成自动执行。
    action: lane.kind === 'auto' ? draft.action : null,
    source: 'agent',
    ask: draft.ask ?? 'judgment',
    origin,
    silent: seen && lane.kind === 'info',
    ...(draft.artifacts?.length ? { artifacts: draft.artifacts } : {}),
    // 阶段 D：观察者草稿里的验收检查必须过服务端白名单（工作区/敏感路径/SSRF/命令前缀）。
    ...(() => {
      const acceptance = sanitizeAll(draft.acceptance, process.cwd())
      return acceptance.length ? { acceptance } : {}
    })(),
  }
}
