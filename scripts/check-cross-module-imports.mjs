#!/usr/bin/env node
// 模块边界棘轮（§11 R2）：
// - 设计列出的模块对禁止互相 import；
// - 现存违规冻结在 cross-module-allowlist.json，**只减不增**；
// - 新增违规 exit 1；allowlist 里已不存在的条目（代码清理了）也 exit 1，逼着更新冻结表。

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const HOST = path.join(ROOT, 'src', 'host')
const ALLOWLIST_FILE = path.join(import.meta.dirname, 'cross-module-allowlist.json')

/** 设计规定的禁止方向（§4 模块边界）。 */
const FORBIDDEN = {
  decision: ['scheduler', 'observer', 'question'],
  question: ['observer'],
  observer: ['decision'],
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function moduleOf(file) {
  const rel = path.relative(HOST, file).split(path.sep)
  return rel.length > 1 ? rel[0] : null
}

const allowlist = new Set(JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8')))
const current = new Set()

for (const file of walk(HOST)) {
  const source = moduleOf(file)
  if (!source || !FORBIDDEN[source]) continue
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line) => {
    const match = /from\s+['"](\.[^'"]+)['"]/.exec(line)
    if (!match) return
    const target = path.resolve(path.dirname(file), match[1])
    const targetModule = moduleOf(target)
    if (!targetModule) return
    if (!FORBIDDEN[source].includes(targetModule)) return
    current.add(`${rel} -> ${targetModule}`)
  })
}

const added = [...current].filter((entry) => !allowlist.has(entry))
const stale = [...allowlist].filter((entry) => !current.has(entry))

if (added.length || stale.length) {
  if (added.length) {
    console.error('模块边界新增违规（棘轮只减不增）：')
    for (const entry of added) console.error(`  ✗ 新增 ${entry}`)
  }
  if (stale.length) {
    console.error('allowlist 已过期（代码里已无此违规，请删掉这一行）：')
    for (const entry of stale) console.error(`  ✗ 过期 ${entry}`)
  }
  process.exit(1)
}
console.log(`cross-module-imports 检查通过（冻结 ${allowlist.size} 处，当前 ${current.size} 处）`)
