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
    // P3：结果卡固定 info/notice（面板「结果」车道），不参与决定状态机。
    kind: draft.result ? 'info' : lane.kind,
    severity: draft.severity,
    // 只有自动卡才允许带「到点替用户发一句话」的动作；决策/通知卡带 action 会被扫描器误当成自动执行。
    action: lane.kind === 'auto' ? draft.action : null,
    source: 'agent',
    ask: draft.ask ?? 'judgment',
    origin,
    silent: seen && lane.kind === 'info',
    ...(draft.artifacts?.length ? { artifacts: draft.artifacts } : {}),
    ...(draft.blockedBy?.length
      ? { blockedBy: draft.blockedBy.filter((id) => typeof id === 'string').slice(0, 8) }
      : {}),
    // 阶段 D：观察者草稿里的验收检查必须过服务端白名单（工作区/敏感路径/SSRF/命令前缀）。
    ...(() => {
      const acceptance = sanitizeAll(draft.acceptance, process.cwd())
      return acceptance.length ? { acceptance } : {}
    })(),
    // P1/P3：一次用户目标一个 goalId；结果卡显式标记（验收不靠标题猜）。
    goalId: draft.goalId || `${origin.sessionId}:${origin.turn ?? 0}`,
    ...(draft.result ? { result: true } : {}),
    ...(draft.defaultAnswer ? { defaultAnswer: draft.defaultAnswer } : {}),
    ...(draft.blocking ? { blocking: true } : {}),
  }
}

/** 例外/风险/结果三类之外的过程卡，在 exception-only 模式下不建卡（过程进时间线）。 */
const RISK = /证书|到期|缺表|缺列|数据丢失|风险|阻塞|失败|不可用|安全|漏洞|回滚|告警|中断/i
const RESULT = /完成|已修|已上线|结果|产物|交付|发布成功|验证通过/i

export interface DraftVerdict {
  keep: boolean
  /** 结果卡（completed goal）：即使草稿没标 result 也要补 true。 */
  result: boolean
}

export function classifyDraft(
  draft: CardDraft,
  mode: 'exception-only' | 'standard' | undefined,
): DraftVerdict {
  const resolved = mode ?? 'exception-only'
  if (resolved !== 'exception-only') return { keep: true, result: Boolean(draft.result) }
  const text = `${draft.title} ${draft.detail} ${draft.reason}`
  if (draft.result) return { keep: true, result: true }
  if (draft.severity === 'high' || draft.kind === 'decision') {
    return { keep: true, result: false }
  }
  if (RESULT.test(text)) return { keep: true, result: true }
  if (RISK.test(text)) return { keep: true, result: false }
  return { keep: false, result: false }
}

export function shouldKeepDraft(
  draft: CardDraft,
  mode: 'exception-only' | 'standard' | undefined,
): boolean {
  return classifyDraft(draft, mode).keep
}
