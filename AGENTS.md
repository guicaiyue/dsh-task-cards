# 给 AI 的开发手册

这个仓库的规矩是**可执行的**：能写成检查的都不写成文档。所以先记住一句话——**先跑 `pnpm verify`，再决定要不要读这条规矩**；如果 verify 已经拦住了，就按它的报错改，不要绕过。

## 一分钟上手

```bash
pnpm install      # 首次；prepare 会先 build
pnpm dev          # 改 src/** 自动重建 lib/，宿主 500 ms 内热重载客户端
pnpm verify       # lint → typecheck → test → build → ABI → 代码预算（推之前必须绿）
```

改宿主要重启宿主进程才生效；改客户端只要 `pnpm dev` 重建（`dsh-client-hmr` 轮询 bundle mtime）。

## 目录约定（写之前先想清楚放哪）

| 想加的东西 | 放哪 | 别放哪 |
| :-- | :-- | :-- |
| 新的卡片字段 / 枚举 / 状态 | `src/shared/contract.ts`（先改 schema） | 别在 host 里手写字段 |
| 新的 API 端点 | `src/shared/routes.ts` 加路径 + `src/host/routes/<名字>.ts` 一个文件 | 别塞进已有 handler |
| 宿主业务逻辑 | `src/host/<领域>/` | 别写进 `index.ts`（只做装配） |
| 面板新组件 | `src/client/components/` | 别让组件直接 `fetch` |
| 数据获取 / 副作用 | `src/client/hooks/` + `src/client/api.ts` | 别在组件里写 useEffect 拼请求 |
| 文案 | `src/client/locale/{zh,en}.ts`（值必须是字符串） | 别在 JSX 里写中文 |
| 样式 | `src/client/styles.ts` | 别引入 CSS-in-JS 库 |
| 宿主服务调用 | 只允许经由 `src/host/host-api.ts` 的窄类型 | 别在别处写 `ctx.xxx` 的形状 |

## 硬规则（违反了会被钩子或 CI 拦下）

1. **契约唯一真源**：字段先改 `contract.ts`，再 `pnpm typecheck` 找漏改处，最后同步 `docs/contracts.md`。
2. **边界**：客户端不许 `import node:*`、不许 import `src/host`、不许值导入 `zod`；宿主不许 import `react`。Biome `noRestrictedImports` + `tests/shared/boundaries.test.ts` 双重拦截。
3. **预算**：单文件 ≤300 行、`index.ts`/`index.tsx` ≤150 行、函数 ≤60 行；客户端 bundle ≤150 KB。超了就拆，**不要调阈值**。
4. **类型**：`strict`、禁 `any`、禁 `!`（`noNonNullAssertion`）。宿主返回值一律 `unknown` + `narrow`（`asRecord`/`asString`）。
5. **提交**：`type(scope): 中文摘要`；type ∈ feat/fix/refactor/test/docs/chore/perf/ci/build/revert，scope ∈ host/client/shared/contract/docs/ci/build/deps/release/repo。
6. **产物不进库**：`lib/` 已 gitignore；不要手改 `lib/`。

## 常见任务的步骤

**加一个卡片字段**
1. `contract.ts` 加字段（给 `.default()`，保证旧数据能解析）。
2. `Store.create` 补赋值；`docs/contracts.md` 字段表补一行。
3. `tests/shared/contract.test.ts` 加断言（旧数据默认值 + 新字段解析）。
4. 面板需要展示就改 `components/CardMeta.tsx`（或对应组件）+ 两份 locale。

**加一个端点**
1. `shared/routes.ts` 加常量；`src/host/routes/<名字>.ts` 写 `createXxxHandler(deps)`。
2. `routes/register.ts` 的路由表加一行（路径、方法、handler）。
3. `tests/host/routes.test.ts` 加往返用例（含错误分支：400/405/403 至少挑一个）。
4. 客户端要用就加到 `src/client/api.ts`，不要绕过它。

**加一个 UI 区块**
1. 组件放 `components/`，props 只接数据与回调，不 fetch。
2. 数据与副作用进 `hooks/`；面板装配在 `usePanelState`。
3. `tests/client/panel.test.tsx` 加一条「看到什么 / 点了发什么」。

**改观察者行为**
1. 提示词默认值在 `src/host/cards/defaults.ts`（改它等于改分类契约，要在提交信息里说明）。
2. 输入构造在 `observer/payload.ts`（纯函数，先加测试再加逻辑）。
3. 会话建立 / 投递在 `observer/session.ts`；别把业务判断塞进去。

## 坑（都已踩过，别再踩）

| 坑 | 正确做法 |
| :-- | :-- |
| `sessionController.prompt` 少传 `AbortSignal` | 第二个参数必传，否则宿主内部抛错 |
| 给会话设 `parentSession` 后再 prompt | 会被判为 subagent routing 拒绝；身份用 `subagent/descriptor` 事件表达 |
| 客户端 bundle 形状 | 必须是 `window.__ModuleLoader__.load({id: 包名, factory})`；`pnpm test:abi` 会验 |
| 测试里 React 报 `act(...) is not supported` | 宿主 shell 有 `NODE_ENV=production`；client project 已钉 `NODE_ENV=test`，别删 |
| tsdown 产物扩展名 | `package.json` 是 `type: module`，靠 `outExtensions` 出 `.js`，配置别动 |
| 热重载后 preset 注册报 duplicate | `observer/preset.ts` 已处理，别重复造 |
| 在 `lib/` 里改代码 | 会被 `pnpm build` 覆盖；改 `src/` |

## 文档地图

- [架构](docs/architecture.md)：两条数据流与模块边界。
- [契约](docs/contracts.md)：卡片字段、状态机、路由、错误码。
- [宿主 ABI](docs/host-abi.md)：用到的 DSH 能力、缺失时的行为、升级核对清单。
- [命令](docs/commands.md)：脚本、安装、数据文件。
- [验收](docs/verification.md)：浏览器验收清单与排障表。
- [ADR](docs/adr/)：为什么是 tsdown / vitest / Biome / lefthook / zod / 结构化 ABI 类型。

## 提交前自检

```bash
pnpm verify
git diff --stat        # 确认没有 lib/ 或临时文件
```

面板改动再加一步：浏览器里点过一遍（见 `docs/verification.md`）。
