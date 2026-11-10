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
| `reopen` | `open`；若卡已进执行链路，先把 `deliveryState` 退回 `idle`（状态机不允许退回的，如已派发在飞，直接 400 `BAD_STATE`） | `reopened` |
| `answer` | `done` | `answered` |
| `adopt` | `done`（用方案里的 `answer` 走 `answer` 那条路） | `answered` |
| `approve` | `done`，**并把一句话投回原会话**；许可卡用 `permissionAnswer(allow)` 固定模板，判断卡用票拟 `answer`；无会话/投递失败也照样结束（返回 `pushed:false`） | `approved` |
| `deny` | `done`，**并把「不允许」模板投回原会话**；只对 `ask=permission` 成立 | `denied` |
| `mark-reworked` | 不变（判例改 `reworked`） | `reworked` |
| `run-now` / 扫描器执行成功 | `done` | `auto-executed` |
| 扫描器执行失败 | `open` + `lastError` | `auto-failed` |
| `delete` | 移除 | — |

**本机数据写入**：`cards.json` / `records.json` / `precedents.json` 的写入口是 `JsonDoc.mutate()`（`readFresh → 变更 → 原子写`），并按文件名加**进程级异步锁**（`doc.ts::withFileLock`）。前提：**锁只在单进程内有效**——本机单实例插件够用；如果将来多进程/多实例共享同一 `$DSH_HOME`，需要换成跨进程锁（文件锁）。锁等待 >2s 会打一行 warning，方便排查慢写。

**「需关注」的唯一口径（面板）**：`stage.ts::needsAttention(card)` = `deliveryState ∈ {failed, unknown}` **且** `waitReason !== null`（还欠一个处置）。KPI、过滤、页头计数、行内动作都只认它；`isSettled` 排除欠处置的卡，所以同一张卡不会同时出现在「需关注」和「已关闭」。`invalidated`（对账失效）不进 attention，它是「已处理、可重开」。行内对这类卡给「重开」（回到待处理后可重新批准或改方向），不给「已批准，执行中」chip——那不是执行中。

**批准幂等（`assertApprovable`）**：`status` 已结束（含生命周期派生的 `done`/`dismissed`）**或** `deliveryState !== 'idle'` ⇒ `400 ALREADY_APPROVED`。不看「在飞枚举」——`unknown`/`failed`/`invalidated` 曾经漏在枚举外，导致同一句答复被派发两次（真实事故）。要重来必须先 `reopen`（把投递状态退回 `idle`）再批准。

**投递幂等键（`scheduler.ts::idempotencyKeyOf`）**：`dispatched` 事件的 `meta.idempotencyKey = cardId + 最后一次 waiting 事件 id`。同一张卡的同一次入队只能派一次：再 tick 时若 journal 里已有同键的 `dispatched` 事件，调度器直接跳过（打日志），不会重复投递。用「最后一次 waiting 事件 id」而不是 `decisionSeq`，是因为派发过程中会连推 leased/dispatched、seq 一路增长，崩溃恢复回到 waiting 时用 seq 会变成新键，重复派发照样发生。

**`status` 是 `deliveryState` 的派生值（单一真源）**：映射表只有一份，在 `src/shared/case.ts` 的 `STATUS_FOR_DELIVERY` / `statusForDelivery()`。一旦卡进了执行链路（`deliveryState` 非 `idle`），它就不再占人的车道——`waiting`/`leased`/`dispatched`/`executed`/`verifying`/`confirmed`/`failed`/`unknown` 一律收成 `done`，`invalidated` 收成 `dismissed`；`idle` 不约束，仍由人管。写入口衔接：`kernel/transition.ts` 在改 `deliveryState` 的同一次 patch 里把 `status` 一起写（不再有第二处补票）；退回 `idle` 语义是「交回给人」，`status` 重新打开。启动与对账时 `kernel/drift.ts` 会把旧数据里「`status=open` 但投递状态已走完」的残留纠正一次（不动 `scheduled` 与人的主动决定）。面板侧统一用 `shared/state.ts` 的 `isCardClosed()`/`effectiveStatus()`，旧的 `isClosed(card.status)` 不再用于分组与关闭判定。

