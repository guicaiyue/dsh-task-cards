# M0 + M1 开发详细设计

> 范围：**只做 M0（契约与内核）+ M1（调度收口 + Todo + 三个检查器）**，M2（语义验收）与 M3（时间线 UI）不在本轮。
> 依据：[A-core 方案](A-CORE-PLAN.md) · [Todo 与对账](TODO-RECONCILE.md) · [证据模型](EVIDENCE-MODEL.md)。
> 环境：全部开发/测试/验证在 `dsh-dev` 容器内（`docker compose exec dsh bash`），宿主仓库直挂。

---

## 1. 目标与完成判据

M0 + M1 做完时，系统应当能：

1. 每张卡有稳定的 `traceId` 与完整 `CaseEvent` 流水，**所有状态变更只走 `transition()`**；
2. 重启后 `replay(journal) === 卡片快照`（不依赖日志拼接）；
3. 同一会话并发批准不再双投（`decisionSeq` CAS + WIP=1 + 租约）；
4. 每个"等一下"都有 `waitReason`，面板/接口能读到；
5. 派发时给会话一份 Todo 清单；执行者更新清单要留事件与证据；
6. 三个确定性检查器（exit / file / http）能产出 `EvidenceRecord` 并写进执行账；
7. 对账能对"确定性证据成立"的卡直接失效（留痕、可重开）。

**不做**：语义判定、system adapter 全量、多会话公平调度、时间线 UI、通知工作台。

---

## 2. 目录与模块边界（改动面）

```text
src/shared/
  contract.ts        +编号 ①：新增枚举与卡字段（全部带 default，旧数据可解析）
  case.ts            ★ 新：阶段/投递状态、迁移表、transition()、replay()（纯函数，无 Node）
  state.ts           只加「从 card 派生阶段」的只读辅助（不改现有导出行为）
src/host/
  kernel/            ★ 新
    trace.ts         traceId 生成与校验
    journal.ts       append-only JSONL：$DSH_HOME/dsh-task-cards/journal/<caseId>.jsonl
    transition.ts    唯一写入口：读卡 → 验 CAS/迁移 → 落事件 → 写快照 → 返回结果
    migrate.ts       旧卡补 traceId / deliveryState / decisionSeq（幂等，可回滚）
  scheduler/         ★ 新
    queue.ts         就绪集、排序、waitReason 计算
    admission.ts     WIP=1 / 非抢占 / 租约 / CAS 前置检查
    scheduler.ts     tick：扫 open 卡 → 准入 → dispatch → 收结果（替掉 scanner 的到点执行职责，保留 auto 卡兼容）
  execution/         ★ 新
    adapter.ts       ExecutionAdapter 接口（system/session）
    session.ts       session adapter：包现有 question/answer + deliver
  todo/              ★ 新
    store.ts         plans/<planId>/todo.json 读写 + 事件
    contract.ts      TodoItem/TodoList 类型（zod 在 shared/contract.ts）
  evidence/          ★ 新
    types.ts         EvidenceRecord 白名单
    exit.ts file.ts http.ts   三个检查器（纯异步函数，超时 10s）
src/host/routes/
  case.ts            ★ 新：GET /case/:id（含 events/todo/evidence 摘要）
  reconcile.ts       ★ 新：POST /reconcile（扫会话、判定、失效）
tests/
  shared/case.test.ts        状态机穷举 + replay 确定性
  host/kernel.test.ts        transition CAS / 拒绝迁移 / 事件落盘
  host/scheduler.test.ts     WIP=1 / 非抢占 / waitReason
  host/todo.test.ts          基线冻结 / 删项复核 / 完成率
  host/evidence.test.ts      三种检查器的成功/失败/超时
```

**边界规则**（沿用 AGENTS.md）：模块之间只经 `shared/*` 与 `host/kernel/*`；`wire.ts` 是唯一组合根；单文件 ≤300 行、函数 ≤60 行。

