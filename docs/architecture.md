# 架构

```
dsh-task-cards/
├── src/
│   ├── shared/           两端共用：契约、路由、状态机、ABI 常量（不依赖 Node/DOM）
│   │   ├── contract.ts   zod schema —— 字段的唯一真源
│   │   ├── routes.ts     API 路径常量
│   │   ├── state.ts      状态机与面板分组
│   │   └── abi.ts        PANEL_ID / LOCALE_NS / slot 名
│   ├── host/             宿主侧（Node）：观察者 + 面板后端
│   │   ├── index.ts      入口：apply(root) 按顺序装配
│   │   ├── wire.ts       装配细节：问题钩子 / 观察者 / 扫描器 / preset / 路由
│   │   ├── host-api.ts   宿主 ABI 的唯一接触面（ctx.* 只在这里出现）
│   │   ├── cards/        卡的存储、默认设置与提示词
│   │   ├── observer/     观察者：触发 → 建会话 → 解析 JSON → 落卡
│   │   ├── question/     阻塞式提问 ↔ 卡片作答
│   │   ├── scanner/      到点执行 auto 卡
│   │   ├── policy/       工具 / 技能白名单
│   │   └── routes/       9 个路由，一个端点一个文件
│   └── client/           客户端侧（浏览器）：面板 UI
│       ├── index.tsx     注册侧栏入口、主面板、字典、样式
│       ├── components/   16 个组件（渲染）
│       ├── hooks/        8 个 hook（数据与副作用）
│       ├── api.ts        所有 fetch 在这里
│       ├── locale/       中英字典
│       └── styles.ts     面板 CSS
├── tests/                shared（契约/边界）、host、client（渲染/ABI）
├── scripts/              ABI 断言、代码预算、发版
├── docs/                 本文档、契约、宿主 ABI、命令、验收、ADR
└── lib/                  构建产物（gitignore，`pnpm build` 生成）
```

## 两条数据流

**① 回合结束 → 卡（核心功能）**

```
agent/status = idle
   │ trigger.ts：本轮有用户输入 + 有最终回复 → 入队（串行）
   ▼
Observer.run：settings 判定（开关 / 最小长度）→ 拼最近三轮素材（字节封顶）
   ▼
runObserverSession：建一个无工具会话（preset=task-cards-observer）
   │  prompt(素材, signal) → 等 agent/status=idle（Waiter 事件驱动，无轮询）
   ▼
extractJson → coerceCards → Store.create（落盘 cards.json）
```

失败重试一次；两次都坏就写一条 `records.json`（`status: invalid`），面板与 `/inspect` 能看到。

**② 面板 → 宿主**

```
Panel（React）── fetch ──► routes/*.ts ──► Store / SettingsStore / Scanner
                                │
                                └── 栅栏：跨站 403 → 宿主 connection 栅栏 → 回环/白名单
```

## 关键约束（都有闸门）

| 约束 | 谁在守 |
| :-- | :-- |
| 客户端不碰 Node / 宿主代码、宿主不碰 React | Biome `noRestrictedImports` + `tests/shared/boundaries.test.ts` |
| 契约只有一份真源 | zod schema + `tests/shared/contract.test.ts` |
| 单文件 ≤300 行、接线文件 ≤150 行、函数 ≤60 行 | `scripts/check-budgets.mjs`（`pnpm budget`） |
| 客户端产物形状与体积 | `scripts/check-client-bundle.mjs`（`pnpm test:abi`，150 KB 预算） |
| 提交信息与推送质量 | lefthook + commitlint + CI |

## 为什么不拆成多个包

只有一个插件、一个消费方（宿主）。多包会带来 workspace 解析、版本对齐、发布顺序的问题，换不来任何隔离收益；用目录边界 + lint 规则已经够。