`done` / `dismissed` / `acknowledged` 是「已结束」（`CLOSED_STATUSES`），面板的 KPI 与分组据此计算。「要我知晓」这一格例外：它数最近 24 小时的知晓卡，读掉不会清零，超过 24 小时才掉出去。

**通知卡不走「处理」**：观察者写的 `info` 卡（`source=agent`）是通知，行上没有「知道了 / 忽略」两个按钮——两个动作在状态上完全等价，差别只是 `dismiss` 会写一条判例（已限制为只对决策卡生效）。「看到即已读」的判定收在 `client/hooks/useReadOnScreen.ts`：页签在卡片页、文档可见、**卡在视口里连续停留 2 秒**三条同时成立才发 `acknowledge`——渲染出来不算，列表一屏之外不算，扫一眼划走也不算。人手写的 `info` 卡是备忘，保留「知道了」由人自己勾掉。

**来源判定**：`observer/provenance.ts` 把 `user/message` 分成 `human` / `card-answer` / `system`；实时会话的卡片答复走 `agents.get(sessionId).followup(message)`，`source.kind='dsh-task-cards'`、`form='notice'`，聊天里由插件注册的 `conversation.chat.node` 显示成「任务卡答复」折叠通知；其它非用户来源由插件替换 `turn-trigger` 节点，按 `source.kind` 显示通用文案；冷会话先调 `sessionController.agents.resolveAgent(sessionId)` 恢复会话再走同一个 `followup`，source 不被改写；恢复失败时不再用 `sessionController.prompt` 伪装用户，而是保留卡片并报 `NO_AGENT`；只有完全没有 `resolveAgent` 的老宿主才退回文本标记；`card-answer` 优先看 `source.rpcId=card-answer-*`，没有就看文本标记 `〔任务卡答复 <卡 id>「标题」〕`；`time-context` 等系统注入不算用户轮次，也不更新「用户已回来」游标。观察者输入里人类轮次标「用户原话」，系统代发标「系统代发（来源：任务卡 …）」。

**免打扰（`silent`）在宿主侧判定**：观察者是异步跑的（另起一个模型会话，几秒到几十秒）。回合结束时 `SeenTracker` 记下该会话「用户最后发言」的游标；建卡时如果用户已经在原会话里说了下一句，这一轮的回复他必然看过，`info` 卡直接以 `acknowledged` 落盘并标 `silent`（事件 `acknowledged/via=silent`），不进未读、不亮圆点。决策卡不免打扰——永远要人回应；带 `action` 的自动卡也不会被改成已读，它到点还要执行。

**两个数字**：KPI「要我知晓」数**最近 24 小时创建的知晓卡**（`recentInfoCount`，读没读都算）——若按未读数算，面板一打开自动已读就清零、永远是 0。未读数（`unreadInfoCount`）只用在侧栏「任务卡」图标的圆点上，面板没打开时负责发现新通知。

**面板顺序**（`src/shared/state.ts` 的 `sortCards`）：待我处理的最前——`decision` → `info` → `auto`，已结束沉底；同车道先看 `severity`（high → normal → low），再看 `createdAt`（新的在前）。会话树按组内最该处理的卡排组，组内同理，所以面板第一条永远是等我动的那条。

## 多问题逐题作答（`Card.answers`）

`ask_user_question` 一次可以问多题：面板**逐题分组**（每题只能选一个，缺一题不给提交），提交体是 `answers: [{id, selected[]}]`。服务端校验「每题都有选择」，否则 `400 INCOMPLETE_ANSWERS`；投递给 origin 会话的文本按「问题 → 选择」逐题拼接，不再把同一句话复制给所有题。单题卡保持一键作答（不带 `answers` 走旧路径）。`Card.answers` 记录这一次的逐题选择。