---

## 3. 契约增量（全部向后兼容）

### 3.1 枚举

```ts
export const CASE_PHASES = ['sense', 'decide', 'execute', 'verify', 'closed'] as const
export const DELIVERY_STATES = [
  'idle', 'waiting', 'leased', 'dispatched', 'executed',
  'verifying', 'confirmed', 'failed', 'unknown', 'invalidated',
] as const
export const WAIT_REASONS = [
  'awaiting-decision', 'awaiting-user-escalation', 'queued', 'session-busy',
  'wip-limit', 'awaiting-receipt', 'awaiting-verification', 'preempted',
  'lease-expired', 'retrying',
] as const
export const ACTORS = ['observer', 'decision', 'scheduler', 'executor', 'verifier', 'user', 'system'] as const
export const AUTHORITIES = ['delegated', 'user', 'system'] as const
```

### 3.2 Card 新增字段（都有默认值）

| 字段 | 类型 | 默认 | 作用 |
| :-- | :-- | :-- | :-- |
| `traceId` | string | 迁移时生成 | 全链路 id |
| `decisionSeq` | int | 0 | CAS 令牌（随决定相关变化递增） |
| `deliveryState` | 枚举 | `'idle'` | 投递/执行/验收状态 |
| `waitReason` | 枚举 \| null | null | 为什么在等 |
| `authority` | 枚举 \| null | null | 谁批的 |
| `invalidatedReason` | string \| null | null | 失效原因（对账） |

### 3.3 CaseEvent（zod，落 journal）

```ts
{
  id, caseId, traceId, at, phase,
  from, to, actor, authority, reason,
  evidenceRefs: string[], policyVersion: number,
  attempt?: number, meta?: Record<string, unknown>
}
```

---

## 4. 状态机（`shared/case.ts`，纯函数）

### 4.1 迁移表（M1 只做这些）

| from → to | 触发 | actor |
| :-- | :-- | :-- |
| `idle → waiting` | 计划入队 | scheduler |
| `waiting → leased` | 通过准入 | scheduler |
| `leased → dispatched` | 适配器已投递 | scheduler |
| `leased → waiting` | 租约过期/被抢占 | scheduler |
| `dispatched → executed` | 收到 ExecutionResult | executor |
| `dispatched → unknown` | 超时无回执 | scheduler |
| `executed → verifying` | 开始验收 | verifier |
| `verifying → confirmed / failed / unknown` | 判定 | verifier |
| `confirmed/failed/unknown → idle` | 重试/补偿 | scheduler |
| `any → invalidated` | 对账（确定性证据） | system |
| `invalidated → idle` | 重开 | user |

### 4.2 API

```ts
export function canTransition(from: DeliveryState, to: DeliveryState, actor: Actor): boolean
export function transition(input: TransitionInput): TransitionResult   // ok | { code, reason }
export function replay(events: CaseEvent[]): { deliveryState: DeliveryState; phase: Phase }
```

`transition()` 不碰存储、不碰时间；`at`、`id` 由调用方注入，保证可测。

---

## 5. 内核写入口（`host/kernel/`）

### 5.1 journal

- 路径：`$DSH_HOME/dsh-task-cards/journal/<caseId>.jsonl`；
- 写：`appendFile` + 进程内串行链（同 `JsonDoc` 的 `#chain` 思路），失败抛错由上层记录；
- 读：按行解析，坏行跳过并计数（面板可见 warning）；
- 保留：按设置裁剪（默认 200 条/卡）。

### 5.2 transition（唯一写入口）

```ts
async function apply(input: {
  cardId: string
  to: DeliveryState
  actor: Actor
  authority: Authority
  reason: string
  expectedSeq?: number        // CAS：不匹配 → 409
  expectedState?: DeliveryState
  evidenceRefs?: string[]
  meta?: Record<string, unknown>
}): Promise<{ card: Card; event: CaseEvent }>
```

