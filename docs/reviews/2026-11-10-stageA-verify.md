# 阶段 A 验收（2026-11-10）：契约与账本

> 验收人：card-analyst（只读；本文件为唯一写入；未改 `src/`/`tests/`、未 commit、未重启宿主）。
> 对象：工作区快照 2026-11-10 15:47（HEAD `ac80930` + 未提交改动；优化员自述 404 passed + 1 skipped、bundle 126.3 KB）。
> 判据：Lead 的 7 项必验清单 + 方向评审 §5 阶段 A + A-CORE §3.2/§4.2 + Lead 追加的「边界要实测会红」。
> 探针：仓库外 `/tmp/dtc-stageA/`（4 个数据探针 + 账本/迁移探针）、`/tmp/dtc-boundary*`（边界违规沙箱）；全部直接读真实数据或临时副本，不依赖实现方测试。
> 浏览器四连（批准/拒绝/重开/答卡）**归 Lead 验证**，本报告不下结论。

## 0. 结论

**通过**（2026-11-10 16:03 追加复核后）。7 项必验全部达标：R1 组合根（分层组合根 + `new` 构造拦截）、R2 模块边界棘轮（新增/过期双向 exit 1）、R3 policy 归一化（boot 接线 + 磁盘自愈）均已复核通过，详见 **§6 追加复核**。数据/契约/账本/replay/行为回退全部通过；剩余仅 2 条不阻断的白名单/文档小项（§6.1、§6.5）。

| # | 必验项 | 判定 |
| :-- | :-- | :-- |
| 1 | decision 迁移（51/51 + 幂等；16:03 真实数据已增至 **52/52**，自检一致） | ✅ 通过 |
| 2 | 账本（plans.json / approval-policy.json 生成、schema、命名分离、重启仍在） | ✅ 通过 |
| 3 | replay + 链连续性 | ✅ 通过（69/69，10 处迁移放行） |
| 4 | traceId（写入必填 / 历史读取补齐 / 文档） | ✅ 通过 |
| 5 | 行为不回退（A 相关单测 + 全量 verify） | ✅ 通过（浏览器归 Lead） |
| 6 | 契约（4 个 zod 对象 / CardSchema / DECISION_STATES 10 值） | ✅ 通过 |
| 7 | 边界强制（biome 分组 / kernel 写 / 组合根） | ✅ 通过（返工后复核，见 §6） |

---

## 1. 必验项逐条（实测证据）

### 1.1 decision 迁移 ✅

| 检查 | 实测 |
| :-- | :-- |
| 线上卡（验收时 51，16:03 已增至 52） | **51/51 → 52/52 有 decision**；全部合法（10 枚举内，非法 0）；分布 `notice 26 / closed 24 / card_ready 1` |
| boot 门槛 bug 是否真修 | `boot.ts:27-30` 已改为**无条件** `migrateDecisions`（不再挂 `result.migrated.length`）；注释写明「真实数据早就迁过 traceId，不能挂在门槛里」 |
| 回归用例 | `tests/host/decision-state.test.ts:90`「已迁移数据（traceId/deliveryState 都有）+ 无 decision → 迁移仍 51/51 补齐（boot 门槛回归）」存在 |
| 我的独立验证 | 复制真实数据 → 剥掉全部 `decision` → 跑 boot 口径（`migrateCards` 返回 migrated=0 + 无条件 `migrateDecisions`）→ **补 51/51**；**第二遍 filled=0（幂等）**；迁移后 replay 51/51 无异常 |

### 1.2 账本 ✅