## 面板令牌与人机边界（威胁模型）

特权写（approve/deny/reopen/answer、todo done/freeze、settings、手动收证据、建卡）需要 `X-Panel-Token`；令牌只在 `POST /presence` 通道下发，且该端点要求**浏览器 UA + 面板来源（Origin/Referer 必须存在并指向本机面板端口）**，并记录签发指纹（UA/Origin/脚本特征）。

**威胁模型（必须写清）**：同一宿主内的 root agent 可以伪装成浏览器/伪造 Origin、也能读磁盘和 cookie，因此令牌**挡的是误触发与普通自动化，不构成对 root 的强制边界**。真正的保障是：特权写的 audit 日志 + 卡上「非面板来源」标记 + 人工复核。HTML 里不放明文令牌只是降低顺手拿到的概率，不是安全边界本身。

## 决定状态机与三账分离（阶段 A）

- **权威状态**：`Card.decision: created|card_ready|pending_secretary|escalated_user|approved|rejected|conflicted|stale|notice|closed`；`status` 降为派生视图（`shared/decision-state.ts::statusOfDecision`），旧卡由 `deriveDecision()` 按 kind/ask/deliveryState 推导，不新增第三个状态字段。
- **三账**：`cards.json`（快照）｜`journal/`（事件，`CaseEvent` 走 zod，`traceId` 必填）｜`plans.json`（`ApprovedPlan`：plan/lease/attempt/result/outcome）｜`policy.json`（`ApprovalPolicy`，分级授权，与工具权限 `PolicySchema` 不同物）。
- **事件迁移**：历史 78/134 条事件 `traceId` 为空；`journal.read` 读时补 `migrate-<eventId>`（不写盘、幂等），重放仍以补齐后的值为准；写入端从 `apps` 起强制 zod 校验，新事件不会再缺。
- **分期授权默认值（§9 裁决）**：auto = `effect=read`/可逆诊断写（不要求判例）；delegated = 可逆 + 有判例 + confidence≥0.8 + 非 spend/destructive/external；user = 不可逆/spend/destructive/external/方向变更/低置信/冲突票。

## 授权路由与升级车道（阶段 B）

- **route() 三档**（`src/host/decision/route.ts`）：auto = `effect=read`（不要求判例）；secretary = 可逆 + 有判例 + 置信度 ≥0.8（`delegated` 档）；user = destructive/spend/external/不可逆/低置信/冲突票。**无票拟（card_ready）默认 secretary（pending_secretary），不算 user 档**。
- **置信度映射唯一常量**：`CONFIDENCE_VALUE = { high: 0.95, normal: 0.8, low: 0.5 }`（`src/shared/contract.ts`）；决策代理人只给枚举，阈值判定统一用它换算。无判例时 `write-code` 且 confidence ≥0.9 可补偿进 delegated，否则 user。
- **wait 结构闸门（服务端降级）**：`verdict=wait` 必须带 `question` + `basis`（reason）+ 可决定的 options；缺任一项 → route 判 user 并在 `applyAdvice` 落 `Card.decision='escalated_user'`（不靠提示词自觉）。
- **升级车道**：`laneOf` 对 `decision==='escalated_user'` 返回独立车道 `escalated`（面板分组/KPI 独立，排序在 decision 之后）；`notice` 卡不进决定状态机、不占 KPI（`kpiOf` 直接跳过 info/notice）。
- **delegated 可审计 + override**：`Card.route={decider,reason,threshold,policyVersion,at}` 落盘；delegated 票同时写 `plans.json` 的 `verdicts[]`（`Verdict` 自带 `policyVersion` 字段：authority/confidence/rationale/evidenceRefs/at 齐备），`GET /case?id=` 返回 `verdicts[]{authority,policyVersion,confidence,rationale,evidenceRefs,at}` 供面板详情展开；面板 override 走 `/action {action:'override'}`（要面板令牌），写两条事件 `delegated:overridden` / `delegated:override-ack` 并把 `authority` 改回 user——补偿语义，不回滚旧状态。
- **KPI**：`kpiOf` 只用于面板当前卡片的即时计数（`pending / escalated / overridden / delegated / running / verifying / attention`，escalated 独立、不进 pending）；所有比率类指标以 `/stats.groups.real` 为唯一数据源（见下文「/stats 口径」）。

