// 观察者用哪个模型：设置里指定了就用它，否则读宿主的默认模型选择。
//
// 必须给出具体 provider/model：系统提示词的 {{model}} 变量依赖 agent.options.model，
// 不给的话整段提示词装配会直接失败。

import type { Settings } from '../../shared/contract'
import type { HostRuntime, ModelSelection } from '../host-api'

export function resolveModel(ctx: HostRuntime, config: Settings): ModelSelection | null {
  if (config.provider && config.model) return { provider: config.provider, model: config.model }
  try {
    const selection = ctx.agentDefaultModel?.currentSelection?.()
    if (selection && selection.provider && selection.model) {
      return {
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
      }
    }
  } catch {
    /* 没有默认模型服务：返回 null，让调用方记异常 */
  }
  return null
}