| 检查 | 实测 |
| :-- | :-- |
| 文件真实生成 | 线上数据目录 15:38 已生成 `plans.json`、`approval-policy.json`（`boot.ts` 里 `plans.ensureFile()`/`approvalPolicy.ensureFile()`） |
| schema 合法 | `PlansStore.list()` 读回 `plans:0 / outcomes:0`（结构 `{version,plans,outcomes,updatedAt}`）；`ApprovalPolicyStore.read()` 读回 `version:1, tiers:{auto,delegated,user}`（`ApprovalPolicySchema`） |
| 与工具白名单分离 | `host/policy/policy.ts::POLICY_FILE = <DSH_HOME>/dsh-task-cards/policy.json`（工具/技能白名单）；`host/policy/store.ts::APPROVAL_POLICY_FILE = 'approval-policy.json'`；`assemble.ts:38-39` 分别 `new PlansStore(path.join(dataDir,'plans.json'))`、`new ApprovalPolicyStore(path.join(dataDir, APPROVAL_POLICY_FILE))` → **两个常量不同名，实测无冲突** |
| 写入路径真实 | 我在临时副本上 `PlansStore.upsert(plan)` → `plans.json` 生成且读回 1 条；`ApprovalPolicyStore.write({})` → 文件生成。A 只要求「存在+可写」，真正计划写入属 C |
| cards.json 只剩快照 | 51 张真实卡里带 `lease/attempts/outcome/outcomes` 的 = **0** |
| 重启仍在 | 文件在磁盘上；新 Store 实例读回正常；`ensureFile()` 对已存在文件 **不重写**（两文件 mtime 不变）。注：本轮约束不重启宿主，未做进程级重启验证 |

### 1.3 replay + 链连续性 ✅

- 独立探针（判据同 Lead）：69 个 journal 文件、**终态一致 69/69**；链断裂 **10 处**，逐条核查全部为 `meta.migration=true` + `reason="migrate: 补齐 traceId 与投递状态"` → 按「显式迁移可跳」判据**全部允许，可疑 0**。
- 迁移副本上（剥 decision 后）：`replay` 51/51 与快照一致；链断裂同样只剩迁移事件。
- 说明：Lead 独立探针的 7 处是同批历史迁移事件，判据未放行 `meta.migration`；本报告采用「放行显式迁移」口径。

### 1.4 traceId ✅

| 检查 | 实测 |
| :-- | :-- |
| 新事件写入必填 | `Journal.append` 先过 `CaseEventSchema`（`traceId: z.string().min(1)`）；我构造缺 traceId 的事件 → **append 抛错**（实测 throw） |
| 历史读取补齐 | 原始 78/148 条空 traceId；`Journal.read` 补 `migrate-<id>` 后 → **空 0、坏行 0**；重复读结果一致（幂等） |
| 文档 | `docs/contracts.md:92` 明确：「历史 78/134 条事件 traceId 为空；`journal.read` 读时补 `migrate-<eventId>`（**不写盘、幂等**）；写入端强制 zod，新事件不会再缺」——符合 Lead 的接受口径 |

### 1.5 行为不回退 ✅（浏览器归 Lead）

- 我实跑 A 相关 7 个测试文件：`replay.test.ts / kernel.test.ts / kernel-routes.test.ts / decision-state.test.ts / ledgers.test.ts / panel.test.tsx / workbench-tab.test.tsx` → **55 passed**（对比 A 前基线 50 passed：+5 为新契约/账本/迁移用例，无回退）。
- **全量 `pnpm verify` 我独立复跑**：`lint && typecheck && test(404 passed + 1 skipped, 53 files) && build && test:abi && check-kernel-only-writes && check-single-composition-root && budget` **全绿**；client bundle **126.3 KB**（预算 150）、host entry 473.8 KB、ABI/代码预算/两脚本全过。
- 四个操作 handler 路径未断：`routes/action.ts` 的 approve/deny/answer/reopen 分支仍在（`kernel-routes.test.ts` 20 例覆盖 action 路由）；按钮级浏览器验证由 Lead 执行。

### 1.6 契约 ✅

| 检查 | 实测 |
| :-- | :-- |
| 四个对象是真 zod | `VerdictSchema/ApprovedPlanSchema/OutcomeSchema/CaseFileSchema` 均在 `shared/contract.ts`；实测有效实例 `safeParse().success=true`、缺必填字段 `false`（真 zod，不是 TS interface） |
| CardSchema 解析真实数据 | **51/51 通过**（含新增 `decision` 可选字段） |
| DECISION_STATES | **10 值**：`created/card_ready/pending_secretary/escalated_user/approved/rejected/conflicted/stale/notice/closed`（Lead 清单写的 9 是笔误，设计文档为 10，已按 10 验） |
| 派生函数 | `shared/decision-state.ts::deriveDecision` 对旧卡可推导；`statusOfDecision` 派生视图可用；`store.patch` 写时同步 `fillDecision/decisionAfter` |