## 重试策略与升级（C/D 收口）

- **每 plan 最多 3 次 attempt**；失败间隔指数退避 **2s / 10s / 60s**（`scheduler/retry.ts::BACKOFF_MS`）；
- **永久失败不重试**：适配器返回 `{accepted:false, permanent:true}`（会话不可恢复 / 无 agent / TypeError 里的 resolve 类错误）→ 立即 `plan.failed` + 卡 `waitReason=retry-exhausted` + 建一张升级卡「执行失败 N 次：…（继续/缩小/终止）」；
- **适配器抛异常也必须落 attempt**（throw 路径不再遗漏），统一走 `handleFailure`；
- **revalidatePlans**：每次 tick 检查 plans.json，卡已删除 → `plan.cancelled`，不再派发（真机删卡仍派发已修）；
- plan 字段：`cancelled` / `failed`（active 由两者皆 false 表示），attempts 始终嵌套在 plan 内。
- **边界（Lead 裁决，不返工）**：执行结果层面的「A 类异常中断」**不做自动重派**——write+ 自动重派风险更高，落人符合 §4.7「write+ 人确认」；任务级重试只覆盖派发失败（3 次 + 退避 + 永久失败不重试），执行结果的重试留给后续阶段。

## /stats 口径（阶段 D 收口，面板唯一数据源）

- **分母**：真实会话回合（`$DSH_HOME/sessions/*/session-*/` 日志里的 `turn/end`），排除 `card-dec-*`/`card-obs-*` 内部会话；压缩日志按 zstd 多帧逐帧解（Node zstdDecompressSync 只解第一帧，已处理）。
- **干预**：answered + approved + denied + dismissed；批准从 journal 数（`authority=user → to=waiting`，且卡仍在快照内），其余从卡事件；均排除合成卡。
- **分母（写死，唯一口径）**：
  - 升级率 = user 路由 / **非 destructive 的 decision 卡**；
  - wait 率 = wait 票拟 / **有票拟的 decision 卡**；
  - delegated 率、卡/回合 = 分子/分母都取 **decision 卡**（通知不计，单列 `noticePerTurn`）；
  - 回合数 = **真实 `turn/end`**（session 日志去重），不是卡/事件估算；
  - unknown 落人率 = unknown 结论中落到 attention / `awaiting-user-escalation` / `retry-exhausted` / decision 升级卡的比例。
- **合成卡标记**：`card.gate` 存在或标题命中探针正则。
- **面板 KPI 只读 `/stats.groups.real`**（本地不再另算；未加载时显示「KPI 统计加载中」）；响应带 `cardsSha256` 与 `generatedAt` 可复现。

## todo 三类分流（阶段 D，D3）

- **A 异常中断**（报错/超时/被抢占/无回执）→ `unknown`/`failed` + `retry` 或 `escalate`，原因写「执行中断（A 类…）」；
- **B 正常结束但忘更新** → `continue-session` **只给一次**对账机会（retries<1），第二次 `escalate`；
- **C 代价变高/被阻塞**（`blocked` 或 `cost.delta=up`）→ `escalate`，交决策者评估「继续/缩小/终止」，判不了再升级用户。

## 面板分道与 KPI（阶段 D，D4/D5）

