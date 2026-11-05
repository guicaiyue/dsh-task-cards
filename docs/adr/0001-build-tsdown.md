# ADR 0001：用 tsdown 产出 lib/

- 状态：已采纳（2026-11-05）
- 决策点：零构建 → 系统性构建；工具选型

## 背景

插件原来是零构建：`lib/*.js` 手写，`assets/panel.js` 手写，`package.json` 的 `exports` 直接指过去。好处是改完刷新就生效，坏处是：没有类型检查、没有死代码消除、客户端半边的 `__ModuleLoader__` 包装靠手抄、产物形状错了只能等浏览器报错。

要做的事有两件彼此冲突的需求：**宿主侧要能被 Node 直接 import 的 ESM**；**客户端侧必须是 CJS 体 + `window.__ModuleLoader__.load({id, factory})` 包装**（宿主只认这一种形状）。

## 决策

用 **tsdown 0.23.5** 一个工具出两个产物：

| 入口 | 格式 | 平台 | 要点 |
| :-- | :-- | :-- | :-- |
| `src/host/index.ts`、`src/host/observer/prompt.ts` | ESM | node | 直接 import；两个入口共享一个小 chunk |
| `src/client/index.tsx` | CJS | neutral + `inputOptions.platform: 'browser'` | banner/footer 手工补 `__ModuleLoader__` 包装，react 三件套外置 |

## 为什么不是别的

- **tsc 直出**：不会打包，`shared/` 的相对路径到 `lib/` 就断了，也不给客户端做包装。
- **tsup**：能用，但底层 esbuild 对 TS 6 的新语法支持滞后；tsdown 基于 rolldown，与 TS 6 同步，且对 `format: cjs + platform: neutral` 有现成处理。
- **unbuild**：默认 rollup 配置更绕，`outExtensions`、`platform` 这些要么写插件要么改产物名。
- **两套工具**：宿主用 tsc、客户端用 esbuild —— 两份配置、两套坑，不划算。

## 踩过的坑（配置里已固化）

1. `external` 选项已废弃 → 改用 `inputOptions.external`（客户端外置 react）与 `deps.neverBundle`。
2. `format: ['cjs']` 默认按 Node 目标出 `.cjs` 且插 `"use strict"` → 要 `platform: 'neutral'` + `inputOptions.platform: 'browser'`。
3. `package.json` 是 `type: module`，默认产物是 `.mjs`/`.d.mts`，而 `exports` 写的是 `.js` → 用 `outExtensions: () => ({ js: '.js', dts: '.d.ts' })`。
4. banner/footer 要自己补 `var module = { exports: {} }; var exports = module.exports;`，否则 rolldown 的 cjs 产物找不到 `exports`。

## 后果

- 改代码后必须 `pnpm build`（或 `pnpm dev` 挂着看）。宿主有 `dsh-client-hmr` 每 500 ms 轮询 bundle 的 mtime，重建后浏览器自动重载模块。
- `lib/` 是纯产物，已 gitignore；`package.json` 的 `prepare: pnpm build` 让 `link:` 安装时先构建。
- 不再产出 `.d.ts`（见 ADR 0006 的边界说明）：消费方是宿主运行时，不是 TS 用户。
