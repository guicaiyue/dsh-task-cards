# 阶段 C 验收（2026-11-10）：调度与执行

> 验收人：card-analyst（只读；本文件为唯一写入；未改 `src/`/`tests/`、未 commit、未重启宿主）。
> 对象：阶段 C 交付快照 2026-11-10 17:03（HEAD `ac80930` + 未提交改动；优化员已报 verify 3 连绿）。
> 判据：Lead 的 C 验收七条（同幂等键不重复 / 依赖+环依赖 / 单 TTL 回收 / plans.json 四段与旧文件兼容 / priority+FIFO+非抢占 / 13 次历史回放 / verify 连跑 2 次）。
> 探针：仓库外 `/tmp/dtc-stageC/`（4 个探针文件 + 遗留文件风险实测），冻结数据集 `/tmp/dtc-stageB/frozen/cards.json`（sha256 `125613df82f61b2022304698adecd0e88514b3073a417d88737bdafaa009aeee`）。
> 浏览器/面板归 Lead；本报告只覆盖调度内核与账本。

## 0. 结论

**通过**（2026-11-10 17:08 返工复验后）。七项必验全部达标：§4 的两处未收口（遗留 plan 崩溃、四段/旧文件兼容）已按 R1/R2/R3 修复并复验通过（见 **§9 返工复验**）；线上 `plans.json` 已被 boot 升级为四段、verify 连跑 2 次绿（427 passed + 3 skipped）。

| # | 必验项 | 判定 |
| :-- | :-- | :-- |
| 1 | 同幂等键不重复（并发 tick / 跨实例重启 / attempt 落盘） | ✅ 通过 |
| 2 | dependsOn 链阻断与放行 + 环依赖永不派发 | ✅ 通过 |
| 3 | 租约：**单 TTL + SKEW** 回收、卡回 waiting、waitReason 落盘 | ✅ 通过 |
| 4 | plans.json 四类数据 / 旧文件缺段兼容 | ✅ 通过（R1/R2/R3 修复，复验见 §9） |
| 5 | priority：urgent 队首、FIFO、非抢占 | ✅ 通过 |
| 6 | 13 次历史 dispatch 回放（6 带键 + 7 旧无键） | ✅ 通过 |
| 7 | verify 连跑 2 次不随机红 | ✅ 通过（返工后 2/2 绿，见 §9.5） |

## 1. 同幂等键不重复 ✅

探针 `/tmp/dtc-stageC/dispatch-dup.test.ts`（临时 cards/journal/plans + 假 adapter）：

| 场景 | 实测 |
| :-- | :-- |
| 同卡 tick 两次 | tick1 dispatched=1，tick2 **0**；adapter 调用 **1**；`plan.attempts` **1**；journal `dispatched` **1**（1:1） |
| 并发 `Promise.all(tick, tick)`（两张不同会话卡） | 合计 dispatched **2**、adapter **2**（无重复；`#running` 互斥 + WIP 各自会话） |
| 跨实例重启（新 `Scheduler` 同一 plans/journal） | dispatched **0**、adapter 总数仍 **1**（靠 plans attempt 键 + journal 键） |

## 2. 依赖 / 环依赖 ✅

- 链：B 的 plan `dependsOn=[A]` → 第一 tick A 派、B 停在 `waitReason=depends-on`；给 A 记 `Outcome{verified:'confirmed'}` 后下一 tick B 派（adapter calls 2，顺序 A→B）。
- 环：A→B、B→A 互相依赖 → tick `dispatched=[]`、adapter **0**、两卡都在 `waiting`（reason `depends-on:<对方>`）→ **永不派发** ✅。

## 3. 租约：单 TTL + SKEW ✅

实现：`plans/store.ts::recoverStaleLeases` 判据 `lease.expiresAt + LEASE_RECLAIM_SKEW_MS(5s) < now`（单 TTL 语义，不再 2×TTL）；调度 tick 调它并把 `leased` 卡 `#move('waiting','lease-expired')`。