规则：

1. 读当前卡 → 校验 `expectedSeq === card.decisionSeq`、`expectedState === card.deliveryState`（不匹配抛 `StoreError('CAS_CONFLICT')`）；
2. `canTransition` 校验；
3. 生成事件、append journal；
4. **同一事务内**更新卡快照（`decisionSeq += 1`，写 `deliveryState/waitReason/...`）并落盘；
5. 落盘失败 → 事件标记 `failed` 并抛出（宁可多一条失败事件，不可少一条成功事件）。

### 5.3 迁移

启动时扫一遍卡：缺 `traceId` 补 `tr-` + base36；缺 `deliveryState` 按旧状态映射（`scheduled→waiting`、`done→confirmed`、`dismissed→idle`…），写一条 `migrate` 事件。迁移幂等，可用 `--rollback` 参数从备份恢复。

---

## 6. 调度（`host/scheduler/`）

### 6.1 tick 顺序

```text
load cards → 失效对账（可选，见 §8）→ 计算就绪集
  → for each session（串行）:
      WIP 检查：该会话在飞 plan 数 ≥ 1 → waitReason='wip-limit'，跳过
      非抢占：有 dispatched 未回执 → waitReason='awaiting-receipt'，跳过
      租约：leased 超 TTL(90s) → 回收，waitReason='lease-expired'
      CAS 通过 → 落 lease → dispatch(adapter) → 写 dispatched
  → 收结果：executed / unknown
```

### 6.2 waitReason 计算（纯函数，可测）

优先级：`awaiting-decision` > `awaiting-user-escalation` > `wip-limit` > `session-busy` > `awaiting-receipt` > `queued`。

### 6.3 与现有 scanner 的关系

- 先保留 `scanner.ts` 处理 `kind=auto` 的旧路径（不破现有行为）；
- 新 `scheduler.ts` 只管"有 ApprovedPlan 的卡"；M1 结束时两者共存，M2 再合并。

---

## 7. Todo 与检查器

### 7.1 Todo

- 文件：`$DSH_HOME/dsh-task-cards/plans/<planId>/todo.json`；
- 更新接口（host 内部）：`updateTodo(planId, ops[], actor)`，每次写 `todo.updated` 事件；
- 基线：执行者第一次更新时提交 `baselineIds`，秘书确认后 `frozen=true`；冻结前不计完成率；
- 删除/改写基线项：`ops` 里带 `reason`，写 `todo.review` 事件，卡进入"待复核"（M2 才接判定）。

### 7.2 三个检查器（M1 只做这三个）

```ts
type Checker =
  | { kind: 'exit'; cmd: string; expect: number }
  | { kind: 'file'; path: string; expect: 'exists' | 'absent' }
  | { kind: 'http'; url: string; expect: number }

async function runChecker(c: Checker, ctx: { cwd: string; timeoutMs: number }): Promise<EvidenceRecord>
```

- 统一 10s 超时；超时 → `{ ok: false, kind: 'timeout' }`，不重试；
- `file` 额外算 sha256（≤2MB 才哈希，大文件只记大小）；
- `http` 只允许 http/https，禁止内网地址（SSRF）——白名单从设置读；
- 每条 EvidenceRecord 落 `evidence/<planId>.jsonl`，卡上只存 `evidenceRef`。

---

## 8. 对账与失效（M1 的确定性部分）

- 触发：启动时 + 面板手动（`POST /reconcile`）；
- 判据（只做确定性）：产物已存在（file/http）、后续轮次出现同类 commit（git log 可选）、`superseded`；
- 动作：`transition(any → invalidated, actor=system, reason=证据摘要)`，写 `evidenceRefs`；
- 护栏：只对 `read/write-code/external` 生效（destructive/spend 只提议），可重开；
- 汇总：`POST /reconcile` 返回 `{ scanned, invalidated[], stale[], unchanged }`。

