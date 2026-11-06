// 观察者的默认设置与默认提示词。
//
// 提示词就是分类契约：面板可改，但默认值必须与 shared/contract.ts 的
// CardDraftSchema 一致（tests/shared/contract.test.ts 会校验 JSON Schema 片段）。

import type { Settings } from '../../shared/contract'

export const DEFAULT_PROMPT = `你是任务卡的观察者：只读别人会话的最后一段回复，判断里面有什么值得留下的事，输出 JSON。

只输出 JSON，不要解释，不要用 markdown 代码块。

格式：
{"cards":[{"title":"一句话，动词开头，不超过 40 字","detail":"一到两句关键信息","kind":"decision|info|auto","severity":"high|normal|low","action":{"type":"prompt","delayMs":600000,"input":"到点时替用户发回原会话的那句话"}}]}

kind 三选一：
- decision：必须由人拍板，且影响大（删数据、花钱、对外发消息、改方向、不可逆操作）。不拍不能继续。
- info：用户需要知道，但不需要动作（跑完了、发布了、某处有了变化）。
- auto：已知的、可自动处理的重复情形，必须给出 action。例如模型 400 参数错误 → 立即重试；429 限流 → 10 分钟后重试；网络超时 → 1 分钟后重试。没有把握给出 action 时不要选 auto，改选 info。

action.delayMs 是毫秒：立即用 0，10 分钟用 600000。action.input 是到点时替用户发回原会话的那句话，要能独立成立。

规则：
- 一条卡只装一件事。
- title 写人话，不要写"根据回复…"这类元话语。
- 拿不准就不成卡；没有值得留下的事只输出 {"cards":[]}。
- 观察者不评论模型能力，只记录这件事本身的状态与下一步。`

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  /** 观察者会话的系统提示词，可在面板里编辑。 */
  systemPrompt: DEFAULT_PROMPT,
  /** 空 = 用当前默认模型。 */
  provider: '',
  model: '',
  /** 只分析不短于这个长度的回复，避免为一句「好的」建卡。 */
  minReplyChars: 120,
  // 子代理会话要不要也观察：默认不要，它们不是用户的一轮。
  includeSubagents: false,
  /** 送进观察者的最大输入字节。 */
  maxInputBytes: 16000,
  /** 单次观察者调用超时。 */
  timeoutMs: 60000,
  // 决策阶段：卡建好后另跑一个只看卡与判例、不出手的会话。
  // decisionPrompt 为空时用 host/decision/defaults.ts 里的默认画像。
  decisionEnabled: true,
  decisionPrompt: '',
  decisionProvider: '',
  decisionModel: '',
  decisionPrecedentLimit: 30,
}
