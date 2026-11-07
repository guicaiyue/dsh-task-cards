// 许可 / 澄清的固定答复：不交给模型自由发挥，避免「贴回这张卡」这种指代。

import type { Card } from '../../shared/contract'

/** 许可卡的答复：动作 + 范围都来自卡上，能独立成立。 */
export function permissionAnswer(card: Card, allow: boolean): string {
  const action = card.advice?.action || card.detail || card.title
  const scope = card.advice?.scope || '按卡上说明'
  return allow
    ? `已允许：${action}。范围：${scope}。执行后把结果贴回会话，不要再问。`
    : `不允许：${action}。停止这一步，说明你被什么挡住了。`
}

/** 澄清卡的答复：把问题和用户补的值拼成一句，原会话能直接接着做。 */
export function clarificationAnswer(question: string, value: string): string {
  const asked = question.trim() || '刚才的问题'
  return `补充信息：${value.trim()}。这是对「${asked}」的回答，继续。`
}
