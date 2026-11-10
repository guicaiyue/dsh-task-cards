#!/usr/bin/env node
// 边界强制：装配只允许发生在单一组合根（wire.ts / index.ts）。
// 别处出现 root.inject / ctx.inject 视为第二个组合根，退出码 1。

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', 'src')
// 分层组合根（§11 裁决）：index.ts（生命周期）→ wire.ts（模块装配）→ kernel/assemble.ts（构造）。
// 允许的构造按类型区分：内核对象只允许 assemble/wire；决策/观察者只允许 wire（审计用例：
// 在 assemble.ts 里 new Decision(...) 必须 exit 1）。
const LAYERS = {
  // Admission 是 Scheduler 的内部依赖（自身默认构造），不属组合根构造对象。
  // 各自模块内自构造（Scheduler 的 Admission、plans 的只读副本身份）不算装配。
  kernel: [
    'src/host/kernel/assemble.ts',
    'src/host/wire.ts',
    'src/host/scheduler/scheduler.ts',
    'src/host/plans/store.ts',
  ],
  decision: ['src/host/wire.ts'],
  inject: ['src/host/wire.ts', 'src/host/index.ts', 'src/host/gate/hooks.ts'],
}
const KERNEL_TYPES =
  /^(Scheduler|Verifier|ReceiptTracker|TodoStore|EvidenceStore|PlansStore|ApprovalPolicyStore)$/
const DECISION_TYPES = /^(Decision\w*|Observer\w*|Question\w*)$/

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
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    if (/\b(root|ctx)\.inject\s*\(/.test(line) && !LAYERS.inject.includes(rel))
      violations.push(`${rel}:${index + 1} root.inject`)
    const constructed = /new\s+(\w+)\s*\(/.exec(line)?.[1]
    if (!constructed) return
    if (KERNEL_TYPES.test(constructed) && !LAYERS.kernel.includes(rel))
      violations.push(`${rel}:${index + 1} new ${constructed}`)
    if (DECISION_TYPES.test(constructed) && !LAYERS.decision.includes(rel))
      violations.push(`${rel}:${index + 1} new ${constructed}`)
  })
}

if (violations.length) {
  console.error(
    '组合根检查违规：装配只允许 index.ts / wire.ts / kernel/assemble.ts（分层组合根；决策层只在 wire 装配）\n',
  )
  for (const item of violations) console.error(`  ✗ ${item}`)
  process.exit(1)
}
console.log('single-composition-root 检查通过')
