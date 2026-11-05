// 提问在卡片上的形状：会话 id + callId + 每个问题的选项。

export interface CardQuestionItem {
  id: string
  question: string
  multiSelect?: boolean
  options?: string[]
}

export interface CardQuestion {
  id?: string
  sessionId?: string
  callId?: string | null
  items: CardQuestionItem[]
}
