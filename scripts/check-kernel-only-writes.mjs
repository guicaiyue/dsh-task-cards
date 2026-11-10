#!/usr/bin/env node
// 边界强制：status/decision 只能经由 kernel（cards.patch / transition）改写，
// 不允许在别处直接给卡对象赋值。发现违规即退出码 1，接入 pnpm verify。

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', 'src')
const ALLOWED = [
  'src/host/kernel/',
  'src/host/cards/store.ts',
  'src/host/cards/doc.ts',
  'src/host/cards/defaults.ts',
  // todo 项自己有 status（done/frozen），不是卡片状态机。
  'src/host/todo/',
  // 决定状态的纯函数推导（fillDecision 只给 kernel/store 调用，不直接写业务卡）。
  'src/shared/decision-state.ts',
]

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const violations = []
for (const file of walk(ROOT)) {
  const rel = path.relative(path.resolve(ROOT, '..'), file).split(path.sep).join('/')
  if (ALLOWED.some((prefix) => rel === prefix || rel.startsWith(prefix))) continue
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    // 只看真实赋值：`card.status = ...` / `card.decision = ...`（排除 ==/=> 与对象字面量）
    if (/\b\w+\.(status|decision)\s*=(?!=)/.test(line) && !line.includes('=>')) {
      violations.push(`${rel}:${index + 1}: ${trimmed}`)
    }
  })
}

if (violations.length) {
  console.error('发文（kernel-only-writes）违规：status/decision 只能在 kernel 内改写\n')
  for (const item of violations) console.error(`  ✗ ${item}`)
  process.exit(1)
}
console.log('kernel-only-writes 检查通过')
