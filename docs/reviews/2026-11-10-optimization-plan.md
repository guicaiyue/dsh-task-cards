# 2026-11-10 任务卡优化实施计划（防错 + 闭环）

> 输入：产品负责人确认的 P0/P1 方向、[四层闭环设计](../design/scheduler/dsh-task-cards-scheduler.md)、
> [A-core](../design/scheduler/A-CORE-PLAN.md)、[TODO 对账](../design/scheduler/TODO-RECONCILE.md)、
> [证据模型](../design/scheduler/EVIDENCE-MODEL.md)、真实事故复盘
> `/vol1/1000/开发/NAS/story/docs/product/05-task-card-review.md`。
> 配套审计：`2026-11-10-audit.md`（card-analyst 产出，落地后回填编号）。
> 边界：只改 `src/`、`tests/`、`docs/contracts.md`、本文件；不 revert 既有 110 个未提交改动；不 commit。

## 0. 一句话

这轮不新增"能力"，只补两条短路：**危险动作在回合内就被拦住**（P0-1）、
**观察者不再因为时机而漏看**（P0-2）；并先把**卡片生命周期收成一个真源**（P0-3），
否则前两项建出来的卡在面板上仍会被误判。P1 三项都是在同一批契约上加"少让人干活"的收口。

## 1. 现状根因（代码级）

| # | 现象（真实事故） | 现在的代码为什么拦不住 |
| :-- | :-- | :-- |
| 1 | 回合内准备 `ALTER TABLE` 生产库，只能人工叫停（复盘 F） | 观察者只在 `agent/status → idle` 触发（`host/observer/trigger.ts`），回合内没有任何工具前置闸门；`host-api.ts` 也没有登记宿主 `tools.guard` 能力 |
| 2 | 70 分钟长回合 / 坏回合 / 连发回合 / 新会话首轮都出现零卡（复盘 §7–§9） | 触发绑死在单一事件上：`createAgentStatusHandler` 拿不到累积状态就 `skipReason` 直接放弃（trigger.ts:187–201），没有定时兜底，也不会从会话日志补读 |
| 3 | 批准后 `status=open, deliveryState=unknown`，面板仍显示"要我决策"，按钮还在（复盘 A/B） | `status` 与 `deliveryState` 两套状态各写各的：`routes/action.ts` 只 patch `status`，`kernel/transition.ts` 只 patch `deliveryState`，`verifier.ts` 又额外 patch 一次 `status: done`；`shared/state.ts::groupCards` 只看 `status`。两套状态的映射表只活在 `client/stage.ts` 里 |
| 4 | 3 个问题被拍平成 7 个选项，点一个当成全部答案（复盘 C） | `question/answer.ts:51–53` 把同一条文本塞进每个 item 的 `selected`；客户端 `QuestionOptions.tsx` 把各题选项铺平，没有逐题状态 |
| 5 | 失败卡结论过期，工作已落地仍挂在待处理（复盘 §8） | `reconcile/reconcile.ts` 只认"被同会话更新的同类卡取代"，不看产物存在性；观察者提示词允许只凭模型自述失败建卡 |
| 6 | 汇报类 content 被做成 decision 卡，待办虚高（复盘 §3 / EVIDENCE-MODEL E0） | 观察者草稿写什么就落什么，没有确定性降噪；同源重复卡也没有合并 |

## 2. 逐项方案

每条格式：改哪里 → 动哪个契约 → 加什么测试 → 风险/回滚。

### P0-1 回合内危险动作前置闸门

**做什么**：在宿主工具执行前注册一个**单调门禁**（`tools.guard`，拿不到时退回
`tools/pre-execute` 并 `prepend`），把 `destructive / spend / 高风险 write-code` 的调用**当场 deny**，
同时立刻建一张 `ask=permission` 的决策卡（不等回合结束）。用户批准时发一张**一次性放行券**
（session + tool + 参数哈希 + TTL），下一次同签名调用才通过。

