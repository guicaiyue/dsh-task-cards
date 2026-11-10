# 审计跟进（2026-11-10）：P0-5 / P0-3 / P0-2 复核 + 干净快照 verify + 未覆盖项对账

> 审计员：card-analyst（只读）。本文件是本轮唯一可写文件。
> 主报告：`2026-11-10-audit.md`（编号沿用主报告的 P0-x / P1-x）。
> 优化计划：`2026-11-10-optimization-plan.md`（简称 OPT，编号 OPT-P0-x / OPT-P1-x）。
> 触发：Lead 重排顺序后的复审计。**本文件 §1/§2 必须等优化员完成指定项后回填**，未回填前的状态一律标「待复核」。

## 0. 状态与快照

| 项 | 值 |
| :-- | :-- |
| 本轮复核对象 | P0-5（cards/precedents 覆盖写）、P0-3（执行回执，含「不做事也不判通过」）、P0-2（批准幂等 + 幂等键） |
| 已声明完成（待复核） | OPT-P0-3「生命周期单一真源」= 主报告 P0-7；`pnpm verify` 自述 304 passed + 1 skipped、bundle 123.1 KB（09:36） |
| 复核基线 | 以优化员声明「三项完成」后的工作区快照为准；每次复核记录 `git status --porcelain | wc -l` 与关键文件 mtime，避免中间态误判 |
| 拍板 | **D1 已拍板（09:40）**，落地口径与三条硬约束见 §1.5；其余待拍板项见 §4 |
| 观测 | 09:40：优化员已在改 `cards/store.ts`、`cards/doc.ts`（P0-5 mutate/readFresh）+ 新增 `tests/host/lifecycle.test.ts` |
| 干净快照口径 | `src/**` mtime ≥2 分钟无变化 + 跑 `pnpm verify` 前后 `git status --porcelain` 的条目集合一致；否则重跑并在 §2 注明 |

## 1. 三项复核的判据（固定检查点；**结论见 §1bis**）

复核方法固定为三件事：**代码结构判据 → 其自带回归用例 → 我独立验证**（只读脚本/数据重放/日志）。判定取值：真修好 / 半修 / 没修 / 无法判定。

### 1.1 P0-5 cards.json & precedents.json 覆盖写（双实例不丢条目）

| 检查点 | 判据 | 证据位置 | 实测 | 判定 |
| :-- | :-- | :-- | :-- | :-- |
| 写路径统一 | `Store.create/patch/markSeen/remove`、`PrecedentStore.add/update` 是否都经「先 readFresh 再写」的单一入口（`JsonDoc.mutate` 或等价） | `src/host/cards/store.ts`、`src/host/cards/precedents.ts`、`src/host/cards/doc.ts` | 待回填 | 待回填 |
| 无旁路 | 是否还有 `#doc.write(` 直调 / `#cards()` 缓存直写 | 同上 | 待回填 | 待回填 |
| 回归用例 | 是否新增「双实例交错写不丢条目」用例（照 05 §6 形状：A 建 → B 建 → A patch → 断言 B 的条目在） | `tests/host/store.test.ts` 等 | 待回填 | 待回填 |
| 我的独立验证 | 用只读脚本在临时目录建两个 Store 实例，交错 create/patch，断言条目不丢 | `/tmp/dtc-followup-*.ts`（仓库外） | 待回填 | 待回填 |

### 1.2 P0-3 执行回执（验收不得在做事之前通过）

| 检查点 | 判据 | 证据位置 | 实测 | 判定 |
| :-- | :-- | :-- | :-- | :-- |
| adapter 语义 | `execute()` 返回值是否从「已投递」改为「已受理」（`accepted`）+ 回执等待路径；不允许 `dispatched→executed` 在同一个 tick 内靠投递成功完成 | `src/host/execution/adapter.ts`、`session.ts`、`src/host/scheduler/scheduler.ts` | 待回填 | 待回填 |
| 回执来源 | `executed` 是否由 origin 会话回合结束（`agent/status=idle` + turn 号/trace 关联）推进，并落 `ExecutionResult`（含 turn/evidence/duration） | `scheduler.ts`、`transition.ts`、契约 | 待回填 | 待回填 |
| 不做不通过 | 决策卡「无条件 confirmed」补丁是否**已删除**；`confirmed` 是否要求 E2 级证据（回执/checker），纯 E0 不得 confirmed | `src/host/verification/verify.ts`、`verifier.ts` | 待回填 | 待回填 |
| 清单零证据 | 清单全绿但零证据是否不再 confirmed（P1-2） | `verify.ts::confirmedOutcome`、`todo/store.ts` | 待回填 | 待回填 |
| dispatched 回收 | `dispatched` 是否有 TTL/超时 → `unknown`，且重启后能回收（P1-3） | `scheduler/admission.ts`、`scheduler.ts` | 待回填 | 待回填 |
| 回执判定（D1-R1） | `executed` 仅当回执满足 `origin 会话在派发之后起了一轮并结束` 且 `receipt.turn > dispatchTurn`；不存在「投递即 executed」 | `execution/adapter.ts`、`scheduler.ts`、契约 `ExecutionResult.receipt` | 待回填 | 待回填 |
| 决策卡通过（D1-R2） | `kind==='decision'` 的 confirmed = 回执 + 本轮最终回复非空（`replyChars>0`）；**不**要求 E2 产物；`verify.ts` 里旧的 `kind==='decision'` 无条件 confirmed 段必须不存在 | `src/host/verification/verify.ts` | 待回填 | 待回填 |
| 无回执处置（D1-R3） | TTL 内无回执 → `failed`，reason 含 `no-receipt`；卡进「需关注」/记录页，**不再落 `ask=judgment`、不生成新的「要我决策」卡**；人手动 reopen 后才回决策车道 | `scheduler.ts`、`verifier.ts`、`routes/action.ts` | 待回填 | 待回填 |
| 空回复/报错（D1-R4） | 回执存在但最终回复为空、或带错误前缀（`运行失败` 等）→ `failed` + 通知；**不得**进「已结束」 | `verify.ts`、`client/stage.ts::isSettled` | 待回填 | 待回填 |
| 我的独立验证 | 假 adapter 只受理不执行 → 断言 `dispatched` 且不验收；喂 idle+turn+1 → `executed→verifying`；再喂一次不同步；超时 → `unknown` | 只读运行其测试 + 代码走查 | 待回填 | 待回填 |

### 1.3 P0-2 批准幂等 + 投递幂等键

