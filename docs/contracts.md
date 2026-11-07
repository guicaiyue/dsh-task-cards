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
| `ask` | `judgment` / `permission` / `clarification` | 决策卡再分：判断（A/B 取舍）/ 许可（yes-no 一个动作）/ 澄清（只缺一条事实） |
| `status` | `open` / `acknowledged` / `scheduled` / `done` / `dismissed` | 状态机，见下 |
| `action` | `{type, delayMs, input, sessionId?}` 或 `null` | 到点要补的那句话；有 action 才可能 `scheduled` |
| `interaction` | `reply` / `question` | 普通回合记录 / 模型提问把对话卡住了 |
| `question` | `{sessionId?, callId?, items[]}` 或 `null` | 问题卡的选项，面板据此作答 |
| `origin` | `{sessionId?, turn?, observerSessionId?, reason, userQuote?, userQuoteAt?, sourceKind?, sourceCardId?, uiCardId?, relatedCardIds?}` | 追溯：哪次会话、第几轮、哪个观察者会话；`reason` 是分类凭据，`triggerText` 是真正触发这张卡的输入（真人或系统代发），`userQuote` 是触发前最近一条真人原话，`sourceKind` 区分真人 / 任务卡系统代发 / 其它系统注入，`uiCardId` 是触发时面板打开的卡，`relatedCardIds` 是同会话最近几张卡 |
| `advice` | `{verdict, summary, options[], chosen, autoApply, basis, precedentIds[], confidence, question, lane, ask, effect, requires[], action, scope, reversible, candidates[], blockedReasons[], applied, at}` 或 `null` | 决策代理人的票拟；`chosen` 是推荐方案序号，`autoApply` 表示该推荐可逆且便宜、允许系统直接执行；见 [决策代理人](decision-agent.md) |
| `silent` | `true` / `false` | 免打扰：建卡时就判定「用户在原会话里已看过」，落盘即 `acknowledged`，不计未读、不亮圆点；只对 `info` 卡成立 |
| `events` | `[{at, type, via?}]` | 追加式审计：created / completed / answered / auto-executed … |

**状态机**（`src/shared/state.ts`）

| 动作 | 目标状态 | 事件 |
| :-- | :-- | :-- |
| `complete` | `done` | `completed` |
| `acknowledge` | `acknowledged` | `acknowledged` |
| `dismiss` | `dismissed` | `dismissed` |
| `reopen` | `open` | `reopened` |
| `answer` | `done` | `answered` |
| `adopt` | `done`（用方案里的 `answer` 走 `answer` 那条路） | `answered` |
| `approve` | `done`，**并把一句话投回原会话**；许可卡用 `permissionAnswer(allow)` 固定模板，判断卡用票拟 `answer`；无会话/投递失败也照样结束（返回 `pushed:false`） | `approved` |
| `deny` | `done`，**并把「不允许」模板投回原会话**；只对 `ask=permission` 成立 | `denied` |
| `mark-reworked` | 不变（判例改 `reworked`） | `reworked` |
| `run-now` / 扫描器执行成功 | `done` | `auto-executed` |
| 扫描器执行失败 | `open` + `lastError` | `auto-failed` |
| `delete` | 移除 | — |

`done` / `dismissed` / `acknowledged` 是「已结束」（`CLOSED_STATUSES`），面板的 KPI 与分组据此计算。「要我知晓」这一格例外：它数最近 24 小时的知晓卡，读掉不会清零，超过 24 小时才掉出去。

**通知卡不走「处理」**：观察者写的 `info` 卡（`source=agent`）是通知，行上没有「知道了 / 忽略」两个按钮——两个动作在状态上完全等价，差别只是 `dismiss` 会写一条判例（已限制为只对决策卡生效）。「看到即已读」的判定收在 `client/hooks/useReadOnScreen.ts`：页签在卡片页、文档可见、**卡在视口里连续停留 2 秒**三条同时成立才发 `acknowledge`——渲染出来不算，列表一屏之外不算，扫一眼划走也不算。人手写的 `info` 卡是备忘，保留「知道了」由人自己勾掉。