- **过滤器分道**：`pending`（等秘书批）/ `escalated`（等升级）/ `running`（执行中）/ `verifying`（验收中）/ `notice`（通知，折叠；不占 KPI）/ `attention` / `closed`；
- **Verdict 展开**：详情「决定票」段显示 authority / actorType / policyVersion / confidence / rationale / evidenceRefs（来自 `GET /case.verdicts[]`）；
- **升级卡说明**：详情显示「为什么升级（route.reason）/ 缺什么（advice.question）/ 秘书倾向（advice.verdict+summary）」；
- **六项 KPI**：delegated 率、override 率、升级率、wait 率、卡/回合、干预/回合、unknown 落人率；**唯一数据源 = `/stats.groups.real`**（面板不再本地计算）；工作台 KPI 区有可核对文本行（服务端口径 + 真实回合数 + sha）。

## 验收链与三级验收（阶段 D）

- **acceptance 生产写入链**：观察者草稿（`CardDraft.acceptance`）→ 建卡前 `sanitizeAll`（`file.path` 必须 `isInside(cwd)` 且排除 `.env`/`.ssh`/credentials；`exit` 只允许 `pnpm test|typecheck|build|lint`、`npm test|run x`、`node scripts/...` 且禁 shell 元字符；`http` 只公网 `https?`）→ 决策票拟建议（`Advice.acceptance`）同样过白名单 → approve 冻结时**再过一次**并写 `planId`；无 acceptance 的卡 detail 追加 `⚠ 无验收方式，需人工补充`（幂等只加一次）。
- **三级验收（E0–E4 按 effect 选最低级）**：`minimumLevelFor`：read=E1 / write-code=E2 / external=E2 / destructive=E3 / spend=E4；confirmed 需机器证据 ≥ max(E2, 该级)；决策卡仍走「回执 + 非空回复」。Outcome 落 `plans.json` 且 `criteriaResults` 绑 planId。
- **白名单实现**：`src/host/evidence/guard.ts`（`sanitizeAcceptance/sanitizeAll`），非法项静默丢弃并记日志。

## plans.json 四类数据（阶段 C 裁决 R3）

计划账本的权威形状（**attempts 嵌套在 plans[] 内，不设顶层 attempts 段**——它属于 plan 的生命周期数据）：

1. 顶层 `plans[]`：每个 plan 含 `lease` / `attempts[]` / `dependsOn[]` / `priority` / `idempotencyKey` / `acceptance[]` / `effect` / `executionMode`；
2. `outcomes[]`：验收结论，绑 `planId`（criteriaResults 级）；
3. `verdicts[]`：delegated 票账本（authority / policyVersion / confidence / rationale / evidenceRefs）；
4. `version` + `updatedAt`：账本版本与最后写入时间。

旧文件（缺段）由 `PlansStore.normalize()` 在 boot 时补齐并写回（幂等，日志 `计划账本归一化：补齐 verdicts/attempts 段`）；`list()` 对旧 plan 逐条归一化 `attempts/dependsOn/acceptance/lease`，保证调度 tick 不因缺段抛错。

## 投递账与幂等边界（阶段 C）

- **plans.json 是投递账**：plan / lease / attempt / priority / dependsOn / idempotencyKey / result / outcome 全落盘；派发前写租约、派发后写 attempt（`attempt.id = dispatchKey`），回执/验收写 outcome（绑 planId）。重启后由 `recoverStaleLeases` 从文件恢复。
- **租约回收是单 TTL + 时钟偏移容差**：`expiresAt + LEASE_RECLAIM_SKEW_MS(5000) < now` 即回收（不是 2×TTL）。过期 6s 即回收，测试覆盖。
- **幂等键的语义**：同一 `dispatchKey`（cardId + 真实迁入 waiting 的事件 id；`noteCase` 的 from===to 备注事件不算）不重复派发；attempt 落 plans.json 后跨重启有效。
- **明确边界（at-least-once）**：崩溃发生在 `adapter.execute` 成功之后、`move(dispatched)+recordAttempt` 之前时，重启回收租约后会**重派一次**（新的 waiting 事件=新键）。设计只承诺「同幂等键不重复派发」，不承诺 exactly-once；指标名统一写「同幂等键不重复派发」。
- **旧事件无键**：C 之前 7 条历史 dispatch 事件没有 `idempotencyKey` meta。口径：这些旧事件**不参与幂等判定**（已在验收报告单列），不做启动回填；回放验证只核对语义等价（接受/失败/重试路径一致）。
- **`GET /case?id=` 返回 7 个 key**：`ok / card / events / badLines / todo / evidence / verdicts`（verdicts 为 delegated 票账本）。
- **路由函数签名**：实际是 `route(RouteInput)`（输入含 card/advice/policy/conflict），设计文档里的 `route(caseFile)` 是同一函数的早期叫法，实现以 `RouteInput` 为准。

