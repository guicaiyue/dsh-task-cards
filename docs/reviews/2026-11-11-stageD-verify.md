# 阶段 D 验收（2026-11-11）：验收与面板

> 验收人：card-analyst（只读；本文件为唯一写入；未改 `src/`/`tests/`、未 commit、未重启宿主）。
> 对象：阶段 D 交付快照 2026-11-11 01:10（HEAD `ac80930` + 未提交改动；含 R1–R4 返工复验与 C 回归修复）。
> 判据：Lead 的 D 验收五点（acceptance 链 / 三级验收 E0–E4 / todo 三类分流 / 面板分道与 Verdict / KPI 六项对账）+ 重试风暴四场景（C 回归）+ direction-review §5-D1~D5 + 「不许为指标好看改口径」红线。
> 探针：仓库外 `/tmp/dtc-stageD/`（acceptance 链 handler 级、三级验收、todo 分流、面板、KPI/`/stats` 对账）与 `/tmp/dtc-stageC/retry-storm.test.ts`（C 回归）；数据快照 sha256 `6c8b31b9…`（实时 51 卡）/ 冻结集 `125613df…`（52 卡）；回合数按 `session.v4.jsonl.zstd` 多帧解压后数 `turn/end` 独立复算。
> 浏览器交互归 Lead；本报告只覆盖数据层/代码层。

## 0. 结论

**通过**（2026-11-11 01:10 返工复验后）。初次验收的 4 个返工点（R1 三级验收 decision/user 缺失、R2 KPI 口径文档矛盾、R3 pending 双计、R4 unknown 落人率缺失）已全部修复并复验；C 重试风暴回归 + 真机 0 复发证据链、acceptance 链、E0–E4、todo 分流、面板分道/Verdict、KPI 同源与 verify 2 连绿均保持。**A→D 可以收官。** 仅 1 条非阻断文档收口建议（§9.6）。

| 项 | 判定 | 证据摘要 |
| :-- | :-- | :-- |
| C 重试风暴回归（4 场景） | ✅ 通过 | 永久失败 attempts=1 且不再调用；永失败 ≤3 后 markFailed+升级卡；TypeError 落盘不重试；删卡 → cancelled + 0 派发 |
| 真机观察（修复后窗口） | ✅ 通过 | 00:52 起「执行派发失败」= **0**；最后一条 00:44:42（重启前）；重启自检 00:56:49；旧 plan `c-mw958oku-1jzl2:8` **cancelled=true**、attempts 冻结 64 |
| D1 acceptance 链 | ✅ 通过 | 无 acceptance 卡 detail 标记恰好一次（reopen 再批仍 1）；合法保 2 条；非法（越界/`rm -rf`/`127.0.0.1`）全丢弃并标记；三入口 `sanitizeAll` 均在位 |
| D1 三级验收（system/decision/user） | ✅ 通过（R1 复验） | `semanticTierOf` 分级、verifier 开语义票据、`recordSemanticOutcome` 落 Outcome（verifier=model/user）；探针 3/3 |
| D1 E0–E4 按 effect 下限 + Outcome 落账 | ✅ 通过 | E1-only/旧无 level 不 confirm；destructive+E2 不 confirm、+E3 confirm；`minimumLevelFor` read=E1/write-code=E2/external=E2/destructive=E3/spend=E4；Outcome 经 `kernel.verify` 落 plans.json 且 planId/criteriaResults 绑定 |
| D1 todo 三类分流 | ✅ 通过（A 按 Lead 裁决） | B：一次 `continue-session`→`escalate`；C：blocked/cost-up→`escalate`；A：`failed/no-receipt`+`awaiting-user-escalation`+`lastError` 落人；**A 类执行结果不自动重派**已由 Lead 裁决并写入 contracts「重试策略与升级」边界段 |
| D4 面板分道 / Verdict / 升级原因 | ✅ 通过 | laneOf 十场景：pending_secretary/card_ready→decision、escalated_user→escalated、approved+waiting/dispatched→running、confirmed→closed、failed→attention、notice→info；Verdict 13 字段齐全；升级卡详情显示 route.reason / advice.question / 秘书倾向 |
| D4 面板五 KPI | ✅ 通过（R3 复验） | `kpiOf` 已分离：fixture 现为 `{pending:1, escalated:2, delegated:1, overridden:1}`，escalated 不再计入 pending |
| D5 KPI 六项（/stats 同源） | ✅ 通过 | `/stats` real：turns=74、decision=14、advised=10、reversible=10、waits=2、cardsPerTurn 0.189、interventionsPerTurn 0.23、waitRate 0.20；all：0.27/0.311；与我的独立复算逐项一致；sha256 绑定快照；面板只读 `stats.groups.real`（本地 `rateKpiOf` 已删） |
| D5 KPI 口径文档 | ✅ 通过（R2 复验） | contracts.md 已重写为唯一口径：kpiOf 仅即时计数、比率全部 `/stats.groups.real`、分母写死（非 destructive / 有票拟 / decision / 真实 turn/end）；旧 `rateKpiOf` 段已删 |
| D5 unknown 落人率 | ✅ 通过（R4 复验） | `/stats` 已有 `unknown / unknownToHuman / unknownToHumanRate`（unknown 结论落到 attention/awaiting-user-escalation/retry-exhausted/升级卡的比例） |
| verify 连跑 2 次 | ✅ 通过 | RUN1/RUN2 均 `61 files passed + 5 skipped`、**440 passed + 5 skipped**、bundle 130.9 KB、ABI/三脚本/预算全过；本轮未复现 flake（Lead 遇 1 次，记为 note） |

