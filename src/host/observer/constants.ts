// 观察者会话的标识：前缀决定「哪些会话是观察者」，preset id 决定它跑什么组合。

export const OBSERVER_PRESET_ID = 'task-cards-observer'
export const OBSERVER_SESSION_PREFIX = 'card-obs-'

/** 观察者会话自己也会触发回合结束事件，必须排除，否则无限递归。 */
export function isObserverSession(sessionId: unknown): boolean {
  return String(sessionId || '').startsWith(OBSERVER_SESSION_PREFIX)
}
