// 闸门收敛（task-11）：.env 模板 / 密钥内容启发 / story-shot-* 辅助容器白名单。

/** .env 模板文件名（.env.example / .env.prod.sample / foo.env.example）——写模板不是写密钥。 */
const ENV_TEMPLATE = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.env)\.(example|sample|template)$/i
/** 内容像真实密钥：KEY/TOKEN/SECRET/PASSWORD = 长随机值，或 PEM 头。 */
const SECRET_CONTENT =
  /(?:api[_-]?key|token|secret|password|passwd|private[_-]?key)\s*[=:]\s*["']?[A-Za-z0-9+/=_-]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/i
/** /dev/tcp 连通性探测：bash 内置网络探针，不是写文件。 */
/** 可逆仓内写命令（未命中拦截规则时只记 effect，不建卡）。 */
const REVERSIBLE_WRITE = /(^|\s)(>{1,2}\s*\S+|tee\s|sed\s+-i|cp\s+\S+|mv\s+\S+)/

export function reversibleWriteEffect(command: string): 'write-code' | null {
  return command && REVERSIBLE_WRITE.test(command) ? 'write-code' : null
}

export const DEV_TCP = /\/dev\/(?:tcp|udp)\/[^\s'"]+/i
/** 临时辅助容器前缀：story-shot-*（截图/一次性任务），停删不影响任何常驻服务。 */
const SHOT_CONTAINER = /^story-(?:shot|probe|tmp)-[a-z0-9-]+$/

export function isEnvTemplate(path: string): boolean {
  return ENV_TEMPLATE.test(path)
}

export function looksLikeSecretContent(content: string): boolean {
  return SECRET_CONTENT.test(content)
}

/**
 * 停/重启/删开发容器 → 会把正在跑的会话打死。启动（up/start）不算。
 *
 * 白名单（为什么安全）：`story-shot-*` 是截图/一次性辅助容器，没有常驻服务、
 * 没有数据卷、没有对外端口；stop/rm 它们只影响当次临时任务，不会打断会话。
 * 其余 `story-*`（如 story-dev-postgres）与 `dsh-dev` 仍然拦。
 */
export function devContainerReason(command: string): string | null {
  const action = /\bdocker\s+(?:compose\s+(?:-f\s+\S+\s+)?(down|restart)|(stop|restart|rm))\b/.exec(
    command,
  )
  if (!action) return null
  // 生产/共享容器单独一条：docker stop postgres 这类必须拦。
  const prod = /\b(postgres|postgresql|pg|prod-[a-z0-9-]+)\b/.exec(
    command.replace(
      /\bdocker\s+(?:compose\s+(?:-f\s+\S+\s+)?(?:down|restart)|(?:stop|restart|rm))\b/,
      '',
    ),
  )
  if (prod?.[1]) return `dev-container:${action[1] ?? action[2]}:${prod[1]}`
  const names = command.match(/\b(dsh-dev|story-[a-z0-9-]+)\b/g) ?? []
  const touched = names.find((name) => !SHOT_CONTAINER.test(name))
  if (!touched) return null
  return `dev-container:${action[1] ?? action[2]}:${touched}`
}

/** 命令里出现的 .env 路径是否全是模板（如 echo x > .env.example）。 */
export function templateOnlySecretWrite(command: string): boolean {
  const paths = [...command.matchAll(/(^|\s)(\S*\.env[A-Za-z0-9._-]*)/g)].map(
    (match) => match[2] ?? '',
  )
  return paths.length > 0 && paths.every((path) => isEnvTemplate(path))
}

/** git push：推 main/master（含 --force）拦，推特性分支放行。 */
export function gitPushReason(command: string): string | null {
  const push = /\bgit\s+push\b/.exec(command)
  if (!push) return null
  const force = /\s(--force|-f)\b/.test(command)
  const target = /\b(main|master)\b/.exec(command)
  if (target) return `git-push-${target[1]}${force ? ':force' : ''}`
  if (force) return 'git-push:force'
  return null
}

/** 真正把 SQL 交给数据库客户端执行的命令（文件内容里的 SQL 不算 destructive）。 */
const SQL_CLIENT =
  /\b(psql|mysql|mariadb|sqlite3)\b|\bdocker\s+(?:exec|compose\s+exec)\b[^\n]*\b(psql|mysql|mariadb|sqlite3)\b/i
const DESTRUCTIVE_SQL = /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i

export function sqlDestructiveReason(command: string): string | null {
  if (!SQL_CLIENT.test(command)) return null
  if (DESTRUCTIVE_SQL.test(command)) return 'rule:destructive-sql'
  if (/\bdelete\s+from\b/i.test(command) && !/\bwhere\b/i.test(command))
    return 'rule:delete-no-where'
  return null
}
