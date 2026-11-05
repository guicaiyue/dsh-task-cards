# 契约

这份文档是 `src/shared/` 的导读，不是第二份真源。**真源是 `src/shared/contract.ts` 里的 zod schema**：类型、校验、JSON Schema、本文档、测试断言都从它派生。改字段先改 schema，别处跟着走。

## 一次会话结束时发生什么

```
会话回合结束（agent/status → idle）
        │
        │ 只读：最近三轮「用户输入 + 模型最终输出」，按字节封顶
        ▼
观察者会话（独立 session，presetId = task-cards-observer，无 tool、无 skill）
        │
        │ 只输出 JSON：{"cards":[{"title","detail","kind","severity","action"}]}
        ▼
extract.ts：整段 JSON → 代码块 → 平衡括号扫描（不信任模型只输出 JSON）
        ▼
contract.ts 的 CardDraftSchema 形状 → 落盘成 Card
        ▼
面板 /v1 卡片页；到点的 auto 卡由扫描器在原会话里补一句话
```

## 卡片（`CardSchema`）

| 字段 | 取值 | 含义 |
| :-- | :-- | :-- |
| `kind` | `decision` / `info` / `auto` | 要我决策 / 要我知晓 / 自动处理 |
| `severity` | `high` / `normal` / `low` | 视觉权重与排序 |
| `status` | `open` / `acknowledged` / `scheduled` / `done` / `dismissed` | 状态机，见下 |
| `action` | `{type, delayMs, input, sessionId?}` 或 `null` | 到点要补的那句话；有 action 才可能 `scheduled` |
| `interaction` | `reply` / `question` | 普通回合记录 / 模型提问把对话卡住了 |
| `question` | `{sessionId?, callId?, items[]}` 或 `null` | 问题卡的选项，面板据此作答 |
| `origin` | `{sessionId?, turn?, observerSessionId?}` | 追溯：哪次会话、第几轮、哪个观察者会话 |
| `events` | `[{at, type, via?}]` | 追加式审计：created / completed / answered / auto-executed … |

**状态机**（`src/shared/state.ts`）

| 动作 | 目标状态 | 事件 |
| :-- | :-- | :-- |
| `complete` | `done` | `completed` |
| `acknowledge` | `acknowledged` | `acknowledged` |
| `dismiss` | `dismissed` | `dismissed` |
| `reopen` | `open` | `reopened` |
| `answer` | `done` | `answered` |
| `run-now` / 扫描器执行成功 | `done` | `auto-executed` |
| 扫描器执行失败 | `open` + `lastError` | `auto-failed` |
| `delete` | 移除 | — |

`done` / `dismissed` / `acknowledged` 是「已结束」（`CLOSED_STATUSES`），面板的 KPI 与分组据此计算。

**面板顺序**（`src/shared/state.ts` 的 `sortCards`）：待我处理的最前——`decision` → `info` → `auto`，已结束沉底；同车道先看 `severity`（high → normal → low），再看 `createdAt`（新的在前）。会话树按组内最该处理的卡排组，组内同理，所以面板第一条永远是等我动的那条。

## 设置（`SettingsSchema`）

`systemPrompt`、`provider`、`model`、`enabled`、`minReplyChars`、`includeSubagents`、`maxInputBytes`、`timeoutMs`。
默认值在 `src/host/cards/defaults.ts`；`systemPrompt` 的默认文本就是分类契约（kind 的判定标准），改它等于改分类行为。

## 策略（`PolicySchema`）

`policy.json` 的三个角色：`observer`（默认无工具、无技能）、`worker`、`default`。白名单里写 `*` 表示全放行。观察者会话拿不到工具，靠的是这份策略 + 观察者 preset 里没有 tool 插件，两层都在。

## 路由（`src/shared/routes.ts`）

| 方法 | 路径 | 用途 |
| :-- | :-- | :-- |
| GET/POST | `/cards` | 列表 / 建卡 |
| POST | `/action` | complete / acknowledge / dismiss / reopen / delete / run-now / answer |
| GET/POST | `/settings` | 观察者设置 |
| GET | `/models` | 可选模型目录 |
| GET | `/inspect` | 诊断：请求头里的工具与最近事件（`?id=&events=1`） |
| GET/POST | `/policy` | 工具 / 技能白名单 |
| GET | `/workspaces` | 诊断：工作区里挂了哪些会话 |
| GET | `/timeline` | 详情弹窗的时间线（`?id=`） |
| GET | `/titles` | 批量取会话标题（`?ids=a,b`） |
| POST | `/presence` | 面板心跳（宿主未注册 = 静默忽略，客户端不依赖它） |

错误统一为 `{ok:false, code, error}`：`400`（业务错误，code 稳定：`EMPTY_TITLE` `TITLE_TOO_LONG` `NOT_FOUND` `BAD_STATE` `MISSING_ID` `BAD_JSON` `BODY_TOO_LARGE` …）、`403`（跨站/非回环）、`405`（方法不对）、`500`（内部错误，带 `detail`）。

## 观察者记录（`RecordSchema`）

每次观察者运行留一条：模型、输入输出长度、token、工具调用次数、耗时、重试次数、状态（`ok` / `empty` / `invalid` / `error`）、建了几张卡、输出摘录。面板与 `/inspect` 用它判断「观察者到底干活了没有」。

## 契约怎么被守住

- `tests/shared/contract.test.ts`：宿主写出的卡、观察者吐出的草稿都要能被 schema 解析；旧数据缺字段靠默认值补齐；非法枚举被拒；默认设置/策略本身合法；动作映射、分组不重不漏；客户端 API 前缀 = 宿主前缀。
- `tests/client/abi.test.ts`：中英字典键必须一致（切语言不掉文案）。
- CI 上的 `pnpm verify` 串起 lint / typecheck / test / build / ABI / budget，任何一条断了都进不了 main。
