// 构建配置：宿主侧两个 ESM 入口（插件本体 + 观察者提示词插件）。
//
// 客户端入口在 src/client 落地后启用（见 docs/adr/0001-build-tsdown.md）：
// 浏览器半边走 CJS 体 + __ModuleLoader__ 包装，与官方客户端包同构。

import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const _pkgName = String(
  (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { name: string })
    .name,
)

export default defineConfig([
  {
    entry: { index: 'src/host/index.ts', 'observer-prompt': 'src/host/observer/prompt.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    sourcemap: true,
    clean: true,
    dts: true,
    // package.json 是 type: module，默认会输出 .mjs/.d.mts；exports 里写的是 .js/.d.ts
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
])