| 检查点 | 判据 | 证据位置 | 实测 | 判定 |
| :-- | :-- | :-- | :-- | :-- |
| 闸门覆盖 | `unknown/failed/invalidated/closed(status)` 的卡再 approve 是否一律 400 `ALREADY_APPROVED`（重批必须显式 reopen） | `src/host/routes/action.ts::assertApprovable` | 待回填 | 待回填 |
| 幂等键 | 是否引入 `idempotencyKey = cardId+decisionSeq`（或等价）并在 dispatch 前落盘校验唯一；重复 tick 只派一次 | `scheduler.ts`、`kernel/journal.ts`、契约 | 待回填 | 待回填 |
| 回归用例 | 是否新增 approve→unknown→approve 断言 400；同 key 两次 dispatch 计数 1 | `tests/host/kernel-routes.test.ts` 等 | 待回填 | 待回填 |
| 我的独立验证 | 用真实 journal 形状（`c-mw958ol4-3gtes.jsonl` 的两轮循环）重放断言第二段不再成立 | 只读脚本/数据重放 | 待回填 | 待回填 |

### 1.4 附带复核：P0-7「生命周期单一真源」（优化员已声明完成）

| 检查点 | 判据 | 实测 | 判定 |
| :-- | :-- | :-- | :-- |
| 映射唯一 | `statusForDelivery(state)` 是唯一映射；`transition` 同 patch 写 status；不存在第三处 status 直写 | 待回填 | 待回填 |
| 派生只读 | 面板分组/关闭判断改读 `effectiveStatus/isCardClosed`，不再各自读 `status` | 待回填 | 待回填 |
| 反向约束 | `to==='waiting'` 且 status 已关闭时不会静默共存（主报告 §3.4(1)） | 待回填 | 待回填 |
| 旧数据漂移 | `kernel/drift.ts` 是否启动/tick 修复旧卡并写事件（真实数据有 12 张矛盾卡可验） | 待回填 | 待回填 |

### 1.5 Lead 拍板 D1 的落地口径（2026-11-10 09:40，直接可测）

拍板内容（原文四条的工程化表述，验收以此为准）：

1. **`executed` = 回执**：origin 会话在派发之后确实起了一轮并结束（`receipt.turn > dispatchTurn`）。「投递成功」只能留在 `dispatched`。
2. **`confirmed`（决策卡）= 回执 + 本轮最终回复非空**（`replyChars > 0`）。**不要求 E2 产物**——决策卡没有可验收的产物，硬要证据只会逼人造假。
3. **无回执（TTL 内会话没继续/报错）→ `failed`**，reason `no-receipt`；进「需关注」+ 记录页，**不再生成新的「要我决策」卡**；人手动 `reopen` + 重新批准才回决策车道。
4. **回执存在但回复为空 / 明显报错（错误前缀、`运行失败`）→ `failed` + 通知**，**不进「已结束」**。

对应到现有代码必须动的三处（给优化员的硬约束）：

| # | 现状（冲突点） | 必须改成 |
| :-- | :-- | :-- |
| R-lane-1 | `client/stage.ts:102-111` 的 `isSettled` 把 `failed/unknown` 当「已关闭」→ 失败卡会进「已关闭」过滤，违反规则 4 | `isSettled` 只认 `confirmed/invalidated` 或人关（`done/dismissed`）；`failed/unknown` 归「需关注」 |
| R-lane-2 | failed 卡没有「第三车道」：`status='open'` 会落回「要我决策」（违反规则 3），status 置关闭又违反规则 4 | **Lead 二次拍板（不采纳改 kind）**：在 `shared/state.ts` 增派生车道 `laneOf(card)`（与 `effectiveStatus` 同层）：`isCardClosed` → 已结束；`deliveryState ∈ {failed, unknown}` → **需关注**；否则按 kind 归 待决策/待知晓/自动处理。面板分组与 KPI 全部改读 `laneOf`；行内动作（重试/重开/作废）只改 `deliveryState` 或走 reopen，**不碰 kind**；**不新增 `CARD_STATUSES`、不迁移** |
| R-lane-3 | 「不再生成新的要我决策卡」需要判定：失败后禁止再用同一 `decisionSeq` 开新卡 | 失败只写 `failed` 事件 + 通知；`reopen` 显式把卡退回 `idle` 并**清掉 authority**，之后必须重新走 approve（不允许自动重排） |

可写成测试（三条，缺一不可）：

- fake adapter 只接受不执行 → tick 后断言 `deliveryState==='dispatched'`、**未**进 `verifying`；喂 `agent/status=idle`（turn=派发 turn）→ 仍不进 executed（回执太早，不算）；
- 决策卡无回执 → 断言 `failed` + `reason` 含 `no-receipt` + 卡片不出现在决策车道 + 记录页有该事件；有回执但 `replyChars===0` → 断言 `failed`；
- `verify.ts` 中 `kind === 'decision'` 的无条件 confirmed 分支被删除（grep 断言的代码级检查 + `tests/host/verification.test.ts` 用例改名/重写）；
- **车道派生（Lead 二次拍板）**：`isSettled(failed) === false`、`isSettled(unknown) === false`；`laneOf(failed/unknown) === 'attention'`；同一张 failed 卡在面板 KPI+过滤里**只算一次且只出现在「需关注」**（不在待决策、不在已结束）；行内动作只改 `deliveryState` 或走 reopen（断言 `kind` 不变）。

## 1bis. 复核结果（2026-11-10 09:53 快照）

> 快照：`git status --porcelain | wc -l` = **115**；关键文件 mtime：`execution/receipt.ts` 09:49、`verification/verify.ts` 09:45、`verifier.ts` 09:48、`scheduler.ts` 09:50、`routes/action.ts` 09:50、`cards/{doc,store,precedents,records}.ts` 09:40–09:42。
> 证据等级：**代码结构 + 其自带用例（我实跑）+ 我的独立探针**（探针在 `/tmp`，不在仓库）。

### 1bis.1 P0-5 cards / precedents 覆盖写 → **半修（顺序式真修好，同 tick 并发仍会丢）**

| 检查点 | 结论 | 证据 |
| :-- | :-- | :-- |
| 写路径统一 | ✅ | `doc.ts:96-102` 新增 `mutate()`（enqueue 内先 `readFresh()` 再 `#writeRaw`）；`store.ts:143/168/178/196`、`precedents.ts:69/82`、`records.ts:40` 全部改走 mutate；`store.ts:100` 的 `#cards()` 读也改 readFresh |
| 无旁路 | ✅（除配置） | 残留只有 `SettingsStore.set` 仍 `get()`+`#doc.write`（`store.ts:249`）——单对象配置、非追加型，影响小，记为 P2 |
| 回归用例 | ✅ | `store.test.ts:100`（双实例交错 patch 不吃卡）、`:114`（并发 50 patch 条目不变）、`:126`（并发 20 create 不丢）、`precedent-store.test.ts:77`（判例同构）；我实跑 7 个相关测试文件 **68 passed** |
| 我的独立探针 | ⚠️ | 顺序交错：2/2 保留 ✅；**两实例同 tick 各并发 15 个 create → 只落 15 张（丢 15）** ❌ |
| 判定 | **半修** | `readFresh` 把「缓存整份覆盖」（必丢）收窄成「read→write 窗口内并发才丢」（实测仍丢一半）。真实 HMR 事故形状（旧实例稍后写）已修复；真并发仍无锁保护 |

