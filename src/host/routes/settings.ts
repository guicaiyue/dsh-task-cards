// GET/POST /settings：观察者设置。改完提示词要重挂 preset 才生效。

import { asRecord } from '../host-api'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { readJson, sendJson } from '../http'
import { assertPanelToken } from './auth'
import type { RouteDeps } from './deps'

export function createSettingsHandler({ settings, syncPreset, log }: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    if (req.method === 'GET') {
      return sendJson(res, 200, { ok: true, settings: settings.get(), file: settings.file })
    }
    // 改设置是结论性动作：要面板令牌（agent 不能替人改策略）。
    assertPanelToken(req)
    const body = await readJson(req)
    const patch = asRecord(body.settings)
    const next = await settings.set(Object.keys(patch).length ? patch : body)
    // 系统提示词是在 preset 挂载时读进 section 的：改完必须重挂一次才生效。
    await syncPreset().catch((err: unknown) =>
      log(`提示词重挂失败：${(err as Error)?.message || String(err)}`),
    )
    return sendJson(res, 200, { ok: true, settings: next })
  }
}
