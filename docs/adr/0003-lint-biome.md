# ADR 0003：用 Biome 做 lint + format，并把架构约束写进配置

- 状态：已采纳（2026-11-05）

## 背景

原仓库没有 lint/format，风格靠人。AI 参与开发后这点更危险：模型会写出「能跑但边界混乱」的代码，比如客户端 import `node:fs`。

## 决策

**Biome 2.6.4** 一个工具同时做 lint 与 format（替代 ESLint + Prettier 两套配置与两次运行）。

配置里除通用规则外，固定三条项目特有的约束：

1. `noNonNullAssertion: error` —— 禁止 `!`，逼着把「可能为空」显式处理。
2. `noExplicitAny: error` —— 宿主 ABI 的每个值都是 `unknown`，靠窄化函数取值。
3. `noRestrictedImports` 按目录分开：
   - `src/client/**` 禁止 `node:fs` / `node:path` / `node:os` / `../host`
   - `src/host/**` 禁止 `react` / `react-dom`
   宁可让 lint 报错，也不要在 review 里靠人记。

格式化统一为单引号、无分号、2 空格、行宽 100，与既有代码一致。

## 为什么不是 ESLint + Prettier

- 两份配置、两个进程、两套忽略规则；`typescript-eslint` 与 TS 6 的 peer 兼容需要额外盯（`<6.1.0`）。
- Biome 的 `noRestrictedImports` 足够表达本项目全部架构约束，不需要写自定义 rule。

## 后果

- `pnpm lint` / `pnpm lint:fix`；CI 用 `biome ci .`。
- 架构边界有双层保证：lint（编辑时）+ `tests/shared/boundaries.test.ts`（测试时，正则扫描 import）。
- Biome 2.6.5 发布于 2026-11-04，被 pnpm 的 `minimumReleaseAge` 供应链策略拦下，因此钉在 2.6.4。