建议（给优化员，二选一）：① **单写者纪律**（最便宜）：HMR 卸载时把旧实例 `disposed=true`，所有写方法直接抛错，配合 P2-f 的 disposer 修复；② 文件锁/写入后 mtime 校验重试。验收：我的探针那类用例（两实例并发 30 写）必须 30/30。

### 1bis.2 P0-3 执行回执（含「不做事也不判通过」）→ **真修好（D1-R1/R2/R3/R4 全落地）**

| D1 规则 | 结论 | 证据 |
| :-- | :-- | :-- |
| R1 「投递即 executed」消失 | ✅ | `execution/adapter.ts` 返回 `accepted`（不再是 ok=executed）；`scheduler.ts:94-133` 派发成功后只落 `dispatched` + `meta.{via,turn,idempotencyKey}`，**不做** executed/verify；用例 `scheduler.test.ts:155`「派发成功只落 dispatched：不落 executed、不触发验收」（fake adapter 只接受不执行）；我实跑通过 |
| R1 回执由 origin 会话推进 | ✅ | `execution/receipt.ts`：`ReceiptTracker`（pending/turns 走 `globalThis[Symbol]` 跨 HMR；`attach` 订阅 `session/event`/`agent/status`/`agent/error`；`restore()` 从 journal `dispatched.meta.turn` 找回；15s sweep/180s TTL）；`verifier.ts:41-47` 从 `executed.meta.execution` 读回 ExecutionResult；`shared/execution.ts:27-35 hasReceipt` |
| R2 决策卡 confirmed = 回执 + 回复非空 | ✅ | `verify.ts:57-67`：无清单/无证据时**唯一** confirmed 通道是 `hasReceipt`；`verification.test.ts:112`；我的独立探针：有效回执(4>3, 42 字)→confirmed ✅ |
| R2 不要求 E2 产物（决策卡） | ✅ | 同上，`reason` 写「回执已到：第 N 回合已结束（回复 M 字）」 |
| R3 无回执 TTL → failed/no-receipt + 需关注 | ✅（车道见 ⚠️） | `receipt.ts #fail`：`to:'failed'`、`waitReason:'awaiting-user-escalation'`、`lastError`；`receipt.test.ts:145`；**不创建任何新卡**（`grep cards.create receipt.ts` = 0）→ 「不生成新的要我决策卡」成立；但卡片本身归哪个车道取决于 `laneOf`（未落地，见下） |
| R4 空回复 / 报错 → failed，不冒充完成 | ✅（车道见 ⚠️） | `receipt.test.ts:157`（empty-reply）、`:168`（receipt-error）；`verification.test.ts:136`（回执回合回复为空不算回执） |
| 补丁已删 | ✅ | `grep -n decision src/host/verification/verify.ts` → **无命中**（exit 1），旧的 `kind==='decision'` 无条件 confirmed 分支不存在 |
| 幂等 | ✅ | `receipt.test.ts:121` 两次 idle 不重复验收；`:134` turn 未前进的 idle 不算回执；`:178` 重启从 journal 恢复在飞回执 |
| **DTC_VERIFY=off 时 dispatched 仍能回收**（Lead 补充问） | ✅ | `assemble.ts:42-48` `ReceiptTracker` **无条件创建**（`verify` 只在 `verifyEnabled()` 时注入）；`index.ts` 在 `kernelEnabled()` 分支里 `attach(root)` → `DTC_KERNEL=on + DTC_VERIFY=off` 时 tracker 照常 sweep，180s 后 `failed/no-receipt`（走 `#fail`，不需要 verify）→ **不再永久卡死** |
| 我的独立探针 | ✅ | 5 例全过：无回执→unknown；同回合回执→unknown；回执但回复空→unknown；有效回执→confirmed；「清单全绿零证据」→**仍 confirmed（P1-2 未修，见 §3）** |
| 判定 | **真修好**（D1 四条均落地） | 残留 3 条 P2：① `#fail` 的 `lastError` 固定前缀 `no-receipt:`，empty-reply/receipt-error 时措辞不准；② TTL 180s 硬编码未进 Settings；③ confirmed 前不校验 `todo` 零证据（P1-2，待排期） |

### 1bis.3 P0-2 批准幂等 + 投递幂等键 → **初步：代码+用例已具备（等 C 官方完成信号后定稿）**

| 检查点 | 结论 | 证据 |
| :-- | :-- | :-- |
| 闸门覆盖 | ✅ | `routes/action.ts:197-200`：`isCardClosed(card) || deliveryState !== 'idle'` → 400 `ALREADY_APPROVED`；覆盖 unknown/failed/invalidated/closed |
| reopen 重置 | ✅ | `action.ts:56-57` + `reopenCard()`：非 idle 走 `canTransition(from,'idle','user')` + `kernel.apply(to idle, expectedSeq CAS)`；用例 `kernel-routes.test.ts:186`「重开→idle→status open→还能再批」 |
| 幂等键 | ✅ | `scheduler.ts:44-50 idempotencyKeyOf(cardId, waitingEventId)`（用**最后一次 waiting 事件 id**，不用 decisionSeq，避免「恢复到 waiting 变新键」）；dispatch 前 `#alreadyDispatched` 查 journal，`dispatched.meta.idempotencyKey` 落盘；用例 `scheduler.test.ts:183`「同一幂等键只派一次」 |
| 事故 2 形状回归 | ✅ | `kernel-routes.test.ts:203`「已落 unknown 的卡再批准 → 400」、`:214`「invalidated → 400」；我实跑 kernel-routes 10 passed |
| 残留（P2） | ⚠️ | `#alreadyDispatched` 命中时只 `log` 然后 `return`，卡会停在 `waiting` **无 waitReason/事件** → 又一条静默死路；建议改成 `noteCase('已派发过，状态待修')` 或直接落 `unknown` 并写事件 |

### 1bis.4 附带：P0-7 生命周期单一真源 → **代码已落地，但 D1 车道收口未完成**