**来源判定**：`observer/provenance.ts` 把 `user/message` 分成 `human` / `card-answer` / `system`；实时会话的卡片答复走 `agents.get(sessionId).followup(message)`，`source.kind='dsh-task-cards'`、`form='notice'`，聊天里由插件注册的 `conversation.chat.node` 显示成「任务卡答复」折叠通知；冷会话先调 `sessionController.agents.resolveAgent(sessionId)` 恢复会话再走同一个 `followup`，source 不被改写；只有恢复也失败时才退回 `sessionController.prompt`，此时宿主会把 source 重写成 `user`，只能靠文本标记；`card-answer` 优先看 `source.rpcId=card-answer-*`，没有就看文本标记 `〔任务卡答复 <卡 id>「标题」〕`；`time-context` 等系统注入不算用户轮次，也不更新「用户已回来」游标。观察者输入里人类轮次标「用户原话」，系统代发标「系统代发（来源：任务卡 …）」。

**免打扰（`silent`）在宿主侧判定**：观察者是异步跑的（另起一个模型会话，几秒到几十秒）。回合结束时 `SeenTracker` 记下该会话「用户最后发言」的游标；建卡时如果用户已经在原会话里说了下一句，这一轮的回复他必然看过，`info` 卡直接以 `acknowledged` 落盘并标 `silent`（事件 `acknowledged/via=silent`），不进未读、不亮圆点。决策卡不免打扰——永远要人回应；带 `action` 的自动卡也不会被改成已读，它到点还要执行。

**两个数字**：KPI「要我知晓」数**最近 24 小时创建的知晓卡**（`recentInfoCount`，读没读都算）——若按未读数算，面板一打开自动已读就清零、永远是 0。未读数（`unreadInfoCount`）只用在侧栏「任务卡」图标的圆点上，面板没打开时负责发现新通知。

**面板顺序**（`src/shared/state.ts` 的 `sortCards`）：待我处理的最前——`decision` → `info` → `auto`，已结束沉底；同车道先看 `severity`（high → normal → low），再看 `createdAt`（新的在前）。会话树按组内最该处理的卡排组，组内同理，所以面板第一条永远是等我动的那条。

## 设置（`SettingsSchema`）

`systemPrompt`、`provider`、`model`、`enabled`、`minReplyChars`、`includeSubagents`、`maxInputBytes`、`timeoutMs`。
决策阶段另有 `decisionEnabled`、`decisionPrompt`、`decisionProvider`、`decisionModel`、`decisionPrecedentLimit`、`decisionAutoApply`。
默认值在 `src/host/cards/defaults.ts`；`systemPrompt` 的默认文本就是分类契约（kind 的判定标准），改它等于改分类行为；`decisionPrompt` 为空的含义是「用内置的决策画像」（`src/host/decision/defaults.ts`），不是「没有提示词」。

## 票拟与判例（`AdviceSchema` / `PrecedentSchema`）

```
card.advice = { verdict: approve|reject|modify|wait, summary, confidence, question,
                options: [{ name, cost, gain, worst, answer, verdict }],  // 最多 3 个
                chosen, autoApply, basis, precedentIds[], lane, applied, at, answer,
                ask: judgment|permission|clarification,
                effect: read|write-code|destructive|external|spend,
                requires: string[], action, scope, reversible, candidates[],
                blockedReasons: string[] }
```

**三车道**：`judgment` 给 2–3 个方案；`permission` 只给一个动作 + 范围 + 影响，options 为空；`clarification` 只给 question + candidates，options 为空。许可/澄清的答复由宿主模板生成，不让模型自由写「贴回这张卡」这类指代。