## 决策排水（水平触发，阶段 B 收口）

`pending_secretary` 且 `advice=null` 的卡不能靠「建卡边沿」触发：手动 `POST /cards`、迁移后无票拟、重启后的卡都会永远躺着。`wireDecision` 挂 30s 定时器调 `drainPendingDecisions`：
- 每轮最多 **3 张**；同卡**重试上限 2 次**、失败后 **5 分钟退避**（事件 `decision:drain` 计数，不无限打模型）；
- `Settings.autoDecide`（默认 true）关闭后不排水；
- 日志：`决策排水：本轮处理 X 张（剩余 Y 张 pending_secretary）`；每次入队写一条 `decision:drain` 事件可追溯。

## 模块边界与审批策略默认值（阶段 A 收口）

- **分层组合根**：装配只允许 `index.ts` / `wire.ts` / `kernel/assemble.ts`；脚本同时拦 `root.inject` 与 `new <内核对象>`（决策层对象只能在 wire 装配）。
- **模块边界棘轮**：覆盖 decision→scheduler/observer/question、question→observer、observer→decision；现存 10 处冻结在 `scripts/cross-module-allowlist.json`，新增或过期条目都会让 `pnpm verify` 失败（只减不增）。
- **审批策略默认值**：`approval-policy.json` 读取时自愈——新文件/空档（历史 bug 写出的 `[]`）都会回落到非空默认规则（auto/delegated/user 三档），B 阶段 `route()` 不会读到空表。默认串见 `DEFAULT_TIERS`。

## 台账自证收口（`Card.acceptance` / `planId`，审计 P0-4）

验收链不能被执行者自己伪造，契约上收成三条：

1. **证据只能按批准时冻结的验收表收集**：`Card.acceptance[]` 是批准时冻结的检查器清单（exit/file/http + `level`）。`POST /evidence` **不再接受** `checks`/`cmd`，只接受 `{caseId, planId}`；伪造或未批准 → `403 PLAN_BOUND`/`403 PLAN_MISMATCH`，无冻结表 → `400 NO_ACCEPTANCE`。checker 永远来自卡上的表，外部无法注入任意命令。
2. **清单绑定计划**：批准时生成 `planId = cardId:decisionSeq` + 一次性 `planNonce`（nonce 只存在卡上，执行者拿不到）。`POST /todo` 对已批准卡必须带匹配的 `planId`（否则 `403 PLAN_MISMATCH`）；`actor=executor` 不能把清单项标 `done`、也不能 `freeze`（`403 SELF_REPORT_FORBIDDEN`）。
3. **证据分级**：`EvidenceRecord.level: E1|E2|E3|E4` + `sourceRef`（指向真实产物/日志/测试输出，或 `planId#acceptanceId`）。**验收只有 E2 及以上（机器产出）才能 confirmed**；E1 只算线索。决策卡仍走「执行回执 + 非空回复」，不受此条影响。

**兼容/迁移**：旧卡没有 `acceptance`/`planId`——不会被判 confirmed（该结论本来就要求证据），需要重新批准一次才会冻结计划；旧证据没有 `level` 一律按 **E1** 处理（不足以 confirmed），不会让历史卡突然变绿，也不会删旧账；`/evidence` 的老调用方式（传 `checks`）会被 403，调用方需改为「批准 → 用 planId 收集」。

