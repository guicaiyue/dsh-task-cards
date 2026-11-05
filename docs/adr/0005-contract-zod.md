# ADR 0005：zod schema 作为契约唯一真源

- 状态：已采纳（2026-11-05）

## 背景

卡片的结构原来散在四处：`store.mjs` 的字段赋值、`extract.mjs` 的收敛逻辑、`panel.js` 的渲染分支、观察者提示词里的 JSON 示例。改一个字段要改四处，漏改的表现是面板上某类卡不显示。

## 决策

`src/shared/contract.ts` 用 zod 定义 schema，其余全部派生：

```
zod schema ──► z.infer 类型（宿主 + 客户端共用）
     ├─────► 运行时校验（测试里 safeParse 真实数据）
     ├─────► docs/contracts.md 的字段表与状态机
     └─────► 观察者提示词里的 JSON 形状（人读版本）
```

硬规矩：**客户端只能 `import type`**。`contract.ts` 会 import zod 的值，客户端一旦值导入，浏览器 bundle 就多一份校验库——这条由 `tests/shared/boundaries.test.ts` 与 ABI 脚本的体积预算双重盯着。

## 为什么不用纯 TS 类型

纯类型在运行时不存在，没法验证「宿主写出去的卡」与「面板读进来的卡」是不是同一形状。zod 的 `.default()` 还顺手解决了旧数据兼容：缺字段的老卡照样解析。

## 后果

- 改字段先改 schema → `pnpm typecheck` 会把所有漏改处指出来。
- `tests/shared/contract.test.ts`（16 例）覆盖：真实落盘的卡、观察者草稿、默认设置、默认策略、非法枚举、动作映射、分组不重不漏、客户端前缀与宿主一致。
- zod 只在开发期（测试）使用，不进任何产物。