## 1. 重试风暴（C 回归）四场景 ✅

真机证据（宿主 `docker compose logs`，容器时区 UTC 对应本地 +8）：
- 最后一次 `执行派发失败` = **16:44:42 UTC（00:44:42 本地）**；最近启动自检 = **16:56:49 UTC（00:56:49 本地）**；**00:52 起计数 = 0**（命令：`docker compose logs --since '2026-11-11T00:52:00+08:00' dsh | grep -c 执行派发失败`）。
- 旧 plan `c-mw958oku-1jzl2:8`：attempts 停在 **64**、**cancelled=true**、lease=null；卡已不在快照（51 张）→ 调度 revalidate 生效，无新增 attempt。

探针 `/tmp/dtc-stageC/retry-storm.test.ts`（4/4 绿）：
1. 永失败适配器（accepted:false，非永久串）→ 20 次 tick：adapter **1** 次、attempts **1**、`waitReason=retry-exhausted`（退避 + 上限，无风暴）；升级卡已建（「执行失败 1 次：…」）。
2. 适配器抛 `TypeError: ... reading 'resolve'` → tick **不抛**、attempts **=1**（throw 路径已落盘）、永久失败 **只试 1 次**、生成升级卡。
3. 已有 2 次失败（早于退避窗口）→ 第 3 次失败：attempts **=3**、`plan.failed=true`、升级卡 1 张、不再重试。
4. 卡删除 → `plan.cancelled=true`、删后 **0 次派发**。

## 2. acceptance 链 ✅（`/tmp/dtc-stageD/acceptance-chain.test.ts`，handler 级真实 approve）

- 无 acceptance 卡：approve 后 detail 追加 `⚠ 无验收方式，需人工补充` **恰好 1 次**；模拟 reopen 再批仍为 1 次（幂等）。
- 合法 acceptance（`pnpm test` + `src/foo.ts`）：冻结保留 2 条、无标记。
- 非法 acceptance（`../etc/passwd`、`rm -rf /`、`http://127.0.0.1:3000`）：冻结后 **0 条** + 标记。
- 三入口均过白名单：`observer/create.ts`（草稿）、`decision/apply.ts`（票拟确认）、`routes/action.ts`（approve 冻结）都有 `sanitizeAll`。

## 3. 三级验收与 E0–E4

### 3.1 E 分级与 Outcome 落账 ✅

- `minimumLevelFor`：read=E1 / write-code=E2 / external=E2 / destructive=E3 / spend=E4（探针实测）。
- E1-only 与「旧记录无 level」→ `unknown/inconclusive`，不 confirmed；E2 ok → confirmed；E2 fail → failed+retry（第 2 次 escalate）；destructive+E2 → 不 confirm，+E3 → confirmed。
- 入口级：`assembleKernel` → `kernel.verify(caseId)` → `plans.json.outcomes[]` 落账，`planId` 绑定批准计划、`criteriaResults` 2 条、`verifier='machine'`。

### 3.2 「三级验收」的 decision/user 两级 ❌（返工 R1）

