// 设置补丁的白名单字段（从 SettingsStore.set 拆出，控制单文件行数）。

import type { Settings } from '../../shared/contract'

/** P1/P2：授权模式、观察者模式、默认答案与超时继续。返回新对象，不就地改。 */
export function withPolicySettings(next: Settings, patch: Partial<Settings>): Settings {
  const out: Settings = { ...next }
  if (patch.autonomyMode === 'auto' || patch.autonomyMode === 'supervised')
    out.autonomyMode = patch.autonomyMode
  if (patch.observerMode === 'exception-only' || patch.observerMode === 'standard')
    out.observerMode = patch.observerMode
  if (
    patch.askTimeoutAction === 'notify' ||
    patch.askTimeoutAction === 'suggest' ||
    patch.askTimeoutAction === 'off'
  )
    out.askTimeoutAction = patch.askTimeoutAction
  if (typeof patch.askAutoContinue === 'boolean') out.askAutoContinue = patch.askAutoContinue
  if (typeof patch.askTimeoutMinutes === 'number' && Number.isFinite(patch.askTimeoutMinutes))
    out.askTimeoutMinutes = Math.min(24 * 60, Math.max(1, Math.trunc(patch.askTimeoutMinutes)))
  return out
}
