// 观察者会话的工作目录与工作区挂载。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { HostRuntime, Log } from '../host-api'

/** 插件自己的工作区：不挂到用户的任何 workspace 上，侧栏按工作区分组。 */
export function observerWorkspace(): string {
  const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const dir = path.join(DSH_HOME, 'dsh-task-cards', 'workspace')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* 目录已存在或无权限：后面建会话时才报错 */
  }
  return dir
}

/** 把观察者会话挂到插件自己的工作区；失败不影响观察本身。 */
export async function attachToWorkspace(
  ctx: HostRuntime,
  sessionId: string,
  log: Log,
): Promise<void> {
  try {
    const registry = ctx.workspaceRegistry
    if (!registry || typeof registry.create !== 'function') {
      log('宿主没有 workspaceRegistry，观察者会话不会出现在侧栏')
      return
    }
    const workspace = await registry.create(observerWorkspace(), '任务卡观察者')
    await workspace.attachSession(sessionId)
    log(`观察者会话已挂到工作区「${workspace.title}」：${sessionId}`)
  } catch (err) {
    log(`挂工作区失败：${(err as Error)?.message || String(err)}`)
  }
}