| 检查点 | 结论 | 证据 |
| :-- | :-- | :-- |
| 映射唯一 | ✅ | `case-contract.ts:67-83` `STATUS_FOR_DELIVERY` + `statusForDelivery`；`transition.ts` 同 patch 写 status；`verifier.ts:83-86` 已删掉单独 `patch({status:'done'})` |
| 派生只读（host/组件） | ✅ | `state.ts:26-33 effectiveStatus/isCardClosed`；`CardRow/SessionTab/PanelHeader/ModalCardBlock/DetailSegments` 已改读 `isCardClosed` |
| 漂移修复 | ✅ | 新增 `kernel/drift.ts`，启动 + `/reconcile` 跑 `repairLifecycleDrift`（`index.ts`、`assemble.ts:64-68`）；用例 `lifecycle.test.ts:72`（open+unknown → done） |
| **D1 车道口径** | ❌ 未落地 | `statusForDelivery` 把 `waiting/leased/dispatched/executed/verifying/failed/unknown` **全部映射成 `done`** → `isCardClosed=true`：① failed/unknown 被面板当「已结束」（违反 D1-R4）；② 执行中卡也算「已结束」，`client/stage.ts::isSettled`（仍是 01:02 旧版）会把它们放进「已关闭」过滤；③ **`laneOf` 在全仓库零命中**（Lead 09:43 拍板的派生车道还没做）。这是 D1 收口的**唯一阻塞项**，必须做 |
| 判定 | 半修 | 映射+漂移是干净的地基；`laneOf` + `stage.ts`（isSettled/kpiOf/filterCards）收口后才能满足 R3/R4 |

### 1bis.5 P0-5 互斥锁复验（Lead 指定「30 张」探针）→ **真修好**

| 检查点 | 结论 | 证据 |
| :-- | :-- | :-- |
| 进程级 per-file 互斥 | ✅ | `cards/doc.ts:83-104`：`write()`/`mutate()` 都在 `#enqueue` 之后再进 `withFileLock(file, …)`；`:127-158` 用 `globalThis[Symbol.for('dsh-task-cards.file-lock')]` 存 per-file promise 链（跨 HMR 实例共享），`finally` 只在 tail 匹配时删 key |
| 我的探针（复跑） | ✅ | 两实例同 tick 各并发 15 个 `create` → **30/30**（修前同探针 15/30，丢一半）；顺序交错 2/2 |
| 其自带用例 | ✅ | `store.test.ts:125`「双实例并发 patch 同一条卡：不丢卡、不丢条目」（25+25 并发）、`:143` 并发 50 patch、`:155` 并发 20 create |
| 判定 | **真修好**（进程内） | 残留是 3 条边界（见 1bis.8）：跨进程不加锁（注释已声明单进程前提）、锁 key 用原始路径字符串、锁等待无超时/日志 |

### 1bis.6 D1 车道收口复核（`laneOf` 六车道）→ **真修好**（2 条 P2 一致性残留）

| 检查点 | 结论 | 证据 |
| :-- | :-- | :-- |
| `laneOf` 在共享层且六车道 | ✅ | `shared/state.ts:76-95`：`CardLane = closed｜attention｜running｜decision｜info｜auto`；判定顺序 failed/unknown→attention 先于 isClosed；confirmed/invalidated→closed；waiting/leased/dispatched/executed/verifying→running；idle 时按 status/kind |
| 面板全部改读 laneOf | ✅ | `client/stage.ts:75-155`：`kpiOf`/`filterCards`/`filterCounts`/`isSettled`/`needsAttention` 全走 `laneOf`；`CardActions.tsx:74`（attention 主操作=重开）、`:185-193`（`closed && !attention ? null : PrimaryAction`，保证需关注卡有行内动作） |
| 同一张卡只进一个 filter（我构造 10 张覆盖 6 车道） | ✅ | 探针输出每张卡 ≤1 个过滤器：decision→pending、waiting/dispatched→running、verifying→verifying、failed/unknown→attention、confirmed/invalidated→closed |
| `running` 不计入 attention KPI | ✅ | 探针 `kpi = {pending:1, delegated:0, running:1, verifying:1, attention:2}`——attention 只有 failed+unknown；dispatched/verifying/waiting 均不计入 |
| failed/unknown 行内：有重开、无批准、无 in-flight chip | ✅ | `CardActions.tsx:55-66` `AttentionPrimary`（reopen）+ 主操作短路；`panel.test.tsx:292`「失败卡行内给「重开」，不再显示「已批准，执行中」chip、也没有「批准」」实跑通过；我实跑 `panel/stage/state-order/lifecycle` 4 文件 **28 passed** |
| P2-a：info/auto 无过滤器 | ⚠️ | 探针：`不在任何过滤器里的卡 = info,auto`；`filterCounts all=10` 而五个过滤器合计 8。通知卡/自动卡只能从「全部」看到（侧栏未读圆点仍在）。建议：pending 展示口径并入 info/auto，或加「通知」过滤器，并写进 contracts.md |
| P2-b：`isCardClosed` 与 laneOf 语义不一致 | ⚠️ | `shared/state.ts::isCardClosed(failed)` 仍为 `true`（status 派生），而 `laneOf(failed)='attention'`。面板已绕过（CardActions 特判），但新代码拿 `isCardClosed` 判「已结束」仍会误判。建议 `isCardClosed = laneOf(card)==='closed'`，或加注释禁止直接用于 failed/unknown |
| 判定 | **真修好** | D1-R3/R4 的车道要求已满足；两条 P2 是一致性/可发现性收尾 |

### 1bis.7 D（contracts.md）→ **已落地**

`docs/contracts.md:56`（需关注唯一口径 = failed/unknown + waitReason 非空，invalidated 不算）、`:58`（批准幂等：status 已结束或 deliveryState≠idle → 400）、`:62`（status 是 deliveryState 派生 + `STATUS_FOR_DELIVERY` 单一映射 + drift 纠正）、`:84`（no-receipt/receipt-error/empty-reply → failed + awaiting-user-escalation + 不新建待决策卡）。与主报告 §3.2 的 W1–W10 一一对应，可作为后续契约变更的写入口径。

### 1bis.8 新引入的静默路径审查（Lead 指定第 4 点）

| 位置 | 是否新增静默 | 说明 / 建议 |
| :-- | :-- | :-- |
| `doc.ts::withFileLock` | ⚠️ 轻度 | 等待**无超时、无日志**：某次写卡住时，同文件后续写会静默排队（不报错、面板也看不出）。建议：等待 >2s 打一条 log（含等待者数量），或加队列深度指标 |
| `doc.ts` 锁 key | ⚠️ 边界 | 用 `file` 原始字符串做 key；相对路径/软链/大小写不同写法会绕过同一把锁。建议 `path.resolve(file)` 归一化 |
| 跨进程 | 边界（已声明） | 注释写明「跨进程不加锁（本机单实例插件，够用）」；若两个 dsh 进程共享同一 `DSH_HOME` 会退化。建议在 contracts.md 写明单进程前提 |
| `scheduler #alreadyDispatched` | ⚠️（已知，已转优化员） | 命中只 `log` 然后 return，卡停在 waiting 无 waitReason/事件 |
| `receipt #succeed` 的「回执丢弃」 | ✅ 无风险 | 仅当卡已不在 dispatched 才丢弃，不会制造假死；sweep 的 busy 保护与 attach 失败 catch 都在 |
| `receipt #fail` catch / `resolve` | ✅ | 失败落账异常有 log；pending 不会无限增长（resolve/sweep 都会删） |