**自动执行闸门**（`decision/answer-guard.ts`）：`autoApply=true` 时必须同时满足 `effect=read`、`requires` 全在当前能力清单（`session.reply` / `cards.complete` / `cards.acknowledge` / `cards.dismiss`）、句子不含未解析的指代、有 origin.sessionId；否则不投递，把原因写进 `advice.blockedReasons` 并在详情里显示。人工批准只拦不存在的能力，不拦指代。

- `verdict`：`approve` 照办 / `reject` 不该做 / `modify` 改后批 / `wait` 现在别决（配 `question` 追问）。
- `applied`：车道纠正是否真的落盘。代理人只允许把 `decision` 降成 `info`（可逆、不需要人动手），反向不落盘。
- `precedentIds`：只能引用输入里真实存在的判例编号；没有同类就写「无同类判例」。

```
precedent = { id, at, cardId, title, question, choice, outcome: unknown|valid|reworked, note, keywords[] }
```

判例只由人的动作产生（作答 / 完成 / 忽略 / 采纳方案 / 批红 / 聊天里作答），且**只收决策卡上的选择**：关掉一条通知、取消一个自动动作不是决定，不进判例库。`outcome=reworked` 的判例**不进决策输入**——用户的硬规则。数据在 `precedents.json`，上限 500 条。

## 策略（`PolicySchema`）

`policy.json` 的三个角色：`observer`（默认无工具、无技能）、`worker`、`default`。白名单里写 `*` 表示全放行。观察者会话拿不到工具，靠的是这份策略 + 观察者 preset 里没有 tool 插件，两层都在。

## 路由（`src/shared/routes.ts`）

| 方法 | 路径 | 用途 |
| :-- | :-- | :-- |
| GET/POST | `/cards` | 列表 / 建卡 |
| POST | `/presence` | 面板在线心跳：`{active, sessionId?, tab?, openCardId?}`；宿主据此解析「这张卡」 |
| POST | `/action` | complete / acknowledge / dismiss / reopen / delete / run-now / answer / adopt / approve / deny / mark-reworked |
| GET/POST | `/settings` | 观察者设置 |
| GET | `/models` | 可选模型目录 |
| GET | `/inspect` | 诊断：请求头里的工具与最近事件（`?id=&events=1`） |
| GET/POST | `/policy` | 工具 / 技能白名单 |
| GET | `/workspaces` | 诊断：工作区里挂了哪些会话 |
| GET | `/timeline` | 详情弹窗的时间线（`?id=`） |
| GET | `/titles` | 批量取会话标题（`?ids=a,b`） |
| GET/POST | `/decisions` | 判例 + 决策执行记录（`{precedents, records}`） / `mark-reworked`、`redecide` |

错误统一为 `{ok:false, code, error}`：`400`（业务错误，code 稳定：`EMPTY_TITLE` `TITLE_TOO_LONG` `NOT_FOUND` `BAD_STATE` `MISSING_ID` `BAD_JSON` `BODY_TOO_LARGE` …）、`403`（跨站/非回环）、`405`（方法不对）、`500`（内部错误，带 `detail`）。

## 观察者记录（`RecordSchema`）

观察者与决策阶段各留一条，用 `phase`（`observer` / `decision`）区分：模型、输入输出长度、token、工具调用次数、耗时、重试次数、状态（`ok` / `empty` / `invalid` / `error`）、出了几张卡/几张票拟、自动执行张数（`applied`）、降车道张数（`corrected`）、输出摘录。面板「决策」页签用它回答「决策者到底跑没跑」。

## 契约怎么被守住

- `tests/shared/contract.test.ts`：宿主写出的卡、观察者吐出的草稿都要能被 schema 解析；旧数据缺字段靠默认值补齐；非法枚举被拒；默认设置/策略本身合法；动作映射、分组不重不漏；客户端 API 前缀 = 宿主前缀。
- `tests/client/abi.test.ts`：中英字典键必须一致（切语言不掉文案）。
- 决策阶段的规则与判例失效条件见 [决策代理人](decision-agent.md)。
- CI 上的 `pnpm verify` 串起 lint / typecheck / test / build / ABI / budget，任何一条断了都进不了 main。