---

## 9. 测试清单

| 文件 | 用例 |
| :-- | :-- |
| `tests/shared/case.test.ts` | 迁移表穷举（允许/拒绝）；replay 与逐步 transition 结果一致；未知事件不改变状态 |
| `tests/host/kernel.test.ts` | CAS 冲突 409；状态不匹配 409；事件落盘顺序；坏行跳过；replay === 快照 |
| `tests/host/scheduler.test.ts` | WIP=1；非抢占；租约过期回收；waitReason 优先级 |
| `tests/host/todo.test.ts` | 基线冻结；冻结前不计完成率；删基线项触发 review |
| `tests/host/evidence.test.ts` | exit 0/非 0；file 存在/缺失/超时；http 200/500/内网拒绝 |
| `tests/host/reconcile.test.ts` | 产物存在 → invalidated；destructive 只提议；可重开 |

---

## 10. 开发顺序（按依赖，不按功能热度）

| 步骤 | 内容 | 产出 | 预计 |
| :-- | :-- | :-- | :-- |
| S1 | 契约增量 + `shared/case.ts` + 穷举测试 | 可 `replay` 的纯状态机 | 0.5 天 |
| S2 | `kernel/journal` + `transition` + CAS 测试 | 唯一写入口 | 1 天 |
| S3 | `migrate` + 启动接线（只读不派发） | 旧卡可读、可观察 | 0.5 天 |
| S4 | `scheduler`（WIP/租约/waitReason）+ 测试 | 队列与准入 | 1.5 天 |
| S5 | `execution/session adapter` + dispatch 接现有投递 | 派发走适配器 | 1 天 |
| S6 | `todo` store + 事件 | 清单可写可读 | 1 天 |
| S7 | `evidence` 三检查器 + 路由 | 证据可产 | 1 天 |
| S8 | `reconcile` 确定性部分 + 路由 | 失效可跑 | 0.5 天 |
| S9 | 容器内联调 + 浏览器走查 + `pnpm verify` | 可验收 | 1 天 |

合计约 **8 个工作日**（1 人）。

---

## 11. 回滚与开关

- 环境变量 `DTC_KERNEL=off`：只跑旧路径（scanner + 直接投递），新内核不接管；
- 迁移前自动备份 `cards.json.bak-<ts>`；
- 新路由只读为主，写操作（reconcile/todo）失败不影响旧流程；
- 每一步 S1–S9 都可独立合并，未完成的模块不进 `wire.ts`。

---

## 12. 验证方式

1. 单测：`pnpm test`（新增 ≥6 个文件）；
2. 全量：`pnpm verify`（lint + typecheck + test + build + ABI + 预算）；
3. 容器验收：`dsh-dev` 里跑真实宿主，打开 `http://192.168.1.4:3080`，走查：
   - 造 3 张同会话卡 → 并发批准 → 只投一次；
   - 重启容器 → 卡状态与事件一致；
   - 手动 `POST /reconcile` → 失效一张已完成卡 → 可重开；
   - 详情接口返回 events/todo/evidence 摘要（UI 在 M3 才渲染）。


---

## 13. 实现状态（2026-11-09）

**S1–S9 已完成**，全部在 `dsh-dev` 容器内开发与验证。

### 13.1 落地文件