`src/host/verification/verify.ts` 全部返回 `verifier:'system'`；`shared/outcome.ts` 的 `Verifier` 类型有 `system|decision|user`，但全仓 **没有任何地方赋值 `verifier:'decision'`/`'user'`**；`verifyCard` 只留 `semanticNeeded: true` 标记，**没有任何消费者**；`plans.json` 里 Outcome.verifier 恒 `machine`。方向评审 §5-D1 明确要求「三级验收（system/decision/user）」，D1 只完成了 E 分级与 system 级。

### 3.3 todo 三类分流 ⚠️

- B（忘更新）：清单冻结未完成 → `failed/continue-session`（r0）→ `escalate`（r1），上限 1 ✓。
- C（代价变高/阻塞）：`unknown/escalate` ✓。
- A（中断）：`receipt.ts::#fail` → `failed/no-receipt` + `waitReason=awaiting-user-escalation` + `lastError`（进「需关注」，落人）✓；但没有任何自动「重试/补偿」动作（重开由人操作）——与「A→重试/补偿」的字面要求有差距，列为观察项（是否算达标请 Lead 裁决）。

## 4. 面板数据层

- laneOf 十场景全对（见 §0 表）；六车道分组与过滤器互斥（`pending`/`escalated`/`running`/`verifying`/`notice`/`closed`/`attention`）。
- Verdict 可展开字段：schema 13 字段，含 `authority/actorType/policyVersion/confidence/rationale/evidenceRefs/at`；`/case` 返回 `verdicts[]`。
- 升级卡显示「缺什么」：`DetailSegments.tsx` 用 `advice.question` 渲染 `caseEscalationMissing`，另显示 route.reason/秘书倾向。
- **五 KPI 双计（R3）**：fixture（1 待秘书 + 2 升级 + 1 delegated + 1 notice）→ `kpiOf` = `{pending:3, escalated:2, delegated:1, overridden:1}`；pending 把两张 escalated 也算进去，与 contracts.md:102「`pending_secretary` 单列」不符（若产品定义「待决含升级」需改文案/文档，否则 pending 应只计 decision 车道）。

## 5. KPI 六项对账（`/stats` 唯一数据源）✅ + 文档口径 ❌

### 5.1 数字对账（快照 sha256 绑定，独立复算一致）

`GET /stats` real 组（实时快照 51 卡，sha256 `6c8b31b9…`）：`turns=74`（我独立按 session `turn/end` 复算 =74；两真实会话 21+53，第三会话无 turn/end）、`decision=14`、`advised=10`、`reversible=10`、`waits=2`、`cardsPerTurn=0.189`、`interventionsPerTurn=0.23`、`waitRate=0.20`、`noticePerTurn=0.419`；all 组：`decision=20/advised=16`、`cardsPerTurn=0.27`、`interventionsPerTurn=0.311`、`waitRate=0.438`。与 Lead 真机数字一致。

源码分母断言（探针直接查 `/stats` 源码）：`waitRate=ratio(waits, advised.length)`、`escalationRate=ratio(escalated, reversible.length)`、`cardsPerTurn=ratio(decision.length, turns)`、`interventionsPerTurn=ratio(interventions+approvals, turns)`、`delegatedRate=ratio(delegated, decision.length)` —— 全部对齐 §9/§10/§12；面板 `WorkbenchKpis` 只读 `stats.groups.real`，本地 `rateKpiOf` 已删（探针断言）。

### 5.2 口径文档 ❌（R2）

`docs/contracts.md` 三处互相矛盾/过时：
- :102 「升级率分母 = **有票拟且已路由**的卡」 vs :116 「升级率分母 = **非 destructive** 的 decision 卡」（后者才是实现与 §10/§12 口径）；
- :131 仍写「六项 KPI（`stage.ts::rateKpiOf`）……回合数来自**卡 `origin.turn` + 事件 `meta.turn` 去重**」——本地函数已删除，真实来源是 session `turn/end`（§112 的新口径）。
→ 必须删掉过时段落、只留 `/stats 口径` 一节，避免下一轮按错文档复算（这条直接触及「改口径」红线：同一指标两种分母写在同一文件里）。

## 6. verify 连跑 2 次 ✅

| RUN | 结果 |
| :-- | :-- |
| 1 | 61 files passed + 5 skipped；**440 passed + 5 skipped**；bundle 130.9 KB；ABI / kernel-only-writes / single-composition-root / cross-module-imports(10/10) / 预算全过 |
| 2 | 同 RUN 1 |