### 1bis.9 P0-6 观察者兜底复核（事故 4/5）→ **真修好**（1 条固有限制）

| 检查点 | 结论 | 证据 |
| :-- | :-- | :-- |
| 「什么算一轮」扩了 | ✅ | `provenance.ts:46-52` `TurnTrigger` + `turnTriggerOf`；`turns.ts:73-75` 用 `hasTurnTrigger/lastTrigger` 替代 `hasUserInput`；我的探针：`human`/`tool-jobs`/`compact-checkpoint`/`card-answer` 都算触发，`time-context` 不算（只剩心跳的回合 `rebuildTurnState→null`），只有 assistant 无触发 → null |
| 跳过日志措辞与代码一致 | ✅ | `trigger.ts::skipReason`：`没有累积状态` / `没有轮次触发器` / `没有最终回复`；`kernel-routes.test.ts:230` 断言 `/records` 里 reason 含「没有轮次触发器」 |
| 30s 兜底 + 120s 无动静 + 指纹去重 | ✅ | `fallback.ts:16-20`（`FALLBACK_IDLE_MS=120_000`、`INTERVAL_MS=30_000`、`PENDING_SETTLE_MS=2_000`、`MAX_ATTEMPTS=2`）；`shouldSweep` 探针：事件后 10min → true，后 30s → false；`#seen` 指纹（turn+回复长度+尾 24 字）同轮只补一次（探针：两次 sweep 只 observe 一次） |
| 跨热重载不丢 | ✅ | `fallback.ts:23-24` 的 `SEEN_KEY`/`PENDING_KEY` 都挂 `globalThis[Symbol.for]`，与 tracker/receipt 同法；`trigger.ts:105` 有 `root.effect` 停 timer |
| 跳过可见 | ✅ | `fallback.ts::noteSkip` 写 `records.status='skipped'` + `skipReason`；`config-contract.ts:52-53,68` 加枚举与字段；`routes/records.ts` 把 skipped 并进记录屏（phase=observe）；`kernel-routes.test.ts:230` 覆盖；我的探针：records.json 落 1 条 `{status:'skipped', reason:'没有轮次触发器'}` |
| 开关关闭回旧行为 | ✅ | `fallback.ts::#enabled` = `settings.enabled && settings.fallbackObserve`（默认 true，`config-contract.ts:29`）；探针：关掉后 `sweep()=[]` 且不写跳过记录；用例 `observer-fallback.test.ts:119` |
| 事故 4/5 形状独立探针 | ✅ | ① tracker 只有「无触发器的残缺状态」（模拟 user/message 漏掉）→ noteSkip 写 records → sweep 用 `readSession` 重建 → 补观察 1 次、tracker 清空、二次 sweep 不重复；② 只有 time-context 的回合 → skipped 记录 |
| 固有限制 | ⚠️ | `rebuildTurnState` 只能从会话日志重建**最新一轮**；像 turn 15 那种「已经翻篇到 18」的历史轮次补不回来（只能防以后同类漏失）。建议下一轮加「按 turn 游标逐轮补」或至少在接受这一限制的前提下把 turn 15/16/17 这类缺口写进运营说明 |

### 1bis.10 三条小修复核（Lead 指定）

| 检查点 | 结论 | 证据 |
| :-- | :-- | :-- |
| 分组头「待处理」= decision+attention | ✅ | `WorkbenchTab.tsx:171-177` 改为 `laneOf(card)==='decision' || 'attention'`；我的探针：8 张混合卡 → `groupPending=4`，`kpi.pending+delegated+attention=1+1+2=4`，同一 `laneOf` 源 |
| `isCardClosed(failed) === false` | ✅ | `shared/state.ts:36-38` 改为 `laneOf(card)==='closed'`；探针：failed/unknown → false，confirmed → true |
| `withFileLock` path.resolve + 慢锁日志 + 单进程文档 | ✅ | `doc.ts:144,148`（`LOCK_WARN_MS=2000`、`path.resolve(file)` 做 key）、`:158-160` `console.warn` 慢锁；`docs/contracts.md:56` 写明「锁只在单进程内有效 / 多进程需换跨进程锁 / 等待 >2s 打 warning」 |
| 附：`/records` 并进 skipped | ✅ | `routes/records.ts` 合并 `records.json` 里 `status='skipped'`，`caseId=originSessionId`、`phase='observe'` |

## 2. 干净快照 verify（已回填）

**快照条件**：`find src tests -newermt '-2 minutes' | wc -l === 0`（src/tests 至少 2 分钟无改动）；快照计数 `git status --porcelain | wc -l` = **131**（含闸门进行中的 `host/gate/*` 与 `turn-gate.test.ts`，按 Lead 指示不审闸门规则）；验证后再次采样仍是 131，且验证后 2 分钟仍无文件改动。

**结果：`pnpm verify` 全绿**（verify = `lint && typecheck && test && build && test:abi && budget`，最后一步「代码预算通过」到达即前面全过）：

| 指标 | 值 |
| :-- | :-- |
| 执行时间 | 2026-11-10 10:22:25–10:22:33（Asia/Shanghai） |
| Test Files | **50 passed + 1 skipped（51）** |
| Tests | **365 passed + 1 skipped（366）** |
| client bundle | **123.7 KB**（预算 150 KB；tsdown 原始 126.66 kB / gzip 34.03 kB） |
| host entry | 434.5 KB（lib/index.js，无预算约束） |
| lint / typecheck / build / ABI / 代码预算 | 全过（「ABI 检查通过」「代码预算通过」） |
| 跑前/跑后 diff 数 | 131 / 131（一致） |

**一次需要记录的复现性事故（不是回归）**：同一快照在 10:23:06 由我再跑一次时，出现 2 个 `Test timed out in 5000ms`（`store.test.ts`「坏文件被挪走…」、`precedent-store.test.ts`「上限 500 条…」），且该次只跑了 unit 项目（38 文件，client 项目未执行）。**隔离重跑这两个文件：23 passed（87ms / 482ms），无断言失败** → 判定为同容器内并发构建/测试造成的资源竞争导致的默认 5s 超时，不是逻辑回归。建议收口验收时**单跑一次**并在 CI 里把 `testTimeout` 提到 10s 或串行跑集成类用例。

## 3. 未覆盖项合并 triage（优化员计划 P1 × 主报告 P1/P2）

口径：**必改 = 确定性修复，不需要产品判断，优化员直接排期**；**拍板 = 需要 Lead 先给口径再动手**；**M4 = 本轮不做，写进 backlog**。