### 1.7 边界强制 ❌（返工点见 §2）

| 子项 | 实测 | 判定 |
| :-- | :-- | :-- |
| kernel 外写 status → `check-kernel-only-writes.mjs` | 沙箱复制仓库 + 在 `routes/cards.ts` 注入 `probeCard.status = 'done'` → **exit 1** 并打印 `✗ src/host/routes/cards.ts:46` | ✅ |
| 第二组合根 → `check-single-composition-root.mjs` | 注入 `ctx.inject([], …)` 到 `observer/trigger.ts` → **exit 1** 并打印位置 | ✅ |
| 两个脚本接进 verify 链 | `package.json:52`：`… && node scripts/check-kernel-only-writes.mjs && node scripts/check-single-composition-root.mjs && pnpm budget`；我跑全量 verify 时两者输出「检查通过」 | ✅ |
| **biome 模块分组** | `decision` → `../scheduler/*` 违规 **exit 1**（`biome.json:112-130`，仅此一组）；但 `question→../observer/*`、`observer→../decision/*`、`scheduler→../observer/*` 违规实测 **exit 0**。现存跨模块内部 import **55 处**（目标模块分布：observer 12 / question 9 / decision 9 / policy 5 / execution 4 / scheduler 3 / evidence 3 / todo 2 …），其中 `decision/*` 有 7 个文件 import `observer/*`（runner/session/parse/input/preview/preset）——都在「不许互引」范围内，但都没被拦 | ❌ 只覆盖 1 对模块 |
| **组合根收敛到 1** | 构造点仍是：`wire.ts`（new Decision/Observer/Scanner，:127/:151/:181）+ `kernel/assemble.ts`（new Scheduler/Verifier/ReceiptTracker/TodoStore/EvidenceStore，:40-67）+ `index.ts:45`（调 `assembleKernel`）；`check-single-composition-root.mjs` 白名单允许 `wire.ts/index.ts/boot.ts/gate/hooks.ts` 4 个文件，且只检查 `root.inject|ctx.inject`，**不检查 `new Scheduler(`/`new Decision(`** | ❌ 仍是 2 个装配层 |

---

## 2. 返工清单（本阶段不通过的唯一原因）

### R1 组合根收敛（A-CORE §3.2 规则 3）

- **现状**：`kernel/assemble.ts` 构造 Scheduler/Verifier/ReceiptTracker/Todo/Evidence（:40-67），`wire.ts` 构造 Decision/Observer/Scanner（:127/:151/:181），`index.ts` 再调 `assembleKernel`；检查脚本白名单 4 文件且只查 `inject`。
- **要求**：装配收敛到单一入口（建议 `wire.ts` 做唯一组合根，`assemble.ts` 只返回纯依赖或并入 wire），并让 `check-single-composition-root.mjs` 同时拦截 `new Scheduler(` / `new Decision(` / `new Observer(` / `new Scanner(` / `new Verifier(` / `new ReceiptTracker(` 在允许文件之外出现。
- **复核方式**：我在 `assemble.ts` 里加 `new Decision(...)`（或反向在 `observer/` 里加 `new Scheduler(...)`）→ 脚本必须 exit 1；同时全量 verify 仍绿。
- **规模**：约 30–60 分钟（脚本扩正则 + 移动 3–5 个构造点，不动行为）。

### R2 biome 分组覆盖（A-CORE §3.2 规则 1）

- **现状**：仅 `src/host/decision/**` 禁 `**/scheduler/**`；现存 55 处跨模块内部 import 中绝大部分不在拦截范围。
- **最低要求（A 阶段）**：把 `decision → observer|question` 补进 patterns，并把 `decision/*` 现有 7 处 `observer/*` import 改走 `shared/*` 或 `kernel/*`（否则 lint 会红）；同理至少补 `question → observer`。其余模块对（execution/verification/todo/evidence/reconcile 之间）可列 B 阶段清单，但要在 `contracts.md` 写明**当前分组覆盖范围**，避免「看起来强制、实际只 1 对」。
- **复核方式**：我沙箱注入 4 对模块违规（decision→scheduler、decision→observer、question→observer、observer→decision）必须全部 exit≠0；现有代码 lint 仍绿。
- **规模**：改配置 10 分钟 + 清理 decision→observer 7 个 import（是否允许保留「工具函数型」import 由你裁决；若允许，需在 biome 用更细的 pattern 放行并写文档）。