- 新增 `src/host/gate/classify.ts`（纯函数）：`classifyTurnCall({tool,args,cwd})`
  → `{ effect, risky, target, argHash, reasons }`。
  规则固定、可枚举：破坏性命令（`rm -rf` 出工作区、`mkfs`、`dd if=`、`DROP/TRUNCATE TABLE`、
  `DELETE FROM` 无 WHERE、`git push --force`、`git reset --hard`、`docker volume rm`、
  `docker system prune`、`kubectl delete`、`shutdown/reboot`）、spend（支付/下单/stripe…）、
  高风险写（工作区之外的绝对路径、`.env`/密钥/凭据、`/etc/`、发布与安装类 `pnpm publish`/`pnpm add`）。
- 新增 `src/host/gate/gate.ts`：注册/卸载门禁；放行券表放 `globalThis[Symbol.for(...)]`（热重载不丢）；
  `allowOnce(card)` 由 `/action approve` 调用。
- 改 `src/host/host-api.ts`：`ToolsLike` 增 `guard?(fn)`；新增 `ToolExecutionLike`。
- 改 `src/host/wire.ts` / `index.ts`：注入 `tools`，注册门禁，把 `gate` 传给路由。
- 改 `src/host/routes/action.ts`：`approve` 前若卡带 `gate`，先发券；`deny` 清券。
- 改动契约：`Card.gate?: {tool,effect,target,argHash,at,reasons} | null`（`contract.ts`）；
  `Settings.turnGate: 'off' | 'high-risk' | 'all'`（默认 `high-risk`）。
- 测试：`tests/host/gate-classify.test.ts`（每条规则命中/不命中、cwd 内写不拦）、
  `tests/host/turn-gate.test.ts`（guard 注入后 deny+建卡；approve 后一次性放行；deny 不放行；off 不拦）。
- 风险：误拦会打断开发。默认只拦 destructive/spend/高风险写；工作区内普通 `edit/write` 不拦。
- 回滚：`turnGate:'off'`（面板设置），或删 `wireTurnGate` 一行；不动旧路径。

### P0-2 观察者触发兜底

**做什么**：除 `agent/status → idle` 外，加一条**定时兜底**：每 30 s 扫一次，
对"有待观察素材但迟迟没被消费"的会话补一次观察；没有累积状态（热重载 / 首轮漏事件 / 坏回合）
时用 `sessionQuery.readSession` **从会话日志重建**最后一条真人输入 + 最后一条模型回复再观察。
同一会话同一轮只观察一次（按 `turn + lastReply` 指纹去重）。

- 新增 `src/host/observer/fallback.ts`：`rebuildTurnState(events)` 纯函数 +
  `class FallbackSweeper`（`start/stop/sweep`，注入 `now/observe/readSession/log`）。
- 改 `src/host/observer/trigger.ts`：把"是否可观察"判断抽成可复用纯函数（`skipReason` 导出），
  idle 分支改为"删状态前先记指纹"；启动 sweeper（`wireObserver` 里）。
- 改 `src/host/observer/turns.ts`：`TurnState` 增 `lastAssistantAt`（判断"多久没动"）、`observed` 指纹。
- 测试：`tests/host/observer-fallback.test.ts`（长回合兜底一次且不重复、日志重建首轮、
  坏回合无回复不建卡、开关关掉不跑）。
- 风险：重复观察 → 靠指纹 + `observer.enqueue` 串行；观察成本 → 只有"疑似漏看"的会话才补，最多每会话一次。
- 回滚：删 `startFallback` 调用；或 `Settings.fallbackObserve:false`。

### P0-3 卡片生命周期单一真源

**做什么**：定一张**唯一映射表**（`shared/case.ts`）：`deliveryState → 期望 status`；
所有 `deliveryState` 变更走 `kernel/transition.ts` 时**同一次 patch 里把 status 一起写**，
不再允许别处单独 patch `status` 来"补票"。再加一个**漂移修复**：启动/tick 时把
`status` 与映射不符的旧卡纠正并留事件（这正是事故里 `status=open, deliveryState=unknown` 的残留）。