| ID | 内容 | 归属 | 依赖 | 验收判据（可测） |
| :-- | :-- | :-- | :-- | :-- |
| P1-1 | 决策卡「无条件 confirmed」白名单（主报告 P1-1 / Lead 已要求回执落地后删除） | 必改（已拍板，口径见 §1.5） | P0-3 回执 | 无回执 → `failed/no-receipt` 且不进决策车道；有回执且 `replyChars>0` → confirmed（不需 E2）；空回复/报错 → `failed` 且不进已结束；`verify.ts` 白名单分支已删 |
| P1-2 | 清单全绿零证据也 confirmed；`done-unverified` 是空操作；`skipped` 计入完成率 | 必改 | 无 | 全绿无证据 → failed/unknown；`done-unverified` 不得 confirmed；skipped 不计入分子 |
| P1-3 | `dispatched` 无超时回收 → 同会话 WIP=1 死锁 | 必改 | P0-3 回执 | 无回执超 TTL → `unknown` 并写事件；重启后回收；同会话下一张能被派 |
| P1-4 | 票拟自动执行绕过内核（无事件/无验收/无 CAS） | 必改 | P0-3 回执 | 自动执行后 journal 有事件、ds 前进、验收被触发、`authority=delegated` |
| P1-5 | Todo 从不注入会话 → B 类分流与清单驱动验收是死代码 | 拍板（是否插件自动生成 baseline）+ 必改（实现） | 拍板 | 派发后 todo 存在且未冻结；执行者更新后冻结；无清单时验收路径明确（manual/unknown） |
| P1-6 | `records.json` 缺 caseId/traceId（记录屏跳不到卡/trace） | 必改 | 无 | 一条 observer/decision 记录带 caseId+traceId；`/records` 可按 traceId 命中（UI-UX U2） |
| P1-7 | 建卡不生成 `traceId/decisionSeq`（重启才由迁移补，期间事件 traceId 为空） | 必改 | 无 | 建卡即 traceId 非空、decisionSeq=0；首轮事件 traceId 非空 |
| P1-8 | `policyVersion` 硬编码 3（无法回答「按哪版判」） | 必改（最小组件）/ M4（策略版本化整体） | 无 | 新事件带 `PolicySchema.version`；改版本后新事件版本号变化 |
| P1-11 | 提问建卡无幂等 + 两条建卡路径 + 异常被吞（05 事故 E） | 必改 | 无 | 同 `callId` 调两次只建一张卡；`cards.create` 抛错时 records 有 error 可见 |
| P1-12 | 原生提问与卡双入口竞速未收敛（05 事故 D） | 拍板（折叠 vs 标注同源） | 拍板 | 卡先答 → 原生提问被收敛，不产生第二条 user 消息；或卡上显示「同源」标记 |
| P1-13 | `unknown/failed` 行内显示「已批准，执行中」且无重试入口；attention 与已关闭双算 | 必改 | P0-7 映射 | 行内按 ds 给动作（重试/重开/作废）；`done+unknown` 只出现在一个过滤；KPI 与过滤同口径 |
| P1-14 | 面板动作（answer/adopt/deny/complete/dismiss/reopen）无 CAS | 必改（低优先） | 无 | 两个标签页先后同一动作 → 第二次 409，不静默重写 |
| P0-4 | `/evidence` 可执行任意命令；`/todo`、`/evidence` 无写者校验（自证） | 必改 | 契约（acceptance/plan 绑定） | 伪造 planId/任意 cmd → 403/400；未批准计划不能 collect；验收无 E2 不得 confirmed |
| P0-6 | 观察者只绑回合结束 + 跳过静默 + 非 user 触发回合不观察 | 必改 | 无 | 删 user/message 事件后兜底仍建卡；`tool-jobs` 触发回合被观察；跳过写 `records.status='skipped'` |
| P0-1 | 回合内危险动作前置闸门 | 必改（OPT P0-1 已有方案） | 无 | guard 注入后 `destructive/spend` deny + 就地建卡；批准发一次性放行券；工作区内普通写不拦 |
| OPT-P1-1 | 多问题逐题作答（= 主报告 P1-10） | 必改 | 契约（`answers[]`） | 两题各选不同值 → payload 逐题对应；缺题 400 |
| OPT-P1-2 | 失败/过期卡按产物存在性自动失效（= 主报告 P1-9 确定性部分） | 必改 | 契约（`artifacts[]`） | 产物存在 → invalidated（留痕可重开）；不存在不动；destructive/spend 只提议 |
| OPT-P1-3 | 卡片去噪（汇报类降 info / 同源合并） | 必改 | 无 | 纯汇报 decision→info；同会话 10min 同标题合并并写 `merged` 事件；跨会话不合并 |
| P2-a | E0–E4 证据分级、`sourceRef`、每卡累计 ≤5、30s 总预算 | M4（P0-4 顺手加分数字段） | 拍板（是否本轮建模） | — |
| P2-b | 授权矩阵 / 置信阈值 / 模板 CRUD+试运行 / `policy_change`（UI-UX §3） | M4 | 拍板（范围） | — |
| P2-c | 会话内介入 chip / `sessionOverrides`（UI-UX §5） | M4 | 拍板（范围） | — |
| P2-d | 聊天卡节点补 `traceId/stage` 快照（UI-UX §6） | M4 | 无 | — |
| P2-e | 设置缺 WIP/执行器开关/日预算/保留/通知（UI-UX §4） | M4 | 拍板（范围） | — |
| P2-f | HMR 重复订阅：`observeTurns`/`routeDecisionEvents` 无 disposer；`SeenTracker` 每次 reload 重建 | 必改（与 P0-6 同批，否则兜底上线后会双观察） | P0-6 | 一次重载后同回合只观察一次；免打扰游标不丢 |
| P2-g | `migrate` 伪造 `from:'idle'` 事件；`noteCase` 的 phase 取当前而非目标 | 必改（小） | 无 | 迁移事件 from 符合迁移表或标 `meta.migration`；replay 后可解释 |
| P2-h | 浏览器逐屏走查（docs/verification.md 清单） | 拍板（谁执行/什么时候） | 收口前 | 7 屏 + 明暗 + 详情五段点过一遍，截图存档 |

## 4. 需要 Lead 拍板的项（不拍板优化员无法安全动手）

