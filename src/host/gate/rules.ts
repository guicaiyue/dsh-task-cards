// 单段命令的固定规则表（跨段模式见 classify 的整串预判）。

import type { Effect } from '../../shared/contract'

export const RULES: Array<{ name: string; effect: Effect; pattern: RegExp }> = [
  { name: 'mkfs', effect: 'destructive', pattern: /\bmkfs(\.\w+)?\b/ },
  { name: 'dd-device', effect: 'destructive', pattern: /\bdd\s+if=\/dev\// },
  { name: 'shred', effect: 'destructive', pattern: /\bshred\b/ },
  { name: 'chmod-777', effect: 'destructive', pattern: /\bchmod\s+-R\s+777\b/ },
  { name: 'chown-r', effect: 'destructive', pattern: /\bchown\s+-R\b/ },
  { name: 'redirect-block-device', effect: 'destructive', pattern: />\s*\/dev\/sd/ },
  { name: 'git-reset-hard', effect: 'destructive', pattern: /\bgit\s+reset\s+--hard\b/ },
  { name: 'git-clean-fdx', effect: 'destructive', pattern: /\bgit\s+clean\s+-[a-z]*f[a-z]*d/ },
  { name: 'docker-volume-rm', effect: 'destructive', pattern: /\bdocker\s+volume\s+rm\b/ },
  { name: 'docker-prune', effect: 'destructive', pattern: /\bdocker\s+system\s+prune\s+-a\b/ },
  { name: 'kubectl-delete', effect: 'destructive', pattern: /\bkubectl\s+delete\b/ },
  { name: 'systemctl-stop', effect: 'destructive', pattern: /\bsystemctl\s+(stop|disable)\b/ },
  { name: 'shutdown', effect: 'destructive', pattern: /\b(shutdown|reboot)\b/ },
  { name: 'kill-all', effect: 'destructive', pattern: /\bkill\s+-9\s+-1\b/ },
  {
    name: 'curl-pipe-sh',
    effect: 'destructive',
    pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/,
  },
  {
    name: 'publish',
    effect: 'write-code',
    pattern: /\b(pnpm|npm|yarn)\s+publish\b|\bcargo\s+publish\b|\bgh\s+release\s+create\b/,
  },
  { name: 'docker-push', effect: 'external', pattern: /\bdocker\s+push\b/ },
]
