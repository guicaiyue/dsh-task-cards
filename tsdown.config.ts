// 构建配置：宿主侧 ESM 入口 + 客户端 CJS 包装（与官方客户端包同构）。
//
// 客户端必须是「CJS 体 + window.__ModuleLoader__.load 包装」，宿主只认这种形状。

import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  name: string
}

const shared = {
  outDir: 'lib',
  sourcemap: true,
  // package.json 是 type: module，默认会输出 .mjs/.d.mts；exports 里写的是 .js/.d.ts
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
}

export default defineConfig([
  {
    // 宿主：ESM，给 Node 直接 import；dts 供宿主 ABI 自检
    entry: { index: 'src/host/index.ts', 'observer-prompt': 'src/host/observer/prompt.ts' },
    format: ['esm'],
    platform: 'node',
    // 不产出 .d.ts：这份插件的消费方是宿主运行时（调用 apply），不是 TS 用户；
    // zod 类型卷进 d.ts 会撑到 100 KB 并触发一堆 rolldown 警告。
    dts: false,
    clean: true,
    ...shared,
  },
  {
    // 客户端：浏览器里由宿主的模块加载器执行 factory(require)
    entry: { client: 'src/client/index.tsx' },
    format: ['cjs'],
    // 客户端走压缩：预算按字节算，未压缩时一半体积是空白与长标识符。
    minify: true,
    // neutral + browser：不要 Node 内置，也不要为 Node 生成 CJS 目标
    platform: 'neutral',
    inputOptions: { platform: 'browser', external: ['react', 'react/jsx-runtime', 'react-dom'] },
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    footer: 'return module.exports;\n} });',
    dts: false,
    clean: false,
    ...shared,
  },
])