| # | 待拍板 | 默认建议 | 影响 |
| :-- | :-- | :-- | :-- |
| D1 | 决策卡通过标准：是否 = 「origin 会话产生新一轮（回执 turn > 派发 turn）」 | **已拍板（2026-11-10 09:40）**：① executed=回执（turn 更大）② confirmed=回执+最终回复非空，不要求 E2 产物 ③ 无回执→failed/no-receipt+需关注通知，不再落决策卡，人手动 reopen ④ 空回复/报错→failed+通知，不进已结束。**追加拍板（09:43）**：不采纳 `kind→info`，改用 `shared/state.ts::laneOf(card)` 派生车道（failed/unknown → 需关注，不碰 kind、不新增枚举、不迁移）。落地口径与硬约束见 §1.5 | 已解除；优化员按 §1.5 实现 |
| D2 | Todo 清单注入：插件按 acceptance 自动生成 baseline，还是只靠提示词约定让执行者自己 `POST /todo` | 自动生成（否则 B 类分流永远死代码） | 决定 P1-5 工作量 |
| D3 | 双入口（原生提问 + 卡）：折叠原生组件，还是卡上标注「同源」 | 标注（改动小、可逆） | 决定 P1-12 |
| D4 | `/evidence` 收紧范围：是否保留「运维只读取证」通道；exec 类 checker 是否只允许来自批准时冻结的 acceptance | 只允许来自 acceptance；面板人工只跑 file/http | 决定 P0-4 的安全边界与运维便利 |
| D5 | UI-UX 剩余项（授权矩阵/模板库/会话 chip/通知/保留）本轮是否全部 M4 | 全部 M4，本轮只收口 P0+P1 | 决定本轮范围与验收口径 |
| D6 | 收口验收用「干净快照 verify」是否足够，还是必须再做一次浏览器走查（P2-h） | 两者都要：verify + 一次 7 屏走查 | 决定交付判据 |
| D7 | destructive/spend 卡不自动失效（只提议） | 已按 TODO-RECONCILE §5.5 定，确认即可 | 防误失效 |

## 5. 结论

- **真修好 9 项**（均带测试名与我的独立探针）：执行回执 P0-3、批准幂等 P0-2、覆盖写 P0-5、单一真源+laneOf P0-7、观察者兜底 P0-6、零证据不 confirmed P1-2、dispatched TTL P1-3、失败卡可发现性 P1-13、三条小修（分组头/isCardClosed/锁）。
- **半修 3 项**：票拟自动执行绕过内核 P1-4、面板动作 CAS P1-14、HMR 事件订阅无 disposer P2-f。
- **进行中 1 项**：回合内危险动作闸门 P0-1（代码已落 `host/gate/*`，按 Lead 指示本轮不验规则，只确认「不阻塞收口」）。
- **未修/下一轮 12 项**：P0-4（证据自证 + `/evidence` 任意命令）、P1-5（Todo 注入）、P1-6（records caseId/traceId）、P1-7（建卡 traceId）、P1-8（policyVersion）、P1-9（对账产物）、P1-10（多问题逐题）、P1-11（提问建卡幂等）、P1-12（双入口）、OPT-P1-3（去噪）、info/auto 过滤器、migrate 伪造 from。
- **干净快照 verify 全绿**：**365 passed + 1 skipped**（50 文件通过 + 1 跳过），client bundle **123.7 KB**，lint/typecheck/build/ABI/预算全过；快照计数 131 在跑前跑后一致（10:22:25）。同快照 10:23 二次重跑出现 2 个 5s 超时，隔离重跑通过 → 资源竞争，非回归（详见 §2）。
- **可否收口**：以「防错 + 闭环」为口径——原 P0 六条中 5 条真修好、1 条（闸门）进行中；真实事故 5 条里 4 条（重复派发、记录丢失、长回合零卡、新会话首轮零卡）已完成代码级闭环，生产库写入未拦按 Lead 排期到下一轮第一优先。**唯一不建议再拖的高危是 P0-4**（验收可被「自己做证据」绕过），列为下一轮第二优先。

## 6. 最终 triage

### 6.1 真修好（带测试名 + 我的独立探针）

| 主报告编号 | 交付 | 证据（代码 / 测试 / 探针） |
| :-- | :-- | :-- |
| P0-3 执行回执 | OPT-B | `scheduler.ts:94-133`（只落 dispatched + meta.turn/key）；`execution/receipt.ts`（tracker/restore/sweep）；`verify.ts:57-67` `hasReceipt` 唯一无证据通道。测试：`scheduler.test.ts:155`、`receipt.test.ts:108/121/134/145/157/168/178`、`verification.test.ts:105/112/136`。探针 5/5（无回执/同回合/空回复→不通过；有效回执→confirmed） |
| P0-2 批准幂等+幂等键 | OPT-C | `action.ts:197-200`（status 已结束或 ds≠idle → 400）、`action.ts:56-57`+`reopenCard`（reopen→idle+CAS）、`scheduler.ts:44-50,104-145`（key = 最后一次 waiting 事件 id，`dispatched.meta.idempotencyKey` 落盘去重）。测试：`kernel-routes.test.ts:186/203/214`、`scheduler.test.ts:183` |
| P0-5 覆盖写（进程内） | OPT-A + P0-5 残留 | `doc.ts:96-104 mutate` + `:127-158 withFileLock`（globalThis 链 + path.resolve + 慢锁 warn）、`store.ts`/`precedents.ts`/`records.ts` 全走 mutate/readFresh。测试：`store.test.ts:100/125/143/155/175`、`precedent-store.test.ts:77`。探针：双实例同 tick 15+15 → **30/30**（修前 15/30） |
| P0-7 单一真源 + laneOf | OPT-P0-3 + D1 | `case-contract.ts:67-83`（STATUS_FOR_DELIVERY 单一映射）、`transition.ts` 同 patch 写 status、`drift.ts` 启动/对账纠正、`state.ts:76-95 laneOf` 六车道、`client/stage.ts:75-155` 全读 laneOf、`WorkbenchTab.tsx:171-177` 分组头同源、`CardActions.tsx:55-66` attention=重开。测试：`shared/lifecycle.test.ts`、`state-order.test.ts`、`client/stage.test.ts:96/113`、`panel.test.tsx:292`、`workbench-tab.test.tsx:129`。探针：10 张卡每张 ≤1 过滤器、attention=2 不含 running、groupPending(4)=KPI 决策+需关注(4) |
| P0-6 观察者兜底 | OPT-P0-2（审计 P0-6） | `fallback.ts`（120s idle + 30s sweep + 指纹 + 全局 Symbol 跨 HMR + MAX_ATTEMPTS=2）、`trigger.ts`（noteSkip/markObserved/`没有轮次触发器`）、`provenance.ts:46-52 turnTriggerOf`、`records.ts` 并入 skipped、`config-contract.ts` `skipped`/`skipReason`/`fallbackObserve`。测试：`observer-fallback.test.ts` ×7、`kernel-routes.test.ts:230`。探针 F1–F8（tool-jobs/compact/card-answer 算触发、time-context 不算、事故 4/5 形状补观察、关闭开关回旧行为） |
| P1-2 零证据不 confirmed | 本轮顺带 | `verify.ts::confirmedOutcome` 现在要求 `evidence.length>0`；测试 `verification.test.ts:184`「清单全绿但零证据 → 不得 confirmed」 |
| P1-3 dispatched TTL | 随 OPT-B | `receipt.ts::sweep` 180s → `failed/no-receipt`（`DTC_VERIFY=off` 也回收，`assemble.ts:42-48` 无条件建 tracker）；测试 `receipt.test.ts:145` |
| P1-13 failed/unknown 可发现性 | 随 D1 | 行内给「重开」、无批准、无 in-flight chip；KPI/过滤/页头/分组头同源；测试 `panel.test.tsx:292`、`stage.test.ts:96/113` |
| 三条小修 | Lead 指定 | 分组头=decision+attention（探针 groupPending=4=KPI 4）、`isCardClosed=laneOf==='closed'`（探针 failed/unknown→false、confirmed→true）、`withFileLock` path.resolve+2s warn+contracts 单进程前提 |

