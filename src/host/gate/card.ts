// 闸门卡片：命中后立刻落一张 permission 卡（以及降级时必须的「只建卡」卡）。
//
// 分开放是为了 gate.ts 不越过 300 行预算；逻辑仍然是闸门的一部分。

import type { Advice, Card, CardGate, Settings } from '../../shared/contract'
import type { Store } from '../cards/store'
import type { Log } from '../host-api'
import { permitKey } from './allow'
import { classifyTurnCall, type GateDecision } from './classify'

/** 放进 deny 原因里的规则摘要。 */
export function denyText(decision: GateDecision, cardId: string | null): string {
  const where = cardId ? `已建任务卡 ${cardId}` : '已在任务卡面板建卡'
  return `【任务卡闸门】这个动作被判为「${decision.effect}」，${where}，请在面板批准后重试同一条命令。判定依据：${decision.reasons.join('、') || '危险动作'}`
}

/** 票拟只用来给面板提供「影响等级 + 待确认」的展示，不自动执行。 */
function minimalAdvice(decision: GateDecision, at: number): Advice {
  return {
    verdict: 'wait',
    summary: `回合内拦截：${decision.reasons.join('、') || decision.effect}`,
    options: [],
    basis: '回合内工具闸门（命中即拦，需你确认）',
    precedentIds: [],
    confidence: 'high',
    question: '',
    chosen: 0,
    autoApply: false,
    lane: 'decision',
    ask: 'permission',
    effect: decision.effect,
    requires: [],
    action: decision.target,
    reversible: false,
    candidates: [],
    blockedReasons: [],
    applied: false,
    at,
  }
}

export interface GateCardDeps {
  cards: Store
  log: Log
}

export interface GateCardInput {
  decision: GateDecision
  toolName: string
  sessionId: string
  permitKey: string
  at: number
}

/** 命中即建卡：内容带工具、目标、判定依据，以及一次性放行所需的 gate 凭据。 */
export async function createGateCard(deps: GateCardDeps, input: GateCardInput): Promise<Card> {
  const { decision, toolName, sessionId, permitKey, at } = input
  const target = decision.target || decision.effect
  const card = await deps.cards.create(`回合内拦下：${target.slice(0, 60)}`, {
    kind: 'decision',
    severity: 'high',
    source: 'agent',
    ask: 'permission',
    detail: [
      `工具：${toolName}（${decision.reasons.join('、') || '危险动作'}）`,
      `目标：${target}`,
      '批准后请重试同一条命令（一次性放行）；误拦可在设置把「回合内闸门」调成 off。',
    ].join('\n'),
    origin: { sessionId, reason: `回合内闸门：${decision.effect}` },
  })
  // argHash 就存语义身份 key：同一 tool+effect+target 的卡一定相同，
  // 不会再出现「同一命令多个 hash」误导排查（旧字段保留兼容）。
  const gate: CardGate = {
    tool: toolName,
    permitKey,
    argHash: permitKey,
    effect: decision.effect,
    target,
    sessionId,
    reasons: decision.reasons,
    at,
  }
  deps.log(`闸门身份：identity=${decision.identity} key=${permitKey}`)
  return deps.cards.patch(card.id, { gate, advice: minimalAdvice(decision, at) }, 'gate:hit')
}

/** 宿主没有前置钩子时的降级卡：只记录 + 明确说「拦不住」。 */
export async function createDegradedCard(
  deps: GateCardDeps,
  input: Omit<GateCardInput, 'at'>,
): Promise<Card> {
  const { decision, toolName, sessionId } = input
  return deps.cards.create('回合内发现危险动作（本宿主无法前置拦截）', {
    kind: 'info',
    severity: 'high',
    source: 'agent',
    detail: [
      `工具：${toolName}（${decision.reasons.join('、') || decision.effect}）`,
      `目标：${decision.target}`,
      '这个会话不在「回合内闸门」覆盖范围内（未挂载 agent 作用域，或宿主没有回调工具事件）：动作可能已经发生，请人工确认结果。',
    ].join('\n'),
    origin: { sessionId, reason: '回合内闸门：宿主无前置钩子' },
  })
}

/** 启动自检（只跑分类器，不建卡）：日志能区分「回调没进来」与「判定不命中」。 */
export function logSelfTest(input: {
  mode: string
  guardActive: boolean
  settings: () => Settings
  log: Log
}): void {
  try {
    const mode = input.settings().turnGate ?? 'high-risk'
    const decision = classifyTurnCall(
      { tool: 'bash', args: { command: 'rm -rf /x' } },
      { mode, cwd: '/tmp' },
    )
    input.log(
      `闸门自检：deny=${decision.gate}（${decision.reasons.join(',') || '无命中'}）· 接线=${input.mode} · 已注册 guard=${input.guardActive}`,
    )
  } catch (err) {
    input.log(`闸门自检失败：${(err as Error)?.message || String(err)}`)
  }
}

/** 宿主没有前置钩子时：只建卡 + 明确说「拦不住」（绝不假装拦截）。 */
export async function degradeObserve(
  deps: GateCardDeps,
  input: {
    sessionId: string
    tool: string
    args: Record<string, unknown>
    mode: 'off' | 'high-risk' | 'all'
  },
): Promise<string | null> {
  if (input.mode === 'off') return null
  const decision = classifyTurnCall({ tool: input.tool, args: input.args }, { mode: input.mode })
  if (!decision.gate) return null
  const card = await createDegradedCard(deps, {
    decision,
    toolName: input.tool,
    sessionId: input.sessionId,
    permitKey: permitKey({
      sessionId: input.sessionId,
      tool: input.tool,
      effect: decision.effect,
      target: decision.target,
    }),
  })
  deps.log(`闸门降级：本会话未接入前置拦截，只建卡 ${card.id}（${decision.target}）`)
  return card.id
}