| 步骤 | 文件 | 说明 |
| :-- | :-- | :-- |
| S1 | `src/shared/case-contract.ts`、`src/shared/case.ts`、`tests/shared/case.test.ts` | 枚举、迁移表、`transition()`、`replay()`、waitReason 优先级；10×10 矩阵穷举 |
| S1 | `src/shared/contract.ts`、`config-contract.ts` | 卡新增 `traceId/decisionSeq/deliveryState/waitReason/authority/invalidatedReason`；为守 300 行拆出配置文件 |
| S2 | `src/host/kernel/journal.ts`、`transition.ts`、`tests/host/kernel.test.ts` | 事件先落盘、CAS 409、失效/重开、replay 一致；另加 `noteCase()` |
| S3 | `src/host/kernel/migrate.ts`、`src/host/index.ts` | 旧卡补字段（幂等、备份）；`VITEST` 下不由装配触发 |
| S4 | `src/host/scheduler/{queue,admission,scheduler}.ts`、`tests/host/scheduler.test.ts` | WIP=1、非抢占、租约回收、派发失败退回、优先级 |
| S5 | `src/host/execution/{adapter,session}.ts` | session adapter 复用 `question/answer`；`dispatchTextOf` 决定发什么 |
| S6 | `src/shared/todo.ts`、`src/host/todo/store.ts`、`tests/host/todo.test.ts` | 基线冻结、完成率只按基线、删基线项必须给理由 |
| S7 | `src/shared/evidence.ts`、`src/host/evidence/{checkers,store}.ts`、`tests/host/evidence.test.ts` | exit/file/http；10s 超时；HTTP 默认拒绝内网 |
| S8 | `src/host/reconcile/reconcile.ts`、`tests/host/reconcile.test.ts` | `superseded-by` 确定性失效，可重开 |
| S9 | `src/host/routes/{case,todo,evidence,reconcile}.ts`、`tests/host/kernel-routes.test.ts` | 四条新路由 + 宿主装配联调（DTC_KERNEL=on） |

### 13.2 与设计的偏差（都已落注释）

1. **planId = cardId**：M1 一张卡同时只有一份计划，不额外引入 plan 实体；M2 加 retry 再拆。
2. **新增 `noteCase()`**：等待原因是"注释"不是"迁移"，但同样先落事件；否则 `waiting → waiting` 会被状态机拒绝。
3. **迁移开关**：`VITEST` 环境不触发装配期迁移（测试清理临时目录会与后台写盘打架），迁移逻辑由 `kernel.test` 直接覆盖。
4. **批准入队受 `DTC_KERNEL=on` 控制**：默认仍是旧路径（直接投递），保证现有 24 个面板/审批用例不受影响。
5. **路由用 `?id=`**：与现有全部路由一致，不引入路径参数。
6. **证据上限 5 条/次**、**HTTP 默认拒绝内网**（SSRF），都写在路由与检查器里。

### 13.3 验证结果

- `pnpm verify` 全绿：**35 个测试文件 / 251 个测试**；typecheck、lint、build、ABI、代码预算全过。
- 客户端 bundle **130.7 KB**（预算 150 KB）：M1 全在宿主侧，未推高前端。
- 连续 4 次全量测试稳定通过（期间修掉两个并发写盘竞态：临时文件名跨实例冲突、测试清理与后台迁移竞争）。
- 容器内 `pnpm build` 后 HMR 重载正常，日志无「路由注册失败」；dev 数据目录为空，迁移未触发（属预期）。
- 容器内 HTTP API 需要登录态（401），故路由行为由 `kernel-routes.test.ts` 在测试宿主里覆盖。

### 13.4 如何启用与回滚

```bash
# 启用内核接管派发（调度 / 入队 / 对账）
# 在 dsh-dev 的 compose 服务里加环境变量后重启：
#   environment:
#     DTC_KERNEL: "on"
docker compose up -d dsh

# 回滚：去掉环境变量并重启即可，旧路径（scanner + 直接投递）原样保留
```

### 13.5 留给 M2 / M3

- M2：验收读 todo + 证据 → confirmed/failed/unknown；语义项一次单发判定；C 类代价变高交决策者。
- M3：面板「执行清单」段、失效态、对账入口、记录屏（原型已在 [prototype/](prototype/)，按本设计接线即可）。


---

## 14. M2 实现状态（2026-11-09 续）

### 14.1 落地