- 改 `src/shared/case.ts`：`STATUS_FOR_DELIVERY` + `statusForDelivery(state)`；`transition()` 校验不变。
- 改 `src/host/kernel/transition.ts`：`applyTransition` 的 `changes` 里带 `status: statusForDelivery(to)`（非 idle 时）。
- 改 `src/host/verification/verifier.ts`：删掉单独的 `cards.patch({status:'done'})`（由 transition 统一写）。
- 改 `src/host/reconcile/reconcile.ts` + 新增 `src/host/kernel/drift.ts`：`repairDrift(cards, log)`。
  启动时跑一次（`index.ts`），`/reconcile` 也顺带跑。
- 改 `src/client/stage.ts`（或 `shared/state.ts`）：`effectiveStatus(card)` 供分组/关闭判断；
  `groupCards`、`CardRow` 的 `closed` 改用它，旧数据也不会误判。
- 改 `src/shared/state.ts`：`groupCards` 接受带 `deliveryState` 的卡，用同一映射。
- 契约：`docs/contracts.md` 的状态机表加"deliveryState 是执行真源、status 由它派生"一句。
- 测试：`tests/shared/lifecycle.test.ts`（映射穷举；unknown/failed/invalidated 的 status）、
  `tests/host/kernel.test.ts` 增"迁移后 status 同步"用例、`tests/host/drift.test.ts`（旧卡被纠正）。
- 风险：把"人工动作"（acknowledge/dismiss）与"执行状态"耦合。约束：映射只作用于
  `deliveryState !== 'idle'` 的卡；`idle` 卡仍由人管 status。
- 回滚：映射表置空即恢复旧行为（单点），旧卡不变。

### P1-1 多问题 ask_user_question 逐题作答

**做什么**：`/action answer` 接受 `answers: [{id, selected[]}]`；每题必须都有选择（缺一题 → 400
`INCOMPLETE_ANSWERS`）；投递文本按题拼接（`问题 → 选择`），仍走同一条 `answerQuestion`。
面板按 item 分组渲染、逐题选，一次提交。

- 契约：`AnswerSelectionSchema` + `Card.answers?: AnswerSelection[]`（`contract.ts`）；
  `docs/contracts.md` 的 `question` 行补一句。
- 改 `src/host/routes/action.ts`：解析 `body.answers`，校验、拼文本、落 `answers`。
- 改 `src/host/question/answer.ts`：多题时用 `answers` 构造 `userQuestions.answer` 负载，不再复制同一条文本。
- 改 `src/client/components/QuestionOptions.tsx`：逐题分组 + 本地选择 + 提交按钮；
  单题卡保持一键作答。
- 测试：`tests/host/answer-guard.test.ts` 或新增 `tests/host/question-answers.test.ts`（逐题负载）、
  `tests/client/panel.test.tsx`（逐题点选后提交的 payload）。
- 风险：宿主 `userQuestions.answer` 要求每题都有 id；缺 id 的旧卡退回单文本路径。
- 回滚：`answers` 缺省时完全走旧路径。

### P1-2 失败/过期卡自动对账（按产物存在性失效）

**做什么**：`CardDraft`/`Card` 增 `artifacts?: string[]`（可核验的产物路径）；观察者提示词要求
"失败/未完成结论必须给产物路径，否则降 info"。`reconcile` 增一条**确定性**判据：
open 且带 `artifacts` 的卡，若全部产物已存在 → `invalidated`，reason `artifacts-exist`，
保留证据与一键重开。`destructive/spend` 类卡不自动失效（设计 TODO-RECONCILE §5.5）。

- 契约：`CardDraftSchema.artifacts`、`CardSchema.artifacts`；`docs/contracts.md`。
- 改 `src/host/cards/store.ts`（create 落 `artifacts`）、`src/host/observer/extract.ts` 或
  `payload`→`observer.ts` 建卡处透传。
