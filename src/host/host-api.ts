// 宿主 ABI 的唯一接触面：插件用到的 ctx.* 能力都收敛到这里。
//
// DSH 升级时只核这一份文件 + docs/host-abi.md；其它模块拿 HostRuntime 的类型，
// 不直接写 ctx.xxx 的形状。字段全部可选：服务没起来时插件要能降级而不是崩。

export type Log = (line: string) => void

/** 会话事件：宿主的事件流条目，data 形状随 type 变化，用窄化函数取值。 */
export interface SessionEventLike {
  type: string
  time?: number
  data?: Record<string, unknown>
}

/** 事件流里的一段内容块（assistant/message 的 content）。 */
export interface MessageLike {
  content?: unknown
}

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ModelCatalogModel {
  id: string
  name?: string
}
export interface ModelCatalogGroup {
  id?: string
  name?: string
  models?: ModelCatalogModel[]
}
export interface ModelCatalog {
  default?: unknown
  groups?: ModelCatalogGroup[]
}

export interface PromptRequest {
  requestId: string
  sessionId: string
  mode: 'queue'
  content: Array<{ type: 'text'; text: string }>
}

export interface AgentsLike {
  create(options: Record<string, unknown>): Promise<AgentHandleLike>
  list?(): Array<{ sessionId?: string } | undefined>
}

export interface AgentHandleLike {
  agent: { ctx: unknown }
  dispose(): unknown
}

export interface SessionControllerLike {
  prompt(request: PromptRequest, signal: AbortSignal): Promise<unknown>
  modelCatalog?(): Promise<ModelCatalog | null>
}

export interface AgentDefaultModelLike {
  currentSelection?(): ModelSelection | null
}

export interface AgentPresetsLike {
  register(definition: Record<string, unknown>): Promise<() => unknown>
  select?(agent: unknown, presetId: string): Promise<unknown>
  composedPreset?(ctx: unknown): unknown
  definitions?: Map<string, Record<string, unknown>>
}

export interface WorkspaceLike {
  id: string
  title: string
  path: string
  sessionIds?: string[]
  attachSession(sessionId: string): Promise<unknown>
}

export interface WorkspaceRegistryLike {
  create(path: string, title: string): Promise<WorkspaceLike>
  list?(): WorkspaceLike[]
}

export interface UserQuestionRequest {
  questions?: Array<Record<string, unknown>>
  agent?: Record<string, unknown>
  wait?: { callId?: string }
  signal?: AbortSignal
}

export interface UserQuestionsLike {
  ask(request: UserQuestionRequest, ...rest: unknown[]): Promise<unknown>
  askTimed?(request: UserQuestionRequest, ...rest: unknown[]): Promise<unknown>
  answer?(
    agent: unknown,
    callId: string,
    payload: { answers: Array<{ id: string; selected: string[] }> },
  ): Promise<boolean>
}

export interface SessionQueryLike {
  readSession(sessionId: string): Promise<{ events?: SessionEventLike[]; title?: string }>
}

export interface ToolSchemaLike {
  name: string
}

export interface ToolsLike {
  schemas(): ToolSchemaLike[]
  restrict(options: { deny: string[] }): unknown
}

export interface ConnectionLike {
  requestRejection(req: unknown): number | boolean | null | undefined
}

export interface HostRuntime {
  agents?: AgentsLike
  sessionController?: SessionControllerLike
  agentDefaultModel?: AgentDefaultModelLike
  agentPresets?: AgentPresetsLike
  workspaceRegistry?: WorkspaceRegistryLike
  userQuestions?: UserQuestionsLike
  sessionQuery?: SessionQueryLike
  tools?: ToolsLike
  get?(name: string): unknown
  connection?: ConnectionLike
}

/** 窄化工具：宿主事件里的值是 unknown，取之前先确认形状。 */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