| 文件 | 作用 |
| :-- | :-- |
| `src/shared/outcome.ts` | `VerifiedState` / `VerifyAction` / `CriterionResult` / `VerificationOutcome` |
| `src/host/verification/verify.ts` | 纯判定：阻塞或代价变高 → 升级；证据不过 → 重试/升级；清单落后 → 补更新一次；全绿 → 确认；空 → 判不了 |
| `src/host/verification/verifier.ts` | 执行器：数返工次数 → 判定 → `verifying` → `confirmed/failed/unknown`，B 类退回队列、C 类升级 |
| `src/host/verification/index.ts` | 模块出口 |
| `src/host/routes/verify.ts` | `POST /verify`（手动验收，也供面板/测试） |
| `tests/host/verification.test.ts` | 9 个用例：4 类判定 + 执行器的四类结局 |
| 装配 | `assembleKernel` 注入 `Verifier`；`DTC_VERIFY=on` 时 scheduler 派发成功自动跑验收 |

### 14.2 三条验收路径（与设计一致）

1. **A 异常中断 / 证据不过**：`failed`，返工次数 <1 → 退回队列重试；否则 `escalate`。
2. **B 清单落后**：`failed` + `continue-session`，退回队列并写 `meta.verifyRetry=true`；**只给一次**。
3. **C 代价变高 / 阻塞**：`unknown` + `escalate`，卡 `waitReason=awaiting-user-escalation`，等决策者。
4. **全绿**：`confirmed`；**都没有**：`unknown + inconclusive`，并标记 `semanticNeeded=true`（语义判定留给后续，不默认调模型）。

### 14.3 验证

- `pnpm verify` 全绿：**36 个测试文件 / 262 个测试**；预算、ABI、bundle（130.7 KB）均通过。
- 开关：`DTC_VERIFY=on` 才自动验收；不带该变量时 M1 行为不变（派发后停在 `dispatched`）。

### 14.4 留给 M3

面板接线：详情弹窗加「执行清单 / 证据 / 验收结论」块（数据来自 `GET /case`），工作台加失效态与对账入口，新增记录屏。原型见 [prototype/](prototype/)。


---

## 15. M3 实现状态（2026-11-09 续）

### 15.1 已接线（精简版）

| 位置 | 内容 |
| :-- | :-- |
| `src/client/components/CaseChecklist.tsx` | 详情弹窗里的案卷块：验收结论徽标、清单进度、逐项状态（done/doing/pending/blocked/skipped）、阻塞原因、代价↑、证据摘要、失效原因 |
| `src/client/styles-case.ts` | 案卷块样式（单独注入，主样式文件仍 ≤300 行） |
| `src/client/api.ts` | `fetchCase(id)`（GET /case）、`reconcile()`（POST /reconcile） |
| `src/client/hooks/useDetail.ts` | 打开详情时并行拉 timeline 与案卷，失败互不影响 |
| `src/client/components/DetailModal.tsx` | 案卷块渲染在票拟之上、时间线之前 |
| `src/client/components/CardMeta.tsx` | `deliveryState=invalidated` 显示「已失效」徽标 |
| `src/client/components/PanelHeader.tsx` + `hooks/usePanelState.ts` | 顶部「对账」按钮：调 POST /reconcile 后刷新，失败写错误条 |
| `src/client/locale/{zh,en}.ts` | 16 个新文案键 |
| `tests/client/case-checklist.test.tsx` | 3 个用例：清单/证据/失效徽标 |

### 15.2 记录屏（本轮补齐）

| 位置 | 内容 |
| :-- | :-- |
| `src/host/kernel/journal.ts` | `recent(limit)`：跨卡事件，最多扫 200 个文件，返回 `truncated` |
| `src/host/routes/records.ts` | `GET /records?limit=`（默认 100，上限 300） |
| `src/client/hooks/useRecords.ts` | 进入 tab 时拉一次；loading / error / 空态 |
| `src/client/components/RecordsTab.tsx` | 行：时间 · 阶段徽标 · 卡标题（找不到卡时退化成 caseId）· 原因 · traceId · 「打开」 |
| `src/client/styles-records.ts` | 独立注入的样式 |
| `tests/client/records-tab.test.tsx` | 2 个用例：字段展示、点打开回调 |
| `tests/host/kernel-routes.test.ts` | 新增 `/records` 往返用例 |