## 产物对账（`Card.artifacts`）

观察者报「失败 / 没做完 / 还缺 X」时必须给 `artifacts`（可核验的产物路径），给不出就降 `info/severity=low`。`/reconcile` 的确定性判据：open 卡且 `artifacts` **全部已存在** → `invalidated`（reason `artifacts-exist`，保留证据、可一键重开）；产物不全则不动；`advice.effect` 为 `destructive`/`spend` 的卡不自动失效（只能提议）。

## 回合内闸门（`Card.gate`、`Settings.turnGate`）

危险动作在**工具执行前**就被拦下，不等回合结束（真实事故：回合内准备对生产库 `ALTER TABLE`，只能人工叫停）。

- **能力**：`tools.guard`（同步、单调，首选）→ `tools/pre-execute` + `prepend`（可 async，能先建卡再 deny）→ 都没有时**不假装拦截**：靠 `session/event` 的 `tool/call` 只建卡 + 日志，卡上写明「本宿主不支持前置拦截，请人工确认」。探测结论与降级语义见 [宿主 ABI](host-abi.md)。
- **档位**：`Settings.turnGate: 'off' | 'high-risk' | 'all'`，默认 `high-risk`。`high-risk` 拦：生产库 DDL/DML（容器名/库名按**完整词**匹配：`postgres` 是生产、`story-dev-postgres` 与 `-d story_dev` 不是）、破坏性命令（`rm -rf` 出工作区/工作区根、`mkfs`、`git reset --hard`、`git push` 到 main/master、停/重启 `dsh-dev|story-*` 容器…）、花钱、写工作区外/密钥、发布类；**不拦**：工作区内 edit/write、`git add/commit`、`pnpm test/build/install`、`pnpm add/npm i/pip install`。
- **覆盖范围**：只对「插件观察过、且已将 listener 挂到该会话 agent 作用域」的会话生效（会话首个 `session/event` 时挂载）；插件启动前已存在或从未产生事件的会话不在范围内，那里只会事后建「未拦截」卡。宿主完全不回调工具事件时自动降级为只建卡（面板策略页有同一条说明）。
- **卡**：命中当场建 `decision` + `ask=permission` + `severity=high` 卡，`gate={tool,effect,target,argHash,sessionId,reasons,at}`；`reasons` 是判定依据（`rule:git-push-main`、`prod-db:container:postgres`…），审计一眼可查。
- **放行**：`approve` 发一张一次性放行券（`sessionId+tool+argHash`，TTL 10 分钟，热重载不丢）；同签名下一次调用通过后核销，第二次仍被拦；`deny` 清券。误拦时把 `turnGate` 调 `off`。

## 执行与回执（`ExecutionResult`，`src/shared/execution.ts`）

执行系统只返回事实，验收由验证器做。M1 的 `planId = cardId`（还没有独立 plan 文件）。

| 阶段 | 谁推进 | 语义 |
| :-- | :-- | :-- |
| `waiting → leased → dispatched` | 调度器 | 把批准的那句话投回 origin 会话。**`dispatched` 只表示「话投出去了」**，不等于 agent 做完了 |
| `dispatched → executed` | `host/execution/receipt.ts` | **回执**：origin 会话在派发之后又起了一轮（`turn > dispatchedTurn`）并结束，且该回合最终回复非空；`meta.execution` 落 `ExecutionResult{planId,executor,status,dispatchedTurn,receiptTurn,replyChars,durationMs}` |
| `dispatched → failed` | 同上 | 超过 TTL 无回执 → `no-receipt`；origin 会话报错 → `receipt-error`；回执回合回复为空 → `empty-reply`。一律 `waitReason=awaiting-user-escalation`（进「需关注」，不新建「要我决策」卡），人重来要手动 `reopen` + 重新批准 |
| `executed → verifying → …` | 验证器 | 只在回执之后触发（`DTC_VERIFY=on` 的自动验收也挪到这里，不再和派发同一个 tick） |

