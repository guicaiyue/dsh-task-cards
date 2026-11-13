// 卡片是长期账本：会随面板、备份、导出流动，比一次性日志更需要脱敏。
//
// 真实事故（2026-11-11 c-mwbvil7x）：卡片正文引用了带生产库口令的连接串，
// 于是那个口令被原样写进了 cards.json 与会话投影缓存。这里在**落盘前**打码，
// 原文仍留在原会话里，卡片只说明「这里有凭据」。

/** 明显是占位符的值不打码：文档里写 `JWT_SECRET=change-me-to-a-long-random-string` 是正常内容。 */
const PLACEHOLDER =
  /^(change[-_ ]?me.*|changeme|placeholder.*|example.*|dummy.*|test.*|xxx+|\*+|your[-_].*|<.*>|\$\{.*\}|待填.*|示例.*)$/i

const URL_CREDENTIAL = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/gi
const PEM_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
const KEYED_SECRET =
  /(?<![A-Za-z0-9])([A-Za-z_]*(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY))(\s*[:=]\s*)(["'`]?)([^\s"'`,;)]{8,})\3/gi
// 散文里的凭据：中文/英文的「密码/口令/password」紧跟一个 8 位以上的字母数字串。
// 真实卡片长这样：「…超级用户密码（qq823214522，已用 docker inspect 核对）」——
// 结构化规则抓不到它，而它恰恰是最常见的写卡方式。
const NEAR_CREDENTIAL =
  /(密码|口令|password|passwd|secret|token)([^，。；、，\n=]{0,12}?)([A-Za-z0-9][A-Za-z0-9!@#$%^&*_+-]{7,})/gi
const KNOWN_PREFIX =
  /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g

const mask = (value: string, quote: string) => {
  if (PLACEHOLDER.test(value.replace(/^["'`]|["'`]$/g, ''))) return value
  return `***${quote}`
}

/** 把一段文字里的凭据换成 `***`；不改变其余内容，重复调用结果不变（幂等）。 */
export function redactSecrets(text: string): string {
  if (!text) return text
  return text
    .replace(PEM_BLOCK, '[已打码的私钥]')
    .replace(URL_CREDENTIAL, (_all, scheme: string, user: string) => `${scheme}${user}:***@`)
    .replace(KNOWN_PREFIX, '***')
    .replace(NEAR_CREDENTIAL, (_all, head: string, gap: string, value: string) =>
      PLACEHOLDER.test(value) ? `${head}${gap}${value}` : `${head}${gap}***`,
    )
    .replace(
      KEYED_SECRET,
      (_all, name: string, sep: string, quote: string, value: string) =>
        `${name}${sep}${quote}${mask(value, quote)}`,
    )
}

/** 卡片正文里的哪些字段需要打码（标题、详情、逐题问题的题目与选项）。 */
export function redactCardFields<T extends { title?: string; detail?: string; question?: unknown }>(
  card: T,
): T {
  const question = card.question as
    | { items?: Array<{ question?: string; options?: string[] }> }
    | null
    | undefined
  const items = question?.items?.map((item) => ({
    ...item,
    ...(typeof item.question === 'string' ? { question: redactSecrets(item.question) } : {}),
    ...(Array.isArray(item.options)
      ? { options: item.options.map((one) => redactSecrets(one)) }
      : {}),
  }))
  return {
    ...card,
    ...(typeof card.title === 'string' ? { title: redactSecrets(card.title) } : {}),
    ...(typeof card.detail === 'string' ? { detail: redactSecrets(card.detail) } : {}),
    ...(question && items ? { question: { ...question, items } } : {}),
  } as T
}

/** 详情字段的落盘形态：字符串裁到 1000 字，其余当空。 */
export function redactDetail(detail: unknown): string {
  return redactSecrets(typeof detail === 'string' ? detail.slice(0, 1000) : '')
}