**仍未做**：工作台卡片行内联清单进度（需要行内空间与预算，留到下一轮）。

### 15.3 验证

- `pnpm verify` 全绿：**38 个测试文件 / 268 个测试**。
- 客户端 bundle **146.1 KB**（预算 150 KB；记录屏 +6.4 KB，只剩约 4 KB 余量，下一轮 UI 前要先腾预算）。
- 容器内 `pnpm build` 后 HMR 重载正常，无路由注册错误。
- `http://192.168.1.4:3080/` 返回 401（需要 DSH 登录态），因此浏览器走查需由已登录的浏览器完成；面板行为由组件测试覆盖。


---

## 16. 客户端减重 + 行内进度（2026-11-09 续）

### 16.1 减重：开启客户端压缩

`tsdown.config.ts` 的客户端构建加 `minify: true`（宿主侧保持未压缩，方便读日志与堆栈）。

| 指标 | 减重前 | 减重后 |
| :-- | :-- | :-- |
| `lib/client.js` 原始体积 | 149.6 KB | **105.2 kB**（tsdown 计数）/ **102.7 KB**（预算脚本计数） |
| 预算占用 | 146.1 / 150 KB（余 3.9 KB） | **102.7 / 150 KB（余 47.3 KB）** |
| gzip | — | 26.3 kB |

ABI 断言全部仍通过（`__ModuleLoader__.load`、`id`、`factory(require)`、`exports.apply`、sourceMappingURL）——压缩不会破宿主加载契约。

**没有做的事**：没有调高预算阈值，也没有拆分语言包/懒加载；压缩已经腾出足够空间，后续真需要再拆。

### 16.2 行内进度（用腾出的空间做）

| 位置 | 内容 |
| :-- | :-- |
| `src/host/todo/store.ts` | `listSummaries()`：扫所有 `todo/*.json`（上限 500），返回 `caseId → {done,total,frozen}` |
| `src/host/routes/progress.ts` | `GET /progress` |
| `src/client/api.ts` | `fetchProgress()` |
| `src/client/hooks/useCards.ts` | 加载卡片时并行拉进度；失败不挡主流程（空对象） |
| `CardRow` / `TreeNode` / `CardsTab` | 卡片行显示 `1/2 完成` 徽标（仅冻结清单才有） |
| `styles-case.ts` / locale | 徽标样式与文案 |
| 测试 | `/progress` 路由用例 + `CardRow` 有/无进度两种渲染 |

### 16.3 验证

- `pnpm verify` 全绿：**38 个测试文件 / 270 个测试**。
- 客户端 bundle **102.7 KB**（预算 150 KB，余 47 KB）。
- 容器内 `pnpm build` 后 HMR 重载正常，日志无路由注册错误。
- 顺带修：`register.ts` 的路由表拆成 `cardRoutes / kernelRoutes / panelRoutes`，`cardRoutes` 回到 60 行内。

### 16.4 后续 UI 的预算规则

- 单个 UI 增量先控制在 **≤10 KB**，加完跑一次 `pnpm budget`；
- 再贴上限时优先做懒加载/拆分，不调阈值；
- 客户端 `minify` 已开，新增代码按压缩后体积估算。


---

## 17. 真实需求验收（2026-11-09）

用「部署 Home Assistant + 集成小米」跑了一遍真实链路，详细结果见 [HA-SCENARIO.md](HA-SCENARIO.md)。