> 除这两项外，A 的其他交付（契约/账本/迁移/replay/traceId/行为）我没有任何返工点。

---

## 3. 观察项（不阻断 A，但 B 前必须确认）

1. **approval-policy.json 的默认 tiers 是空数组**：`ApprovalPolicySchema` 内层每个档有默认规则串（`effect=read` / `reversible` / `no-precedent`…），但外层 `.default({ auto: [], delegated: [], user: [] })` 把它们覆盖成空；线上文件实际是 `{"auto":[],"delegated":[],"user":[]}`。若 B 的 `route()` 直接读这份文件，**默认策略将没有任何规则**（要么全 auto、要么全 user，取决于实现）。建议：去掉外层 default 对象、让内层 default 生效，或改成 `{}`。
2. `plans.json` 当前 `plans:0/outcomes:0`：A 只要求账本存在+可写，真正写入在 C（批准生成计划）；我的探针已验证 `upsert/recordOutcome` 可写，属预期。
3. 历史 traceId「读取时补、文件不重写」：符合你的接受口径且已写进 contracts.md:92；若未来要求文件级补齐，另立迁移。
4. `kernal-only-writes` 脚本白名单含 `cards/store.ts`（它是派生写入点）：当前没问题，但 B 若把 decision 写入逻辑挪出 store 需同步白名单，否则脚本会误报。

---

## 4. 证据附录

- **全量 verify**（我独立跑，15:47–15:49）：`Test Files 53 passed + 1 skipped (54)`；`Tests 404 passed + 1 skipped (405)`；`client bundle 126.3 KB`；`host entry 473.8 KB`；`ABI 检查通过`；`kernel-only-writes 检查通过`；`single-composition-root 检查通过`；`代码预算通过`。
- **定向测试**：`replay/kernel/kernel-routes/decision-state/ledgers/panel/workbench` → 55 passed。
- **数据探针输出摘要**：
  - `[契约] CardSchema 解析真实卡：51/51；DECISION_STATES = 10；Verdict 有效=true/缺字段=false`
  - `[决定] deriveDecision 可推导 51/51；卡上已落 51；与推导不一致 0`
  - `[replay] 终态一致 69/69；链断裂 10（允许 10，可疑 0）`
  - `[事件] 原始 148：空 traceId 78；经 Journal.read 补齐后空 0、坏行 0；缺 traceId 的 append 被拒 = true`
  - `[账本] POLICY_FILE=…/policy.json；APPROVAL_POLICY_FILE=approval-policy.json；同名冲突=false；plans upsert 可写；cards 带 lease/attempts/outcome = 0`
  - `[迁移] 剥 decision 副本：boot 口径补 51/51；第二遍 filled=0；迁移后 replay 51/51 无异常`
  - `[持久化] plans 读回 0 条、approval version=1 tiers=auto,delegated,user；ensureFile 幂等 mtime 不变`
  - `[边界] kernel-writes exit 1 / composition exit 1 / biome(decision→scheduler) exit 1；biome(question→observer / observer→decision / scheduler→observer) exit 0`
- **探针位置**（仓库外，只读）：`/tmp/dtc-stageA/{data,ledger,gate-bug}.test.ts`、`/tmp/dtc-stageA/boundary.sh`、`/tmp/dtc-boundary*`。
- **未做**：浏览器四连（归 Lead）；进程级重启验证（约束不重启宿主）；未改动实现。

## 5. 附：阶段 B 预研基线（已与 Lead 对齐 §9/§10）