- 改 `src/host/reconcile/reconcile.ts`：`artifactsInvalidations()`（可注入 `exists` 便于测试）。
- 改 `src/host/cards/defaults.ts`：提示词加两条（失败要有产物路径；纯汇报降 info）。
- 测试：`tests/host/reconcile.test.ts` 增"产物存在 → 失效 / 不存在 → 不动 / destructive 不失效"。
- 风险：路径误判（相对路径）→ 以 `origin.sessionId` 的 cwd 为准，解析不到就跳过。
- 回滚：提示词不带 `artifacts` 时这条判据整体不触发。

### P1-3 卡片去噪（汇报类降 info / 合并）

**做什么**：落盘前加一道**确定性归一**：`decision` 卡若 `ask=clarification` 且没有
`question/candidates/action`（纯汇报），降为 `info`；同一会话 10 分钟内标题归一后相同、
kind 相同的卡**合并**（更新 detail/severity，写 `merged` 事件），不再新建。

- 新增 `src/host/observer/denoise.ts`（纯函数 `normalizeDraft` + `findMergeTarget`）。
- 改 `src/host/observer/observer.ts`：建卡前过一遍；记录 `cardsCreated` 按实际新建数。
- 测试：`tests/host/denoise.test.ts`（降级、合并、不同会话不合并、窗口外不合并）。
- 风险：合并会丢"两次独立事件"的语义 → 只在标题完全归一相同且 kind 相同时合并，保留 `merged` 事件与次数。
- 回滚：删两行调用即回旧行为，无需迁移。

## 3. 预算与验证

- 硬约束不变：单文件 ≤300 行、`index.ts/index.tsx` ≤150、函数 ≤60、客户端 bundle ≤150 KB、禁 `any`/`!`。
- 新模块一律 ≤150 行，逻辑进纯函数，宿主侧只做接线。
- 每项完成跑：`cd /vol1/1000/docker/dsh-dev && docker compose exec -T dsh bash -lc 'cd /workspace/nas-plugins/dsh-task-cards && pnpm verify'`。
- 完成顺序：P0-3（真源，先把地基收好）→ P0-1 → P0-2 → P1-1 → P1-2 → P1-3。
  理由：P0-1/P0-2 新产出的卡要靠 P0-3 的映射才在面板上正确分道；先收真源不会返工。
- 每项一份 verify 记录附在本文件 §4。

## 4. 实施记录（完成一项回填）