| 场景 | 实测 |
| :-- | :-- |
| 租约过期 10s（>SKEW） | `recoverStaleLeases` 返回该 plan；tick `expired=[card]`；journal 有 `leased→waiting` 事件（reason「租约过期，重新排队」）；卡随后同 tick 再派（at-least-once 窗口，新键），attempts 键互不重复 |
| 刚过期 1s（<SKEW） | 回收列表为空（不误杀）✅ |
| waitReason 落盘 | `#move` 写 `lease-expired`；若同会话 WIP 占用则随后由 admission 覆写为可解释原因（`awaiting-receipt`/`wip-limit`），journal 保留回收事件 ✅ |

## 4. plans.json 四类数据 / 旧文件兼容（初次验收 ❌，修复后复验见 §9）

> 本节保留初次验收时的原始发现（作为返工依据）；R1/R2/R3 修复后的复验证据在 §9。

### 4.1 结构口径不一致

- 实现（`plans/store.ts:8-13`）顶层是 **3 段**：`version + plans[] + outcomes[] + verdicts[]`；**`attempts` 嵌套在 `plans[].attempts`**，没有顶层 `attempts` 段。
- Lead 清单写「plans/attempts/outcomes/verdicts 四段」。若指顶层 key → 当前不符；若指「plan/attempt/outcome/verdict 四类数据」→ 满足。**需要裁决并写进 contracts.md**（我建议认可嵌套：attempts 生命周期属于 plan，拆顶层会产生两张表的一致性负担）。
- **线上 plans.json 仍是 3 段旧形状**：`{"version","plans","outcomes","updatedAt"}`（mtime 15:38，size 81B，无 `verdicts`），`ensureFile()` 见文件存在即早退，**boot 不升级遗留文件**；四段只在首次 `recordVerdict` 时才出现。

### 4.2 旧文件字段级兼容有可复现崩溃（真缺陷）

探针 `/tmp/dtc-stageC/legacy-plan.test.ts`：造一份「旧 plan 缺 `attempts`/`dependsOn`」的 plans.json（模拟 C 之前/手工遗留），卡在 waiting，跑 `scheduler.tick()`：

```
[legacy] scheduler.tick threw = TypeError: Cannot read properties of undefined (reading 'length') ; adapter calls = 0
```

根因：`scheduler.ts:107 plan?.dependsOn.length`、`:149 plan?.attempts.some(...)`——`PlansStore.list()` 直接返回原始 JSON，**没有对 plan 做字段缺省归一化**（`attempts ?? []`、`dependsOn ?? []`）。后果：一份遗留 plans.json 会让每轮调度 tick 抛错（boot 里 catch 只记日志，调度停摆）；现场数据 plans 为空所以目前未触发，但「旧文件缺段兼容」这条不成立。
段级（top-level）兼容是好的：`outcomes(planId)`/`verdictsOf(cardId)` 都做了 `?? []` 守卫，旧文件读取不抛错；`recordOutcome` 写入会保留 plans 并补 `outcomes` 段（探针：旧文件 1 plan + 写 outcome → plans=1、outcomes=1）。

### 4.3 损坏自愈 ✅（此子项通过）

截断 / 非法 JSON / 空文件三态：`list()` 不抛错、返回空账本、生成 `.bad-*` 备份；`cards.json` 与 journal 不受影响（探针实测 4/4）。

### 4.4 返工点（预估 15 分钟）

1. `PlansStore.list()`（或 `JsonDoc` 读后）对 plan 做缺省归一化：`attempts: plan.attempts ?? []`、`dependsOn: plan.dependsOn ?? []`（可连同 `acceptance ?? []`）。
2. boot 增加一次 `plans.normalize()`（类比 `approvalPolicy.normalize()`）：遗留文件补齐 `verdicts: []` 等段并写回；或至少 `ensureFile()` 对已存在但缺段的文件做一次补齐。
3. 文档裁决「attempts 顶层段 vs 嵌套」并写进 `contracts.md`。
4. 补测试：旧形状 plans.json（缺 verdicts / plan 缺 attempts+dependsOn）→ `boot`/`tick` 不抛错、段被补齐。

