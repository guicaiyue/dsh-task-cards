// 静态边界：靠代码结构而不是自觉来保证「客户端不进 Node、宿主不进 React」。
//
// Biome 的 noRestrictedImports 已经在 lint 阶段拦住了这些；这里再断一次，
// 是为了让 `pnpm test` 单独跑的时候也能发现越界（比如临时关掉 lint 的提交）。

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SRC = path.join(ROOT, 'src')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

function importsOf(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8')
  const found: string[] = []
  const pattern = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match[1]) found.push(match[1])
  }
  return found
}

function filesUnder(dir: string): Array<{ rel: string; imports: string[] }> {
  return walk(path.join(SRC, dir)).map((file) => ({
    rel: path.relative(ROOT, file),
    imports: importsOf(file),
  }))
}

describe('模块边界', () => {
  it('客户端不 import Node 内置模块、不 import 宿主目录', () => {
    const violations: string[] = []
    for (const file of filesUnder('client')) {
      for (const spec of file.imports) {
        if (spec.startsWith('node:')) violations.push(`${file.rel} → ${spec}`)
        if (spec.includes('/host/') || spec.startsWith('../host'))
          violations.push(`${file.rel} → ${spec}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('客户端不 import zod（否则浏览器 bundle 会多一份校验库）', () => {
    const violations = filesUnder('client')
      .filter((file) => file.imports.includes('zod'))
      .map((file) => file.rel)
    expect(violations).toEqual([])
  })

  it('宿主不 import react，也不 import 客户端目录', () => {
    const violations: string[] = []
    for (const file of filesUnder('host')) {
      for (const spec of file.imports) {
        if (spec === 'react' || spec.startsWith('react-dom'))
          violations.push(`${file.rel} → ${spec}`)
        if (spec.includes('/client/')) violations.push(`${file.rel} → ${spec}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('shared 只依赖 zod 与自身，不反向依赖宿主/客户端', () => {
    const violations: string[] = []
    for (const file of filesUnder('shared')) {
      for (const spec of file.imports) {
        if (spec.startsWith('node:')) violations.push(`${file.rel} → ${spec}`)
        if (spec.includes('/host/') || spec.includes('/client/'))
          violations.push(`${file.rel} → ${spec}`)
      }
    }
    expect(violations).toEqual([])
  })
})
