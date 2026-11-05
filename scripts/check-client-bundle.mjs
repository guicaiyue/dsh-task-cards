#!/usr/bin/env node
// 构建产物 ABI 断言：宿主只认这一种形状，坏了的后果是「面板静默消失」。
//
// 检查项：文件存在、id 等于包名、factory 形态、禁止 node 内置、体积预算、sourcemap 引用。

import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const failures = []
const notes = []

function fail(message) {
  failures.push(message)
}

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8')
}

const clientExport = pkg.exports?.['./client']
const clientPath = typeof clientExport === 'string' ? clientExport : clientExport?.default
if (!clientPath) fail('package.json 缺少 exports["./client"]')

if (clientPath && !clientPath.startsWith('./lib/') && !clientPath.startsWith('lib/')) {
  notes.push(`client 仍指向手写文件 ${clientPath}，跳过构建产物断言（P3 切换后启用）`)
} else if (clientPath) {
  let code = ''
  let size = 0
  try {
    code = read(clientPath)
    size = statSync(path.join(root, clientPath)).size
  } catch {
    fail(`客户端 bundle 不存在：${clientPath}（先跑 pnpm build）`)
  }

  if (code) {
    if (!code.includes('window.__ModuleLoader__.load('))
      fail('缺少 window.__ModuleLoader__.load( 包装')
    if (!code.includes(`id: "${pkg.name}"`) && !code.includes(`id: '${pkg.name}'`)) {
      fail(`包装里的 id 必须等于包名 ${pkg.name}`)
    }
    if (!/factory:\s*\(?\s*require\s*\)?\s*=>/.test(code)) fail('缺少 factory(require) 形态')
    if (!code.includes('exports.apply')) fail('缺少 exports.apply 导出')
    if (/require\(\s*["']node:/.test(code)) fail('客户端 bundle 里出现 require("node:…")')
    if (/\bprocess\.env\b/.test(code)) fail('客户端 bundle 里出现 process.env')
    if (!/\/\/# sourceMappingURL=/.test(code)) fail('缺少 sourceMappingURL')

    const budget = 150 * 1024
    if (size > budget) fail(`客户端 bundle ${size} B 超过预算 ${budget} B`)
    notes.push(`client bundle ${clientPath}: ${(size / 1024).toFixed(1)} KB`)
  }
}

const hostExport = pkg.exports?.['.']?.default || pkg.main
if (hostExport) {
  try {
    const code = read(hostExport)
    if (!code.includes('export')) fail(`宿主入口 ${hostExport} 不像 ESM 模块`)
    if (/from\s*["']react["']|require\(\s*["']react["']/.test(code)) fail('宿主产物里出现 react')
    notes.push(
      `host entry ${hostExport}: ${(statSync(path.join(root, hostExport)).size / 1024).toFixed(1)} KB`,
    )
  } catch {
    fail(`宿主入口不存在：${hostExport}（先跑 pnpm build）`)
  }
}

for (const note of notes) console.log(`  · ${note}`)
if (failures.length) {
  console.error('ABI 检查失败：')
  for (const message of failures) console.error(`  ✗ ${message}`)
  process.exit(1)
}
console.log('ABI 检查通过')