| 项 | 状态 | 改动文件 | verify |
| :-- | :-- | :-- | :-- |
| P0-3 | ✅ 完成 | `shared/case-contract.ts`（映射表 + `statusForDelivery`，zod-free）、`shared/case.ts`（re-export）、`shared/state.ts`（`effectiveStatus`/`isCardClosed`、分组排序）、`host/kernel/transition.ts`（同 patch 写 status；退回 idle 打开卡）、`host/kernel/drift.ts`（新增）、`host/kernel/assemble.ts`、`host/index.ts`、`host/verification/verifier.ts`（删掉重复写 status）、`host/scheduler/queue.ts`（候选不再用 status 判断关闭）、`host/routes/action.ts`（reopen 退回 idle）、client `CardRow`/`PanelHeader`/`SessionTab`/`ModalCardBlock`/`DetailSegments`、`docs/contracts.md`、tests 3 个文件 | `pnpm verify` 全绿：304 passed + 1 skipped，client bundle 123.1 KB |
| P0-1 | 待做 | — | — |
| P0-2 | 待做 | — | — |
| P1-1 | 待做 | — | — |
| P1-2 | 待做 | — | — |
| 闸门 E2E 收尾 | ✅ 完成 | `gate/classify.ts`（券身份改语义身份 = tool+effect+归一化 target，剔除 description/timeoutMs 等易变字段）、`gate/gate.ts`（global:true + effect 生成器注册 + dispatch 探针 + 诚实降级）、`gate/hooks.ts`（agent 作用域挂载/inspect/券/清理）、`gate/card.ts`（降级卡文案）、PolicyTab/locale（闸门覆盖范围）、`docs/host-abi.md`+`contracts.md`；tests：classify 语义身份、同 target 不同 description 只一张卡、approve 后重试放行一次、第三次再拦重开卡 | verify 绿：377 passed + 1 skipped，bundle 126.0 KB |
| P1-1 多问题逐题作答 | ✅ 完成 | `shared/contract.ts`（`AnswerSelection`/`Card.answers`）、`host/routes/answer.ts`（新增：逐题校验 `INCOMPLETE_ANSWERS` + 逐题拼文本）、`host/routes/action.ts`（拆薄）、`host/question/answer.ts`（结构化 answers 走原生通道）、client `QuestionOptions`（逐题分组/提交）、`api/useCards/usePanelActions/CardRow/WorkbenchTab/ModalCardBlock`（answers 透传）、locale/CSS；tests：approve 3 条 + panel 1 条 | verify 绿：369 passed + 1 skipped，bundle 125.0 KB |
| P1-2 产物对账 | ✅ 完成 | `shared/contract.ts`（`CardDraft.artifacts`/`Card.artifacts`）、`observer/create.ts`、`cards/store.ts`、`reconcile/reconcile.ts`（`artifacts-exist` 判据 + destructive/spend 豁免 + 可注入 exists）、`cards/defaults.ts`（提示词要求失败必带产物）；tests：reconcile 3 条 | verify 绿：372 passed + 1 skipped，bundle 125.0 KB |
| P1-3 去噪 | ⏳ 未做（按 Lead 安排留到下一轮） | — | — |
| P0-4 台账自证收口（task-3） | ✅ 完成 | 契约 `EvidenceRecord.level/sourceRef`、`Card.acceptance/planId/planNonce`；`routes/evidence.ts` 改为「按冻结 acceptance 收集」（拒绝外部 checks/cmd）；approve 冻结 `planId+nonce`；`routes/todo.ts` 绑定 planId（executor 禁止 done/freeze）；`verification/verify.ts` 强制 E2+ 才 confirmed；`register.ts` 计划/自证错误映射 403；contracts 同源更新 | verify 绿：389 passed + 1 skipped，bundle 126.0 KB，host entry 455.1 KB |
| P1-3 去噪 | ⏳ 未做（按 Lead 安排留到下一轮） | — | — |
| 闸门 E2E 收口（第五轮） | ✅ 通过（Lead 真机验收） | 券改「核销 + 5s 宽限」（`gate/allow.ts`，`graceMs` 可配）、`gate/judged.ts` 每执行只判一次（exec WeakMap + callId）、单实例 listener（`gate/hooks.ts` 全局注册槽）、放行日志带卡 id（`闸门放行（一次性券）… card=c-xxx`）、`docs/host-abi.md` 记录实测事实（同一 call 回调 4 次 / waterfall 与 guard exec 不同源 / agent 作用域派发）；tests：宽限、双路径、并发、语义身份、放行可见性 | **最终：384 passed + 1 skipped，bundle 126.0 KB，host entry 449.9 KB** |
| P0-1（审计 P0-1 回合内闸门） | ✅ 完成 | 新 `host/gate/{classify,card,gate}.ts`（分类器 19 条矩阵；guard/pre-execute/降级三条路径；一次性放行券）、`host-api.ts`（`tools.guard` 登记）、`contract.ts`（`Card.gate`）、`config-contract.ts`（`turnGate`/`receiptTimeoutMs`/`fallbackObserve`）、`wire.ts`/`index.ts`（`wireTurnGate`）、`routes/action.ts`（approve 发券/deny 清券）、`trigger.ts`（无钩子时降级建卡）、`kernel/boot.ts`（抽启动）；tests：`gate-classify.test.ts` 19 条 + `turn-gate.test.ts` 7 条；docs：`contracts.md` 闸门段 + `host-abi.md` 能力/降级表 | verify 绿：365 passed + 1 skipped，bundle 123.5 KB |
| P0-2（审计 P0-6 观察者兜底） | ✅ 完成 | `observer/provenance.ts`（`turnTriggerOf`/`isHeartbeat`：tool-jobs/card-answer/compact-checkpoint 都算触发，只有 time-context/runtime-context 不算）、`observer/turns.ts`（`hasTurnInput`→`hasTurnTrigger`、`lastEventAt`、`createTurnState`）、`observer/fallback.ts`（新增：30s 扫描 + 日志重建 + 指纹去重 + skipped 记录）、`observer/run.ts`（新增：触发/兜底共用构造器）、`observer/trigger.ts`（接线 + 跳过可见）、`config-contract.ts`（`fallbackObserve`、records `skipped`/`skipReason`）、`routes/records.ts`（skipped 并进记录屏）、`RecordsTab`/locale；tests：`observer-fallback.test.ts` 7 条 + kernel-routes skipped 可见 | verify 绿：339 passed + 1 skipped，bundle 123.5 KB |
| D1（审计 R4 laneOf） | ✅ 完成 | `shared/state.ts`（`laneOf` + 六车道分组 + `cardLane` 同口径）、`client/stage.ts`（`needsAttention`/`isSettled`/KPI/过滤全改读 laneOf）、`PanelHeader.tsx`、`CardActions.tsx`（失败/未知行内给「重开」、不再显示「已批准，执行中」）、`contracts.md` | verify 绿：329 passed + 1 skipped，bundle 123.7 KB |
| info/auto 过滤器（审计补充） | ✅ 完成 | `client/stage.ts`（新增 `notice` 过滤器 = info + auto 两条车道；`filterCounts` 同步）、`locale/workbench.ts`（通知/Notices）、`stage.test.ts`（notice 覆盖 + 七条过滤之和 = all） | verify 绿：365 passed + 1 skipped，bundle 123.7 KB |
| 小组头/小修（lead 反馈） | ✅ 完成 | 分组头「待处理」改 lane 口径（待决定+需关注）、`isCardClosed` 收成 `laneOf==='closed'`（失败不算结束）、`withFileLock` 用 resolve 后的路径 + >2s warning + contracts 写「锁只在单进程内有效」、records 屏 phase 文案 | 同上 |
| P0-5 残留（并发丢写） | ✅ 完成 | `cards/doc.ts` 进程级 per-file 异步锁（`globalThis[Symbol.for('dsh-task-cards.file-lock')]`），`mutate`/`write` 都排队；tests：双实例 15+15 并发、双实例 25+25 并发 patch | 同上 |
| A（审计 P0-5） | ✅ 完成 | `cards/doc.ts`（`mutate`/`#enqueue`/`#writeRaw`）、`cards/store.ts`（写全走 mutate、读 readFresh、RecordStore 拆到 `cards/records.ts`）、`cards/precedents.ts`；tests：三个 store 双实例回归 | verify 绿：311 passed + 1 skipped，bundle 123.1 KB |
| B（审计 P0-3 执行回执） | ✅ 完成 | 新 `shared/execution.ts`、`host/execution/{adapter,session,receipt}.ts`、`scheduler.ts`（派发只落 dispatched、记 `meta.turn`）、`kernel/{runtime,assemble}.ts`、`index.ts`（attach 回执）、`verification/{verify,verifier}.ts`（删 decision 特判、回执即凭据）、`docs/contracts.md`；tests：`receipt.test.ts` 7 条 + verification 3 条 | verify 绿：320 passed + 1 skipped，host entry 401.3 KB |
| C（审计 P0-2 幂等） | ✅ 完成 | `routes/action.ts::assertApprovable`（status 已结束或 ds≠idle 一律 400）、`scheduler.ts`（`idempotencyKeyOf` + 派发前查重）、`docs/contracts.md`（幂等闸门/幂等键）；tests：unknown/invalidated approve 400、同键只派一次；另做 host-abi 门禁能力登记、waiting⇒done 契约注释、`verify.ts` 零证据不得 confirmed | verify 绿：324 passed + 1 skipped，bundle 123.1 KB |

## 5. 与审计报告的对应

审计报告落地后在此回填每条问题编号 → 本计划条目；审计新增的 P0 优先插入，审计与本文冲突时以审计为准。
