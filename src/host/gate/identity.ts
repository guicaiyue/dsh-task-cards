// 语义身份与哈希（从 classify.ts 拆出，控制单文件行数）。

import { createHash } from 'node:crypto'

export function hashOf(identity: string): string {
  return createHash('sha256').update(identity).digest('hex').slice(0, 32)
}

export function identityOf(tool: string, effect: string, target: string): string {
  return `${tool}\u0000${effect}\u0000${target}`
}
