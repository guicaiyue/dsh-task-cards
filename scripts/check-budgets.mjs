#!/usr/bin/env node
// 代码预算：单文件行数、接线文件行数、函数行数。超出就拆，不要调阈值。

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')

const FILE_LIMIT = 300
const ENTRY_LIMIT = 150
const FUNCTION_LIMIT = 60
const ENTRY_FILES = new Set(['src/host/index.ts', 'src/client/index.tsx'])

const failures = []

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 粗略统计顶层函数长度：从 `function name` 到下一个同缩进的闭合括号。 */
function longFunctions(text) {
  const lines = text.split('\n')
  const long = []
  let start = -1
  let name = ''
  let depth = 0
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (start < 0) {
      const match = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/.exec(line)
      if (match) {
        start = i
        name = match[1]
        depth = 0
      }
    }
    if (start >= 0) {
      for (const ch of line) {
        if (ch === '{') depth += 1
        else if (ch === '}') depth -= 1
      }
      if (depth <= 0 && line.includes('}')) {
        const length = i - start + 1
        if (length > FUNCTION_LIMIT) long.push(`${name} (${length} 行)`)
        start = -1
      }
    }
  }
  return long
}

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file)
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n').length
  const limit = ENTRY_FILES.has(rel) ? ENTRY_LIMIT : FILE_LIMIT
  if (lines > limit) failures.push(`${rel}: ${lines} 行 > ${limit}`)
  for (const fn of longFunctions(text)) failures.push(`${rel}: 函数 ${fn} > ${FUNCTION_LIMIT}`)
}

if (failures.length) {
  console.error('代码预算超限：')
  for (const message of failures) console.error(`  ✗ ${message}`)
  process.exit(1)
}
console.log('代码预算通过')