flake note：Lead 连跑 4 次有 1 次偶发失败；我本轮 2/2 未复现（B/C 期该 `turn-gate` 偶发已定位为 globalThis 券状态，afterEach clearAllows 已加）。建议保留「连跑 3 次」习惯。

## 7. 初次返工清单（R1–R4，均已在 §9 复验关闭）

- ~~R1（阻塞，D1）：三级验收 decision/user 两级~~ → 已修复（§9.1）
- ~~R2（阻塞，D5 红线）：KPI 口径文档矛盾~~ → 已修复（§9.2）
- ~~R3（小）：pending 双计 escalated~~ → 已修复（§9.3）
- ~~R4（小）：unknown 落人率缺失~~ → 已修复（§9.4）
- A 类「执行结果不自动重派」已由 Lead 裁决并写入 contracts：任务级重试只覆盖派发失败，执行结果的成功/失败落人（write+ 人确认原则）。

## 8. 附：证据索引

- 探针：`/tmp/dtc-stageD/`（acceptance-chain、verification、todo-triage、panel、kpi-six、stats-reconcile、semantic、aclass，合计 34 用例）；`/tmp/dtc-stageC/retry-storm.test.ts`（4 用例）；数据快照 sha256 与 `/stats.dataSource.cardsSha256` 比对。
- 真机日志：`docker compose logs --since '2026-11-11T00:52:00+08:00' dsh` → 「执行派发失败」0；最后一条 16:44:42 UTC（重启前），重启自检 16:56:49 UTC。
- 磁盘：`plans.json` plan `c-mw958oku-1jzl2:8` = attempts 64、cancelled=true、lease=null。

---

## 9. 返工复验（R1–R4，2026-11-11 01:10）

> 结论：**阶段 D 通过**，A→D 正式收官。四项返工全部修复，复验证据如下。

### 9.1 R1 三级验收 decision/user ✅

实现：`verification/verify.ts::semanticTierOf`（acceptance.verifier 非 system → decision；destructive/spend 强制 user）+ `semanticOutcome`（返回 `verifier:'decision'|'user'`、`semanticNeeded:true`）+ `verification/verifier.ts::#openSemanticTicket`（开 `kind='decision'` 的语义票据，写 `card.semantic={planId,verifier,sourceCardId,criteria}`）+ `verification/semantic.ts::recordSemanticOutcome`（approve→confirmed / reject→failed / unknown→unknown，落 plans.json 且 `verifier='model'|'user'`）。

复验（`/tmp/dtc-stageD/semantic.test.ts` 3/3）：
- `semanticTierOf`：decision→decision、user→user、destructive→user、system-only→null；
- `verifyCard`：语义项返回 `verified=unknown / verifier=decision / semanticNeeded=true`；user 级返回 `verifier=user`；
- 真入口 `Verifier.verify`：executed 卡 → 语义票据 1 张（含 planId/verifier/criteria）；`recordSemanticOutcome(approve)` → plans.json outcomes `{planId, verified:confirmed, criteriaResults, verifier:model}`。

### 9.2 R2 KPI 口径文档 ✅

`docs/contracts.md` 已重写：
- 「KPI」段明确 `kpiOf` 只做面板即时计数、escalated 独立不进 pending；**所有比率以 `/stats.groups.real` 为唯一数据源**；
- 「/stats 口径」段把分母写死：升级率 = user / 非 destructive decision；wait 率 = wait 票拟 / 有票拟 decision；delegated 率、卡/回合 = decision；回合数 = 真实 `turn/end`；unknown 落人率定义；
- 旧 `stage.ts::rateKpiOf` + 「卡 origin.turn/事件 meta.turn 去重」段已删（`grep rateKpiOf docs/contracts.md` 为空）。

### 9.3 R3 pending 双计 ✅

`kpiOf` 改为 escalated 车道独立计数、不进 pending。复验 fixture（1 待秘书 + 2 升级 + 1 delegated + 1 notice）→ `{pending:1, escalated:2, overridden:1, delegated:1}`（此前 pending=3）。

### 9.4 R4 unknown 落人率 ✅

