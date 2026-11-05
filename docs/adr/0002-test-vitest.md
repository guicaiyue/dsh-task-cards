# ADR 0002：用 vitest + happy-dom 做三层测试

- 状态：已采纳（2026-11-05）

## 背景

原来的测试是 `node:test` + `node --test`，28 个用例，只能测纯函数与假 HTTP 对象。要测的东西变成三类：宿主业务（store / 观察者输入 / 扫描器 / 路由）、契约（zod schema 与消费方一致）、客户端 React 组件。

`node:test` 三个短板：没有 DOM 环境、没有模块 mock、没有 watch UI 与快照。

## 决策

**vitest 5.1**，一个 `vitest.config.ts` 里三个 project：

| project | 范围 | 环境 |
| :-- | :-- | :-- |
| `unit` | `tests/{shared,host}/**/*.test.ts` | node |
| `client` | `tests/client/**/*.test.{ts,tsx}` | happy-dom + `tests/client/setup.ts` |
| （`legacy` 已随旧面板删除） | — | — |

客户端组件用 `@testing-library/react`，断言用户能看到什么、点了发什么请求，不断言内部实现。

## 坑

- **宿主 shell 里 `NODE_ENV=production`**：React 会加载生产包，`act()` 被禁用，`@testing-library` 直接报错。修法是在 client project 的 `env` 里钉 `NODE_ENV: 'test'`，setup 里再兜一次。
- ABI 测试要真跑构建产物 `lib/client.js`（动态 import），所以测试依赖 `pnpm build`——CI 里 build 在 test 之后，ABI 测试自己会先失败。**因此 `pnpm verify` 的顺序是 build → ABI，测试 ABI 的用例放在 build 之后**（脚本 `test:abi`），组件测试只依赖 `src/`。

## 后果

- 63 个用例，本地 0.5 s 跑完；pre-commit 只跑 `vitest run`（dot reporter），pre-push 跑全量 verify。
- 路由测试用假 `req/res` 对象直接调 handler，不起真实 HTTP 服务：快，但栅栏逻辑只能验到 `makeFence` 这一层。