## 5. priority / urgent / 非抢占 ✅

- `queue.ts::orderCandidates` 排序：plan priority 降序 → severity → createdAt FIFO；`scheduler` 传入 `plans.byCard(id).priority`。
- 探针：三卡（normal-A、normal-B、urgent-C，urgent priority=1）→ dispatched 顺序 **urgent → A → B**（urgent 队首 + 同优先级 FIFO）✅。
- 非抢占：同会话已有在飞卡（dispatched）时，同会话 urgent 卡本 tick **不派**（dispatched=[]、adapter 不变），waitReason 落为可解释的 `awaiting-receipt`（admission 依据在飞卡状态）✅。

## 6. 13 次历史 dispatch 回放 ✅

数据：冻结数据集 journal（70 文件）内 `to=dispatched` 事件 **13 条**；其中 **6 条带 `meta.idempotencyKey`**（C/B 期），**7 条是 C 之前的旧事件无键**（单列，不进闸门）。

- 带键 6/6：seed plans attempts（id=历史幂等键）→ scheduler tick 全部拦截（dispatched=0、adapter=0）✅。
- 无键 7 条：已按 Lead 定调「旧无键事件不参与幂等」单列，不参与严格回放（列：c-mw958oku-1jz、c-mw958okz-2s2、c-mw958ol4-3gt ×2 事件、c-mw96uno7-b0a、c-mw99xnke-169、c-mw99xnkw-32b）。
- 数据集 sha256 与 Lead 绑定值一致：`125613df…aeee`（52 卡 → 真实 46 → 真实 decision 15 → 非 destructive 11 → 有票拟 7）。

## 7. 全量 verify（独立跑，连跑 2 次）✅

| 运行 | 结果 |
| :-- | :-- |
| RUN 1（17:02） | **57 files passed + 3 skipped**；**425 passed + 3 skipped**；client bundle **126.9 KB**；ABI/三脚本/预算全过 |
| RUN 2（17:03） | 同 RUN 1：**425 passed + 3 skipped**，bundle 126.9 KB |

**历史偶发说明（透明）**：在 B 收口中（16:36）与 C 收口后期（17:00）我各有 1 次全量出现 `turn-gate.test.ts > 券的宽限期` 同一断言失败；两次都发生在实现方连续改 `gate/allow.ts`、`plans/store.ts` 等文件的时间窗内；隔离重跑该文件 **8/8 通过**，稳定后全量 2/2 绿。判定为「改码期间 + 用例对全局券状态仍敏感」的偶发，不阻断 C，但建议：该用例在 `afterEach` 显式 `clearAllows()`（现在 `clearAllows` 仅在 `gate.reset()` 中被 setup 调用，测试文件 import 了却没用），并在 D 阶段保持全量连跑 3 次的习惯。

## 8. 结论与返工清单（初次验收，17:00）

> 下列 R1/R2/R3 已于 17:08 前修复并复验通过，最终结论见 §9.6。

**初次判定：不通过**，仅因 **§4 plans.json 四段结构 / 旧文件兼容**：
- **R1（必修，15 分钟）**：`PlansStore.list()` 对 plan 缺省字段归一化（`attempts/dependsOn` 至少），修掉遗留 plan → `scheduler.tick` TypeError。
- **R2（必修，10 分钟）**：boot 对已存在的 plans.json 做一次段补齐（`verdicts: []` 等），使线上 15:38 的旧文件升级到四段；或明确「首次写入才补段」并写进 contracts。
- **R3（裁决/文档）**：`attempts` 顶层段 vs 嵌套的定调；建议保留嵌套并在 contracts.md 写明。
- **观察（不阻断）**：turn-gate 用例对全局券状态仍敏感（历史 2 次偶发，稳定后 2/2 绿）；建议 afterEach 清券。

其余六项（幂等/依赖/环依赖/租约/priority/13 次回放/verify 2 连绿）全部达标，R1/R2 修完后可直接开 D。

---

## 9. 返工复验（R1/R2/R3，2026-11-10 17:08）