回执定义收在 `hasReceipt()`：`status==='succeeded'` 且 `receiptTurn > dispatchedTurn` 且 `replyChars > 0`。验收规则随之更新：**没有清单、没有证据时，唯一能 `confirmed` 的凭据是回执**（决策卡走这条）；不再按 `kind==='decision'` 无条件放行。派发时回合号写进 `dispatched` 事件的 `meta.turn`，重启/热重载后 `restore()` 靠它复原在飞回执。

## 设置（`SettingsSchema`）

`systemPrompt`、`provider`、`model`、`enabled`、`minReplyChars`、`includeSubagents`、`maxInputBytes`、`timeoutMs`。
决策阶段另有 `decisionEnabled`、`decisionPrompt`、`decisionProvider`、`decisionModel`、`decisionPrecedentLimit`、`decisionAutoApply`、`autoApproveDiagnostics`（独立开关，只放行可逆诊断性 write-code）。
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

**自动执行闸门**（`decision/answer-guard.ts`）：`autoApply=true` 时必须同时满足 `effect=read`（或可逆诊断性 `write-code` 且对应开关打开）、`requires` 全在当前能力清单（`session.reply` / `cards.complete` / `cards.acknowledge` / `cards.dismiss`）、句子不含未解析的指代、有 origin.sessionId；否则不投递，把原因写进 `advice.blockedReasons` 并在详情里显示。人工批准只拦不存在的能力，不拦指代。

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
| GET/POST | `/decisions` | 判例 + 决策执行记录（`{precedents, records}`） / `mark-reworked`、`redecide`、`preview`（只读预演，不写卡不投递） |
| GET | `/case` | 一张卡的案卷（`?id=`）：事件流 + 执行清单 + 证据 |
| POST | `/todo` | 执行者维护清单（add/update/remove/freeze） |
| POST | `/evidence` | 落一条证据（exit/file/http 检查结果） |
| POST | `/reconcile` | 确定性对账：失效被同会话新卡取代的旧卡 |
| POST | `/verify` | 手动触发一次验收 |
| GET | `/records` | 跨卡最近事件（`?limit=`，默认 100、上限 300），记录屏用 |
| GET | `/progress` | 全部卡的行内进度（清单完成度） |
| GET | `/css` | 面板样式表（`text/css`）：样式当静态资源发，不进客户端 bundle |

错误统一为 `{ok:false, code, error}`：`400`（业务错误，code 稳定：`EMPTY_TITLE` `TITLE_TOO_LONG` `NOT_FOUND` `BAD_STATE` `MISSING_ID` `BAD_JSON` `BODY_TOO_LARGE` …）、`403`（跨站/非回环）、`405`（方法不对）、`500`（内部错误，带 `detail`）。

## 观察者记录（`RecordSchema`）

观察者与决策阶段各留一条，用 `phase`（`observer` / `decision`）区分：模型、输入输出长度、token、工具调用次数、耗时、重试次数、状态（`ok` / `empty` / `invalid` / `error`）、出了几张卡/几张票拟、自动执行张数（`applied`）、降车道张数（`corrected`）、输出摘录。面板「决策」页签用它回答「决策者到底跑没跑」。

## 契约怎么被守住

- `tests/shared/contract.test.ts`：宿主写出的卡、观察者吐出的草稿都要能被 schema 解析；旧数据缺字段靠默认值补齐；非法枚举被拒；默认设置/策略本身合法；动作映射、分组不重不漏；客户端 API 前缀 = 宿主前缀。
- `tests/client/abi.test.ts`：中英字典键必须一致（切语言不掉文案）。
- 决策阶段的规则与判例失效条件见 [决策代理人](decision-agent.md)。
- CI 上的 `pnpm verify` 串起 lint / typecheck / test / build / ABI / budget，任何一条断了都进不了 main。