- 需求侧：HA 容器运行在宿主 `/vol1/1000/docker/homeAssistant`，Xiaomi Home 集成已装（v0.5.0），仅剩用户账号登录。
- 任务卡侧：真实证据下「部署」判 confirmed、「小米登录」判 unknown 并升级；顺带修了 HTTP 检查器跟随重定向、测试环境变量污染两个问题。
- 已知交互缺口：无 `origin.sessionId` 的卡批准后走旧路径直接 done（不进内核事件），面板应显式提示。

---

## 18. 面板七屏重构（2026-11-10）

把面板从「四页签 + 详情弹窗」重做成原型里的七屏，入口仍是 DSH 侧栏「任务卡」。

### 18.1 七屏落点

| 屏 | 实现 | 关键内容 |
| :-- | :-- | :-- |
| 工作台 | `components/WorkbenchTab.tsx` | 5 KPI（待我决定/秘书代批/执行中/待验收/需关注）+ 6 个过滤（含已关闭）+ 会话/平铺切换 + 会话分组头（卡数、待处理、最近活动、打开会话）+ 富卡片行 |
| 卡片详情 | `components/DetailTab.tsx` + `DetailSegments.tsx` | 五段：决定（票拟/采纳/返工）、计划（等待原因/影响/动作）、执行清单（绿点）、执行（状态机事件流 + 会话尾部轮次）、验收（证据）；可跳会话屏 |
| 失败排查 | `components/FailureTab.tsx` | 只列 failed/unknown；顶部结论条（判成什么/谁判的/原因/下一步）+ 要求·实际·判定三栏 |
| 策略与模板 | `components/PolicyTab.tsx` | 三个内置验收模板（exit/file/http）+ 三层判定（confirmed/failed/unknown）+ 当前阈值表单 |
| 记录 | `components/RecordsTab.tsx` | 阶段过滤 + trace/卡名/原因检索 + 打开卡片详情 |
| 设置 | `components/SettingsTab.tsx` | 六组（总开关/决策者/观察者/预算超时/保留隐私固定策略/通知固定策略）+ 危险区二次确认 + sticky 保存（只提交改动） |
| 会话 | `components/SessionTab.tsx` | 会话下拉 + 按轮次时间线 + 卡节点（阶段/等待原因/trace 尾 8），点节点开详情 |

派生口径只在 `src/client/stage.ts`：`stageOf`（阶段+色系）、`waitLabelKey`、`authorityLabel`、`verifyKeyOf`、`kpiOf/kpiDetailOf/filterCards/filterCounts`。组件不再各写一套映射。

### 18.2 体积：CSS 改为宿主静态资源

七屏的样式若继续内联进客户端 bundle，实测会把 122 KB 推到 176 KB（超 150 KB 预算）。处理方式：

- CSS 文本移到 `src/host/panel/css/*`，由 `GET /dsh-task-cards/api/css` 以 `text/css` 发出（`Cache-Control: no-store`，HMR 后重新取）。
- 客户端只在 `apply` 里挂 `<link data-plugin="dsh-task-cards" href="/dsh-task-cards/api/css">`，卸载时摘掉；ABI 测试同步改为断言这个 link。
- 结果：客户端 bundle **122.5 KB**（预算 150 KB），CSS 作为静态资源独立传输；没有调高任何阈值。

### 18.3 验证

- `pnpm verify` 等价链路全绿：lint（217 文件）、`tsc --noEmit`、**291 个测试**、build、ABI、代码预算、客户端体积预算。
- 登录态浏览器逐屏走查（1440×800，明/暗两套），截图存 `prototype/actual-0*.png`。
- 新增测试：`stage.test.ts`（口径）、`workbench-tab.test.tsx`（KPI/过滤/分组/平铺）、`detail-tab.test.tsx`（五段/空态）、`failure-tab/policy-tab/settings-tab/session-tab`（各屏交互）、`/css` 路由用例、panel 集成用例（七屏导航、详情跳转、采纳）。
