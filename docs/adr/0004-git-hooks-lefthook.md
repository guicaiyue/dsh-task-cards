# ADR 0004：lefthook 守 pre-commit / commit-msg / pre-push

- 状态：已采纳（2026-11-05）

## 背景

规范写在文档里等于没有：AI 和人都可能跳过 `pnpm lint` 直接提交。要让「不合规的提交进不来」，只能在提交路径上拦。

## 决策

**lefthook 2.2.2**（单二进制、并行执行、YAML 配置）：

| 钩子 | 内容 | 目的 |
| :-- | :-- | :-- |
| `pre-commit` | `biome check --write --staged`（自动暂存修复）+ `typecheck` + `vitest run` | 30 秒内能发现的问题不留到 CI |
| `commit-msg` | `commitlint` | `type(scope): 中文摘要`，type 与 scope 枚举见 `commitlint.config.mjs` |
| `pre-push` | `pnpm verify`（lint + typecheck + test + build + ABI + budget） | 推上去的东西必须是绿的 |

绕过方式只有一个：`LEFTHOOK=0 git commit …`；CI 会重跑全量，绕过不会变成既成事实。

## 为什么不是 husky + lint-staged

- husky 需要 shell 脚本 + Node 依赖链；lefthook 是 Go 单二进制，`lefthook.yml` 声明式。
- pnpm 11 默认拦第三方 postinstall，lefthook 需要在 `pnpm-workspace.yaml` 的 `allowBuilds` 里显式放行（已写）。

## 后果

- 提交慢约 2 秒，推送慢约 6 秒；换来的是 main 上永远可构建。
- CI（GitHub Actions 单 job）跑同一串命令，钩子被绕过也会被 CI 抓住。
