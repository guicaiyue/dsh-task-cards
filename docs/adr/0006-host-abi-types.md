# ADR 0006：宿主 ABI 用结构化窄类型，不引 @deepseek-ai 类型包

- 状态：已采纳（2026-11-05），可复审

## 背景

插件用到 DSH 的十几个服务（agents / sessionController / agentPresets / userQuestions / webServer / tools …）。有两种方式拿到类型：

1. 装 `@deepseek-ai/*` 类型包，直接 `import type`。
2. 自己在 `host-api.ts` 里写窄类型：只用到的字段、全部可选。

## 决策

选 2。`src/host/host-api.ts`（宿主）与 `src/client/context.ts`（客户端）各自声明最小形状，并对值一律用 `unknown` + 窄化函数（`asRecord` / `asString` / `asNumber`）。

理由：

- **版本漂移**：DSH 的 `0.2.x-rc` 还在动，类型包版本与运行中的宿主不一定对齐；类型对不上时，要么锁死旧宿主，要么追着升级。
- **失败模式**：真实宿主缺服务时应该**降级**（观察者记一条异常、路由报 `NO_SERVICE`），而不是编译期就炸。结构化窄类型天然迫使每个调用点写兜底。
- **可审计**：升级 DSH 时只核两张表（`docs/host-abi.md`），不用在几百个类型定义里找差异。

代价：宿主接口改名时不会有编译错误提醒，只有运行时降级。因此补两条护栏：

1. `docs/host-abi.md` 列全用到的能力、缺失时的行为、6 条踩过的坑，升级时按清单核对。
2. `scripts/check-client-bundle.mjs` 与路由/契约测试保证降级路径真能跑（测试里的 fake ctx 只给部分服务，正好覆盖缺服务分支）。

## 复审条件

当 DSH 发布 1.0 且类型包稳定、或本项目需要用到宿主内部类型（而非行为契约）时，改为引类型包，并把 `host-api.ts` 收敛成 re-export。