### 6.2 半修（写清剩余条件）

| 编号 | 现状 | 剩余条件 | 归属 |
| :-- | :-- | :-- | :-- |
| P1-4 票拟自动执行绕过内核 | 人工批准已入内核；票拟 `autoApply` 仍直接 `deliverToOrigin`（`decision/autoapply.ts:76`）→ 无 journal 事件、无验收、卡 `status=done`+`ds=idle` | 改成 `kernel.apply(→waiting)` 走 scheduler，把「自动」只表达为 `authority=delegated` | 下一轮（闭环完整性） |
| P1-14 面板动作 CAS | 只有 approve 传 `expectedSeq`；answer/adopt/deny/complete/dismiss 无令牌（`client/api.ts`） | 卡下发 `decisionSeq`，所有 action 带 `expectedSeq/expectedState`，服务端 409 | 下一轮（低） |
| P2-f HMR 事件订阅无 disposer | fallback timer 已有 `root.effect` 停止；`observeTurns`/`routeDecisionEvents` 的 `root.on` 仍无 disposer | 用 `root.effect(() => () => off())` 收口；或在注释里写明依赖 tracker 指纹去重 | 下一轮（低风险，已有指纹兜底） |

### 6.3 本轮不做 / 未修（含归属与理由）

| 编号 | 内容 | 归属与理由 |
| :-- | :-- | :-- |
| **P0-1 回合内危险动作闸门** | 代码已落 `host/gate/{classify,gate,card}.ts` + `turn-gate.test.ts`（本轮不验规则） | **下一轮第一优先**。理由：这是唯一能真拦不可逆动作的机制，且宿主 `tools.guard` 钩子已验证存在。规则表已由 Lead 修订（补生产库写入、保护 dsh-dev、去掉装包拦截）。状态=**进行中** |
| **P0-4 台账自证 + /evidence 任意命令** | `/evidence` 仍接受任意 `{kind:'exit',cmd}` 在宿主 `exec()`；`/todo`、`/evidence` 无写者/plan 校验 | **下一轮第二优先**。需契约：checker 只能来自批准时冻结的 acceptance + `POST /case/:id/collect` 替代自由 cmd；否则验收可被「执行者自己造证据」绕过（与 EVIDENCE-MODEL 的信任基冲突） |
| P1-5 Todo 从不注入会话 | 生产数据仍无 `todo/` 目录；B 类分流依赖 `todo.frozen` 永不触发 | 需 Lead 拍板（自动生成 baseline vs 提示词约定），再实现 |
| P1-6 records 缺 caseId/traceId | `RecordSchema` 仍无两字段（`/records` 已能并 skipped 事件，但 observer/decision 运行记录仍对不上卡/trace） | 下一轮（小） |
| P1-7 建卡不生成 traceId/decisionSeq | `Store.create` 仍未写，重启迁移才补 | 下一轮（小，O5） |
| P1-8 policyVersion 硬编码 3 | `transition.ts:91,123` 等仍是 `?? 3` | 下一轮（小）/策略版本化整体 M4 |
| P1-9 对账只做 superseded | 产物存在性/后续轮次未做；journal `invalidated` 仍 0（生产未触发） | 下一轮（OPT-P1-2） |
| P1-10 多问题拍平 | `action.ts` 仍把同一文本塞给每个 item；`QuestionOptions` 仍平铺 | 下一轮（OPT-P1-1，需契约 `answers[]`） |
| P1-11 提问建卡幂等/双路径 | 服务钩子 + 事件两条建卡路径，无 callId 幂等，异常被吞 | 下一轮（事故 E） |
| P1-12 双入口未收敛 | 仍是 `Promise.race` 双入口 | 需 Lead 拍板 UX（折叠 vs 标注同源） |
| OPT-P1-3 卡片去噪 | 未做 | 下一轮或 M4 |
| P2-a 证据分级 E0–E4 / 每卡上限 / 30s 预算 | 未建模 | M4 |
| P2-b/c/d/e 授权矩阵 / 模板库 CRUD / 会话 chip / 卡节点 trace / 设置六组 | 未做 | M4（范围外） |
| P2 info/auto 无过滤器 | `laneOf` 有 info/auto 但 Workbench 无对应过滤/KPI；`filterCounts all=10` vs 五过滤器合计 8 | 优化员 P2 清单（下一轮小） |
| P2 migrate 伪造 `from:'idle'` | `migrate.ts:60` 仍是 `from:'idle'` | 下一轮（小，可解释性） |

### 6.4 仍需 Lead 拍板（会阻塞对应实现）

| # | 待拍板 | 建议 |
| :-- | :-- | :-- |
| D2 | Todo 注入：插件自动按 acceptance 生成 baseline vs 只靠提示词约定 | 自动生成（否则 B 类分流永远死代码） |
| D3 | 双入口（原生提问 + 卡）：折叠 vs 卡上标注「同源」 | 标注（小、可逆） |
| D4 | `/evidence` 收紧范围：是否保留运维只读取证；exec checker 是否只允许来自 acceptance | 只允许来自 acceptance；人工只跑 file/http |
| D5 | UI-UX 剩余（授权矩阵/模板库/会话 chip/通知/保留）是否全部 M4 | 全部 M4，本轮只收 P0+P1 |
| D6 | 收口验收是否 = 干净 verify + 一次 7 屏浏览器走查 | 两者都要 |
| D1 | 决策卡通过标准 | **已拍板**（回执 + 回复非空；失败走需关注；见 §1.5） |

## 7. 下一轮必须做的 3 件事

1. **P0-1 回合内危险动作闸门（第一优先，进行中）**：唯一能在不可逆动作发生前拦住它的机制，且宿主 `tools.guard` 钩子已验证存在；规则表按 Lead 修订版（补生产库写入、保护 dsh-dev、去掉装包拦截）落地并做误拦率走查。
2. **P0-4 台账自证收口**：`/evidence` 只跑「批准时冻结的 acceptance」，`/todo` 绑定 plan/actor；否则验收层（P0-3 刚修好的回执/证据链）仍可被「执行者自己写清单和证据」整体绕过——这是当前闭环里剩下的最大信任缺口。
3. **把闭环里还没入账的动作收进来**：票拟自动执行走 kernel（P1-4）+ 派发时注入 Todo 清单（P1-5）+ `records` 补 `caseId/traceId`（P1-6）。做完这三件，「每个动作都有账、每次验收都有据」才真正成立。