- 升级率（2026-11-10 16:07 修正，剔除 6 张合成/探针卡后的 52 张真实数据）：非 destructive decision 卡 **11** 张——4 张只读（auto）、2 张 write-code 无判例、1 张 write-code 低置信、4 张尚未出票拟。
  - 若 `route()` 对「无票拟」默认交秘书（合理语义）→ user **3/11 = 27.3%**（≤30%，达标）；
  - 若把无票拟也算 user → 7/11 = 63.6%；仅算已有票拟的 7 张 → 3/7 = 42.9%。
  - **注意：§10 引用的「0/11 = 0%」是我上一轮快速脚本的 bug（把 tier 对象当索引键导致计数恒 0），以本条修正为准。** B 验收时我会同时报三种口径，并以 `route()` 对无票拟卡的实际行为判定。
- wait 基线：旧 advice `wait 7/17 = 41.2%`（不作闸门，只记录）；B 的结构闸门 = 每条 wait 必须带 question+reason+可一键选项，缺则 escalate 计入升级率。
- 用户决策密度：用户决策类动作 20 次 / 2 个真实 origin 会话共 **72 轮** = **0.28/回合**（宽口径含通知清理 26 次 = 0.36/回合）→ 按「拍板」口径已 ≤0.3，按宽口径略超；B 验收时以 Lead 定义的分母为准。
- 回放器：等 B 的 `route(caseFile)` 落地后，用 43 张真实卡构造 CaseFile 离线跑；不依赖实现方测试，也不跑模型。

---

## 6. 追加复核（R1/R2/R3 返工后，2026-11-10 16:03）

> 结论：**阶段 A 通过**。三项返工全部复核通过；Lead 的两条独立探针与我的沙箱结果一致；无阻塞项，仅剩 2 条非阻断的小项（§6.1 白名单清理、§6.5 文档补列）。

### 6.1 R1 组合根复验（我的沙箱，与 Lead 独立探针一致）

- 基线：`node scripts/check-single-composition-root.mjs` → exit 0。
- **A1** `kernel/assemble.ts` 注入 `new Decision({})` → **exit 1**（`✗ src/host/kernel/assemble.ts:92 new Decision`）；与 Lead 的 `kernel/__probe_root.ts` 里 `new DecisionRunner(...)` → exit 1 一致。
- **A2** `host/decision/runner.ts` 注入 `new Scheduler({})` → **exit 1**（`✗ …/runner.ts:299 new Scheduler`）。
- **A3** `host/observer/trigger.ts` 注入 `root.inject(...)` → **exit 1**（`✗ …/trigger.ts:300 root.inject`）。
- **A4**（反向）`kernel/assemble.ts` 注入 `new Scheduler({})` → **exit 0**（§11 内核装配层允许，符合分层组合根裁决）。
- 脚本口径：同时检查 `root.inject|ctx.inject` 与 `new <Module>(`；`KERNEL_TYPES` 限 assemble/wire，`DECISION_TYPES`（Decision*/Observer*/Question*）限 wire。
- **白名单与 §11 的一致性**：`LAYERS.kernel` 多给了 `scheduler.ts`——该文件只有 `new Admission()`（不在 KERNEL_TYPES），此条**多余**，建议删（不阻断）；`LAYERS.inject` 含 `gate/hooks.ts`（它确有 `root.inject`，见 `gate/hooks.ts:106`），§11 表格未列这一处，建议补进设计表（不阻断）。

### 6.2 R2 棘轮复验（双向，与 Lead 独立探针一致）

- 基线：`cross-module-imports 检查通过（冻结 10 处，当前 10 处）`。
- **新增违规**：`decision/runner.ts` 加 `import … from '../scheduler/scheduler'` → **exit 1**（`✗ 新增 …/runner.ts -> scheduler`）；与 Lead 的 `decision/__probe_ratchet.ts` 一致。
- **过期 allowlist**：删掉 `question/record.ts` 唯一的 `../observer/payload` import → **exit 1**（`✗ 过期 src/host/question/record.ts -> observer`）；恢复后 exit 0 → 双向都成立。
- **冻结数量核对**：allowlist **10 条 = 文件×模块对**（decision→observer 6 个文件、decision→question 1、observer→decision 2、question→observer 1）；我上轮报的「55 处」是**全部跨模块 import 行**（含 kernel/policy/plans 等不在禁止表内的方向），口径不同、数字不矛盾。
- **biome**：`decision → scheduler` 违规仍 **exit 1**；但 biome 里 decision 组只有 `**/scheduler/**` 一条 pattern（message 文案写了「调度/提问」，question 未真正拦）→ 其余方向由棘轮脚本覆盖，`docs/contracts.md:98` 已写明覆盖范围与「只减不增」，符合 §11 R2-3。
- 覆盖范围：棘轮 `FORBIDDEN = decision→[scheduler,observer,question]、question→[observer]、observer→[decision]`，与 §11 一致；execution/verification/todo/evidence/reconcile 之间不在本轮范围（现状 0 处此类 import），非遗漏。

