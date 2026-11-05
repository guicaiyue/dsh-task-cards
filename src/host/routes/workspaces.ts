// GET /workspaces：诊断工作区里挂了哪些会话（确认侧栏能不能看到）。

import { StoreError } from '../cards/store'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { sendJson } from '../http'
import type { RouteDeps } from './deps'

export function createWorkspacesHandler({ runtime }: RouteDeps) {
  return async (_req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const registry = runtime()?.workspaceRegistry
    if (!registry || typeof registry.list !== 'function') {
      throw new StoreError('NO_REGISTRY', '宿主没有 workspaceRegistry')
    }
    const list = registry.list().map((workspace) => ({
      id: workspace.id,
      title: workspace.title,
      path: workspace.path,
      sessionIds: Array.isArray(workspace.sessionIds) ? [...workspace.sessionIds] : [],
    }))
    return sendJson(res, 200, { ok: true, workspaces: list })
  }
}
