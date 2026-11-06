// 决策会话的标识：前缀决定「哪些会话是决策会话」，preset id 决定它跑什么组合。

import { DECISION_SESSION_PREFIX } from './defaults'

/** 决策会话自己也会触发回合结束事件，必须排除，否则会被观察者当成用户的一轮。 */
export function isDecisionSession(sessionId: unknown): boolean {
  return String(sessionId || '').startsWith(DECISION_SESSION_PREFIX)
}

export function decisionSessionId(attempt: number): string {
  return `${DECISION_SESSION_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}-${attempt}`
}
