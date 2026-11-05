// GET/POST /policy：工具 / 技能白名单。改完重挂 preset 让限制立刻生效。

import type { Policy } from '../../shared/contract'
import { StoreError } from '../cards/store'
import type { HttpRequestLike, HttpResponseLike } from '../http'
import { readJson, sendJson } from '../http'
import { DEFAULT_POLICY, POLICY_FILE, readPolicy, writePolicy } from '../policy/policy'
import type { RouteDeps } from './deps'

export function createPolicyHandler({ syncPreset, log }: RouteDeps) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    if (req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        policy: readPolicy(POLICY_FILE),
        defaults: DEFAULT_POLICY,
      })
    }
    const body = await readJson(req)
    const policy = body.policy as Policy | undefined
    if (!policy || typeof policy !== 'object') throw new StoreError('BAD_POLICY', '缺少 policy')
    const saved = writePolicy(policy, POLICY_FILE)
    await syncPreset().catch((err: unknown) =>
      log(`策略生效重挂失败：${(err as Error)?.message || String(err)}`),
    )
    return sendJson(res, 200, { ok: true, policy: saved })
  }
}
