// 执行适配器：策略决定走哪个适配器，调用方不选。
//
// 关键语义：execute() 成功只表示「动作已被接受」（消息已投进 origin 会话），
// **不表示执行完成**。执行完成由 execution/receipt.ts 等 origin 会话的回合回执。
// M1 只有 session adapter（把指令投回原会话）；system adapter 留接口。

import type { Card } from '../../shared/contract'

export interface DispatchOutcome {
  /** 动作是否已被接受（消息已入队 / 命令已启动）。不等于「做完了」。 */
  accepted: boolean
  /** 投递通道：question / agent / prompt / system。 */
  via?: string
  error?: string
  /** 永久失败（会话不可恢复等）：不重试，直接升级人工。 */
  permanent?: boolean
}

export interface ExecutionAdapter {
  readonly kind: 'session' | 'system'
  execute(card: Card): Promise<DispatchOutcome>
}