> 结论：**阶段 C 通过**。三项返工全部修复，我的独立探针 + 磁盘产物 + verify 2 连跑均已复验。

### 9.1 R1 遗留 plan 崩溃 → 已修 ✅

- 代码：`plans/store.ts::list()` 对 plan 做缺省归一化（`acceptance/lease/dependsOn/attempts`），`normalize()` 同步写回。
- 探针 `/tmp/dtc-stageC/legacy-plan.test.ts`（旧形状 plan 缺 attempts/dependsOn + 卡 waiting）：
  ```
  [legacy] scheduler.tick threw = none ; adapter calls = 1
  [legacy] 归一化后 attempts = [] ; dependsOn = []
  ```
  → tick 不抛错且正常派发；上次的 `TypeError: Cannot read properties of undefined (reading 'length')` 不再出现。
- 他补了对应回归测试（新 `plans-boot-normalize.test.ts` 等），verify 中通过。

### 9.2 R2 线上 plans.json 磁盘升级 → 已修 ✅

- `boot` 已接线 `kernel.plans.normalize()`（日志「计划账本归一化」），对已存在旧文件补段写回。
- 真机磁盘（宿主数据目录）实测：
  - **修改前**：keys `["version","plans","outcomes","updatedAt"]`（3 段，81B，15:38）
  - **修改后**：keys `["version","plans","outcomes","verdicts","updatedAt"]`（**四段齐全**，99B，mtime **17:04:59**）
- 探针「旧文件缺段兼容」复跑：旧文件（无 outcomes/verdicts、plan 无 attempts）读取不丢 plans、`attempts` 归一为 `[]`、写 outcome 后 plans 保留、outcomes 段出现。

### 9.3 R3 attempts 嵌套口径 → 已裁决并落文档 ✅

- `docs/contracts.md:104-106` 新增「plans.json 四类数据（阶段 C 裁决 R3）」：**attempts 嵌套在 `plans[]` 内，不设顶层 attempts 段**（它属于 plan 生命周期），并说明 plan/lease/attempt/priority/dependsOn/idempotencyKey/result/outcome 全落盘、幂等键语义。
- 与实现一致（`PlansStore` 顶层 `plans/outcomes/verdicts`，attempts 在 plan 内）。

### 9.4 测试隔离顺手修复 ✅

- `tests/host/turn-gate.test.ts` 已有 `afterEach(() => clearAllows())`（注释写明「券存在 globalThis，同 worker 多测试文件共享，必须每个用例后清空」）；放行日志的 cardId 从券取。
- 我此前报的偶发（2 次全量中 `券的宽限期` 断言）在修复后未再复现。

### 9.5 verify 连跑 2 次 ✅

| 运行 | 结果 |
| :-- | :-- |
| RUN 1（17:07） | **58 files passed + 3 skipped**；**427 passed + 3 skipped**；client bundle **126.9 KB**；ABI / kernel-only-writes / single-composition-root / cross-module-imports(10/10) / 预算全过 |
| RUN 2（17:07） | 同 RUN 1：**427 passed + 3 skipped**，bundle 126.9 KB，全脚本通过 |

### 9.6 其余项抽验（保持通过）

返工后重跑全套 C 探针（`/tmp/dtc-stageC`，12 用例全绿）：
- 同幂等键不重复：tick×2 只派 1（attempts=1、journal dispatched=1）；并发两卡各 1；跨实例重启 0 派发。
- dependsOn 链：未 confirmed 停在 `depends-on`，confirmed 后派；**环依赖 A↔B 永不派发**。
- 租约：过期 10s（>5s SKEW）即回收、journal 有 `leased→waiting`「租约过期」；刚过期 1s 不误杀。
- priority：urgent → normal-A → normal-B；同会话在飞时 urgent 不打断。
- 13 次历史回放：冻结数据集 sha256 `125613df…aeee`；6 条带键 6/6 拦住，7 条旧无键单列。

**最终结论：阶段 C 通过。** 无阻塞项；可放 task-7（阶段 D）。
