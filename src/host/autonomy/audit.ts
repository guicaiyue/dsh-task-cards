// 自主执行审计（P1）：可逆仓内操作自批后写 autonomy:auto 事件，带可回滚 git ref。

import { execFileSync } from 'node:child_process'

export interface GitSnapshot {
  beforeRef: string
  dirty: boolean
}

/** 取一个可回滚的 git ref：干净区用 HEAD，脏区用 stash-create 的临时 ref（不动工作区）。 */
export function gitSnapshot(cwd: string = process.cwd()): GitSnapshot {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!status) return { beforeRef: head, dirty: false }
    const stash = execFileSync('git', ['stash', 'create'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return { beforeRef: stash || head, dirty: true }
  } catch {
    return { beforeRef: '', dirty: false }
  }
}

/** 回滚方式：git checkout（dirty 时先 checkout 到 stash ref 的 tree 再恢复工作区）。 */
export function rollbackOf(snapshot: GitSnapshot): { kind: string; ref: string } {
  return { kind: snapshot.dirty ? 'git-stash-checkout' : 'git-checkout', ref: snapshot.beforeRef }
}