`/stats` kpi 新增 `unknown / unknownToHuman / unknownToHumanRate`：unknownToHuman = unknown 结论且 `waitReason ∈ {awaiting-user-escalation, retry-exhausted}` 或是 decision 升级卡；源码断言通过。

### 9.5 回归与全量

- D 探针：**11 文件 / 34 用例全绿**（含 acceptance 3、verification 6、todo 5、panel 4、kpi 2、stats 2、semantic 3、aclass 1、dataset 等）。
- C 回归：**7 文件 / 17 用例全绿**（含 retry-storm 4/4）。
- `pnpm verify` 连跑 2 次：**444 passed + 5 skipped**（61 files + 5 skipped）、bundle **131.1 KB**、ABI / kernel-only-writes / single-composition-root / cross-module-imports(10/10) / 预算全过；本轮未复现 flake。
- 真机观察窗口：00:52 起「执行派发失败」**0**；旧 plan cancelled=true（attempts 冻结 64），无新增派发。

### 9.6 非阻断文档收口建议（不影响收官）

`docs/contracts.md`「验收链与三级验收」段目前只描述了 E0–E4 与 acceptance 链，**未写 decision/user 三级（语义票据 + recordSemanticOutcome）与 unknown 落人率的说明**。建议随发布补两行（§9.1/§9.4 的实现已验，只是文档缺一句）。

**最终结论：阶段 D 通过；A→D 全部收官。**

---

## 10. 增量确认：最终态 446（2026-11-11 01:16，发现点复核）

> 结论：**最终态 446 复验通过**，A→D 收官定稿。相对 444 快照功能集合不变，仅测试与文档增补；以下三项按 Lead 要求做代码层确认。

1. **新增 2 条测试 = 三级验收的 decision/user 消费链**（`tests/host/verification.test.ts`，文件 466 行；唯一在 01:10 后改动的测试文件）：
   - `decision 级：语义项 → semanticNeeded + verifier=decision，消费后写 Outcome.verifier=model`；
   - `user 级：destructive 强制用户拍板 → verifier=user，消费后写 Outcome.verifier=user`。
   - **是否验真行为**：是。两条都调用真实 `verifyCard`（断言分级与 `semanticNeeded`）并调用真实 `recordSemanticOutcome`（断言写出的 Outcome `verifier` 映射与 `verified` 结论），不是计数/快照类凑数测试；只把 `recordOutcome` 换成内存 sink（单元边界合理，落账持久化由我的入口级探针另行验证到 plans.json）。
2. **R2 文档口径只剩一段**：`grep` 旧句子 —— `有票拟且已路由` 0、`rateKpiOf` 0、`origin.turn` 0；`meta.turn` 仅剩 1 处且是回执恢复的合法描述（line 214，不是 KPI 口径），`卡/事件` 仅剩 1 处且是否定句（line 121「不是卡/事件估算」）。KPI 只有 `## /stats 口径`（line 113）一处来源，`## 面板分道与 KPI` 只写分道与展开，不再另算分母。
3. **`/stats` 与面板文本行一致（代码层）**：`WorkbenchKpis::ratesText` 只读 `stats.groups.real`，逐字段直映射 delegatedRate/overrideRate/escalationRate/waitRate/cardsPerTurn/interventionsPerTurn/noticePerTurn/unknownRate + `stats.turns` + `dataSource.cardsSha256` 前 6 位；`grep rateKpiOf src/` 为空（无本地算法）。用当前线上 `/stats` 复算面板行文本：
   `服务端口径（真实回合 74，sha 2195bc）：delegated 0% / override — / 升级 0% / wait 20% / 卡 0.189 张/回合 / 干预 0.23 次/回合 / 通知 0.419 / unknown 落人 100%` —— 与 `/stats.groups.real` 每个字段一一对上（unknown 2/2=1.0，与 Lead 真机一致）。
4. **全量**：`pnpm verify` = **446 passed + 5 skipped**（61 files + 5 skipped）、bundle 131.1 KB、ABI / kernel-only-writes / single-composition-root / cross-module-imports(10/10) / 预算全过；D 探针 34/34、C 回归 17/17 保持绿。
5. 非阻断清理项（代码冻结时可顺手删）：`locale/workbench.ts::kpiRates` 已成未使用文案，且其中“回合数来自真实 origin.turn”措辞过时（面板实际只渲染 `kpiServer`）；删掉即可，不影响功能。

**最终态 446 复验通过。**