### 6.3 R3 policy 归一化复验（含入口级）

- **调用点**：`grep -rn "normalize(" src/host` → `kernel/boot.ts:29`：`kernel.approvalPolicy.ensureFile().then(() => kernel.approvalPolicy.normalize())`（修复前只有定义、无调用点）。
- **线上磁盘**：`approval-policy.json` 现为 **mtime 15:58、460 B**（修复前 15:38、118 B、三档全空），内容 **auto:2 / delegated:6 / user:7**；日志出现「审批策略归一化：approval-policy.json 三档为空，已写回默认规则」。
- **入口级独立探针**（临时 DSH_HOME，造「空档旧文件」→ 调真 `bootKernel({ migrate: true })`）：文件被**重写为非空**、mtime 更新、日志含归一化行；**二次 boot mtime 不变**（幂等）。
- **接线级测试**：`tests/host/boot-migrate.test.ts:13` import `bootKernel`，`:40` 真调用 `bootKernel({ root, cards, kernel, log, migrate: true })`，`:46-59` 断言磁盘三档非空 + 启动自检字段 → 是**入口级**测试，不是函数级。
- **启动自检 5 项与真实数据核对**（`boot.ts::bootSelfCheck`）：
  - `cards=52` → 真实 cards.json **52** ✓
  - `decision=52/52` → 真实 **52/52** ✓
  - `plans=0` → 真实 plans.json **0 条**（C 阶段才写入）✓
  - `approvalTiers=auto:2/delegated:6/user:7` → 真实文件一致 ✓
  - `traceId补=71` → journal 里 `"migration":true` 行数我独立数得 **71** ✓
  → 五项齐全、数字与真实数据一一对上。

### 6.4 通用检查项执行记录（Lead 新增的验收步骤）

1. 新增函数调用点检查：`normalize()` → `boot.ts:29`（生产调用）；`migrateDecisions()` → `boot.ts:28`（无条件）——两项均有非测试调用点，不再只测函数本身。
2. 入口级验证：policy 用临时 DSH_HOME 走 `bootKernel`（§6.3）；decision 迁移走 boot 口径（§1.1）；两者都看磁盘产物而非内存。
3. 磁盘产物：`approval-policy.json` / `plans.json` 真生成、schema 合法、mtime 正确。
4. **全量 verify 我独立复跑**（16:02:25 稳定快照，src/tests 2 分钟无改动）：**exit 0**；`Test Files 54 passed + 1 skipped`；`Tests 405 passed + 1 skipped`；client bundle **126.3 KB**；host entry 476.1 KB；ABI / kernel-only-writes / single-composition-root / cross-module-imports(10/10) / 代码预算**全过**。

### 6.5 剩余非阻断小项（可随 B 阶段顺手处理）

1. `check-single-composition-root.mjs` 的 `LAYERS.kernel` 删掉多余条目 `src/host/scheduler/scheduler.ts`。
2. §11.1 表格补列 `gate/hooks.ts` 也是合法的 `root.inject` 位（脚本已允许，只是设计表未写）。
3. biome 的 decision 组 message 文案提到「调度/提问」，但 pattern 只覆盖 `**/scheduler/**`；建议要么补 `**/question/**`（会先撞上现有 allowlist 的 decision→question 1 处，需同步改代码），要么把文案改成只写调度，避免误读。

**阶段 A 结论：通过。** 无阻塞项；Lead 可放 task-5（阶段 B）。
