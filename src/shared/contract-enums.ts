// 卡片枚举与类型：被 contract.ts / contract-parts.ts 共用，避免循环导入。

export const CARD_KINDS = ['decision', 'info', 'auto'] as const
export const CARD_SEVERITIES = ['high', 'normal', 'low'] as const
export const CARD_SOURCES = ['human', 'agent'] as const
export const CARD_INTERACTIONS = ['reply', 'question'] as const
export const CARD_ACTION_TYPES = ['prompt', 'retry'] as const
export const ANSWER_VIAS = ['card', 'chat', 'auto'] as const
export const ORDER_SOURCES = ['human', 'card-answer', 'system'] as const
export const ASK_KINDS = ['judgment', 'permission', 'clarification'] as const
export const EFFECTS = ['read', 'write-code', 'destructive', 'external', 'spend'] as const

/** 决策代理人对一张卡给的结论：照办 / 不该做 / 换个做法 / 现在别决。 */
export const ADVICE_VERDICTS = ['approve', 'reject', 'modify', 'wait'] as const
/** 判例的后果：还没验收 / 验收通过 / 后来返工了（返工过的判例不再当准绳）。 */
export const PRECEDENT_OUTCOMES = ['unknown', 'valid', 'reworked'] as const

export type CardKind = (typeof CARD_KINDS)[number]
export type AdviceVerdict = (typeof ADVICE_VERDICTS)[number]
export type PrecedentOutcome = (typeof PRECEDENT_OUTCOMES)[number]
export type CardSeverity = (typeof CARD_SEVERITIES)[number]
export type CardSource = (typeof CARD_SOURCES)[number]
export type CardInteraction = (typeof CARD_INTERACTIONS)[number]
export type CardActionType = (typeof CARD_ACTION_TYPES)[number]
export type AnswerVia = (typeof ANSWER_VIAS)[number]
export type OrderSource = (typeof ORDER_SOURCES)[number]
export type AskKind = (typeof ASK_KINDS)[number]
export type Effect = (typeof EFFECTS)[number]
