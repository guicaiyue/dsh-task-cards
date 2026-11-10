// API 路径的唯一真源：宿主注册路由、客户端 fetch 都从这里取，路径拼错在编译期就断。

export const API_PREFIX = '/dsh-task-cards/api'

export const API_ROUTES = {
  cards: `${API_PREFIX}/cards`,
  action: `${API_PREFIX}/action`,
  settings: `${API_PREFIX}/settings`,
  models: `${API_PREFIX}/models`,
  inspect: `${API_PREFIX}/inspect`,
  policy: `${API_PREFIX}/policy`,
  workspaces: `${API_PREFIX}/workspaces`,
  timeline: `${API_PREFIX}/timeline`,
  titles: `${API_PREFIX}/titles`,
  presence: `${API_PREFIX}/presence`,
  stats: `${API_PREFIX}/stats`,
  decisions: `${API_PREFIX}/decisions`,
  caseInfo: `${API_PREFIX}/case`,
  todo: `${API_PREFIX}/todo`,
  evidence: `${API_PREFIX}/evidence`,
  reconcile: `${API_PREFIX}/reconcile`,
  verify: `${API_PREFIX}/verify`,
  records: `${API_PREFIX}/records`,
  progress: `${API_PREFIX}/progress`,
  css: `${API_PREFIX}/css`,
} as const

export type ApiRouteName = keyof typeof API_ROUTES
