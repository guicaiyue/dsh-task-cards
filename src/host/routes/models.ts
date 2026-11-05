// GET /models：面板里选观察者用的模型。

import type { HttpRequestLike, HttpResponseLike } from '../http'
import { sendJson } from '../http'
import type { RouteDeps } from './deps'

export function createModelsHandler({ runtime, log }: RouteDeps) {
  return async (_req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const groups: Array<{ provider: string; models: Array<{ id: string; name: string }> }> = []
    let fallback: unknown = null
    try {
      const controller = runtime()?.sessionController
      const catalog = controller?.modelCatalog ? await controller.modelCatalog() : null
      if (catalog) {
        fallback = catalog.default || null
        for (const group of catalog.groups || []) {
          groups.push({
            provider: group.id || group.name || 'unknown',
            models: (group.models || []).map((model) => ({
              id: model.id,
              name: model.name || model.id,
            })),
          })
        }
      }
    } catch (err) {
      log(`读模型目录失败：${(err as Error)?.message || String(err)}`)
    }
    return sendJson(res, 200, { ok: true, groups, default: fallback })
  }
}
