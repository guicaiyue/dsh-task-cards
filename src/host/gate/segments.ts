/**
 * 按 shell 分段：引号内的分隔符不算。复合命令不能对整串做正则——
 * `true && rm -rf /tmp/x` 曾因此整体放行（真机绕过）。
 */
export function splitSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: string | null = null
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] as string
    if (quote) {
      current += ch
      if (ch === quote && command[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === ';' || ch === '\n') {
      segments.push(current)
      current = ''
      continue
    }
    if (ch === '&' && command[i + 1] === '&') {
      segments.push(current)
      current = ''
      i += 1
      continue
    }
    if (ch === '|') {
      segments.push(current)
      current = ''
      if (command[i + 1] === '|') i += 1
      continue
    }
    current += ch
  }
  segments.push(current)
  return segments.map((segment) => segment.trim()).filter(Boolean)
}

/** 从一段里抽 `bash -c "…"` / `sh -c '…'` / `eval …` / `$(…)` / 反引号里的内层命令。 */
export function nestedCommands(segment: string): string[] {
  const out: string[] = []
  const bashC = /\b(?:bash|sh|zsh)\s+-c\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(segment)
  if (bashC) out.push(bashC[1] ?? bashC[2] ?? bashC[3] ?? '')
  const evalCall = /\beval\s+(.+)$/.exec(segment)
  if (evalCall?.[1]) out.push(evalCall[1].replace(/^['"]|['"]$/g, ''))
  for (const match of segment.matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)) {
    const inner = match[1] ?? match[2]
    if (inner?.trim()) out.push(inner)
  }
  return out.filter(Boolean)
}

export const SHELL_DESTRUCTIVE: RegExp[] = [
  /\bfind\b[^|;]*\s-delete\b/,
  /\bxargs\s+(?:-[a-z]+\s+)*rm\b/,
]
