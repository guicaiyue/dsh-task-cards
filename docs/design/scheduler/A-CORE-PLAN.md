# A-core 方案：模块边界、可观测时间线、前端设计

> 方案层文档，不含代码改动。对象：`dsh-task-cards`（v0.1.1，`src/` 114 文件 / 约 10.9k 行）。
> 前置阅读：[四层闭环设计](dsh-task-cards-scheduler.md)；4 张图在 [diagrams/](diagrams/)。
> 开发/测试/验证环境：`dsh-dev` 容器（见 §1），前端页面用 OpenDesign 设计（见 §5）。
> 结论先行：A-core = 一套契约 + 一个内核 + 五个可替换模块 + 一条可重放的时间线；**不做多插件拆分，也不做微服务**。

**怎么读**：只想知道做什么 → §2；关心以后改功能影响多大 → §3；关心怎么排查 → §4；关心页面 → §5；交互细化（历史/会话/权限/设置/会话内介入）→ [UI-UX-SPEC.md](UI-UX-SPEC.md)；Todo 清单与对账/失效 → [TODO-RECONCILE.md](TODO-RECONCILE.md)；证据取哪些、取到什么程度 → [EVIDENCE-MODEL.md](EVIDENCE-MODEL.md)；关心排期与验收 → §6–§7。

---

## 1. 环境与开发回路

### 1.1 本机现状（已确认）

| 组件 | 事实 |
| :-- | :-- |
| `dsh-dev` 容器 | 运行中，端口 `0.0.0.0:3080`，局域网 `http://192.168.1.4:3080` |
| 仓库挂载 | `/vol1/1000/开发/NAS/dsh-plugins` → `/workspace/nas-plugins`（**可写，直挂真实仓库，没有副本**） |
| 插件加载 | `/workspace/dev.patch.yml` 里 `id: dsh-task-cards` → `name: /workspace/nas-plugins/dsh-task-cards/lib/index.js` |
| 热重载 | `hmr` 监听 `/workspace/nas-plugins`；宿主侧改模块自动重载；客户端产物由 `dsh-client-hmr` 每 500ms 轮询后推给浏览器 |
| 数据目录 | `/data/dsh/dsh-task-cards`（容器内 profile 数据，与宿主隔离） |
| 宿主机生产 dsh | **任务卡插件已禁用**；开发/测试/验证只在容器里做 |

### 1.2 开发回路（从此固定）

```text
改源码（宿主 /vol1/1000/开发/NAS/dsh-plugins/dsh-task-cards/src）
   → docker exec dsh-dev sh -lc 'cd /workspace/nas-plugins/dsh-task-cards && pnpm build'
   → hmr 自动重载（宿主侧模块）/ 客户端 bundle 轮询推送（浏览器侧）
   → 浏览器打开 http://192.168.1.4:3080 验证
   → 必要时 docker compose restart dsh（只改 patch 本身时需要）
```

质量门（容器内跑，宿主不装依赖）：

| 门 | 命令 | 何时跑 |
| :-- | :-- | :-- |
| 类型 | `pnpm typecheck` | 每次改契约/内核 |
| 单测 | `pnpm test` | 每次提交前 |
| 构建 | `pnpm build` | 每次改 host/client 入口 |
| ABI + 预算 | `pnpm test:abi && pnpm budget` | 每次改 client 导出或体积 |
| 全量 | `pnpm verify` | 合入前 |

**纪律**：A-core 的验收必须在容器里跑「真实宿主 + 真实面板」，不在宿主生产实例上试。

### 1.3 OpenDesign

| 项 | 值 |
| :-- | :-- |
| 服务 | 容器 `open-design`（`ghcr.io/nexu-io/od:latest`），TLS 入口 `192.168.1.4:7456` |
| 项目 | `dsh-task-cards-scheduler-ui` |
| 用途 | 产出 4 屏 HTML 原型，作为前端实现的视觉与交互基准 |
| 边界 | OD 只产**设计与原型**；实现仍在 `src/client`，不引 OD 运行时依赖 |
| 现状（2026-11-08） | **已打通**：OD 侧 `deepseek-harness` agent 可用（本地网关模型 `local/deepseek/deepseek-v4.1-flash`）；由本会话接手出图，任务书见 [open-design-brief.md](open-design-brief.md) |

---

## 2. A-core 范围

### 2.1 一句话

把现在「卡 + 直接投递 + 不验收」改成 **Case 一条主线 + 决定/执行/验收三段账本**；调度只做准入与路由；所有状态变更走同一个 `transition()`；前端用一条时间线把「谁批的、要做什么、做了什么、谁判的」讲清楚。

### 2.2 做什么（A-core，必须）

| # | 内容 | 为什么是 core |
| :-- | :-- | :-- |
| A1 | 契约 v2：`Verdict` / `Acceptance` / `ApprovedPlan` / `ExecutionResult` / `Outcome` | 没有结构化数据，前端和排障都无从谈起 |
| A2 | 内核：`CaseEvent` + `transition()` + 单一写入口 + `traceId` | 时间线可重放、状态不可旁路，这是可观测的地基 |
| A3 | 调度：路由、队列、`decisionSeq` CAS、每会话 WIP=1、非抢占、`waitReason` | 解决双投、乱序、卡死；也是"等一下"可解释的来源 |
| A4 | 执行：`ExecutionAdapter` 接口 + **session adapter**（复用现有 `answerQuestion`） | 保住现有能力，同时把投递收进一个可替换接口 |
| A5 | 验收：`acceptance` 机器项 + 决策者语义项 + 用户项（分级） | 用户质疑的根因就在这层；没有它 A 就只是"更重的投递" |
| A6 | 面板：阶段徽标 + 等待原因 + 详情四段时间线 + 证据抽屉 + 失败三栏对比 | 让排障在页面内完成，而不是翻日志 |
| A7 | 迁移：旧卡补齐字段、双读、可回滚 | 不迁移就是一次数据断裂 |

### 2.3 不做（A-core 明确排除）

- **system adapter 的完整实现**：只留接口 + 1 个可跑通的样例（如"跑测试"），其余推迟到 A+。
- 多会话公平调度、跨会话优先级、全局队列。
- 通知/升级的完整 UI 工作台（P3 阶段再说），A-core 只做「通知 vs 决策」的视觉区分与升级落地。
- 通用工作流 DSL / DAG 引擎 / 分布式队列。
- 多用户、远程审批、权限系统。
- 执行合并（多卡合成一个 plan）。

### 2.4 为什么不算"很重"

| 维度 | A-core 实际量 |
| :-- | :-- |
| 新增模块目录 | 1 个内核 + 5 个模块目录（其中 2 个是现有目录迁移） |
| 新增/重写 host 文件 | 约 18–24 个（现 63 个） |
| 契约变更 | 1 个文件（`shared/contract.ts`）+ 1 个新文件（`shared/case.ts`） |
| 前端 | 新增 6–8 个组件 + 改 4 个现有组件；不改路由框架 |
| 迁移 | 一次性脚本 + 双读兼容，1 天内可回滚 |
| 工期 | 2–3 周（1 人），含测试与容器内验证 |

**重的是"约束"不是"代码量"**：单一写入口、模块不可互相 import、时间线必须可重放。这些约束会让后续每个功能变便宜。

---

## 3. 模块边界

### 3.1 目标结构

```text
src/
├── shared/                  纯契约与纯函数（两端共用，不依赖 Node/DOM）
│   ├── contract.ts          zod 唯一真源：Card / Verdict / Acceptance / Plan / Result / Outcome
│   ├── case.ts              CaseEvent、阶段枚举、waitReason、transition()（纯函数）
│   ├── state.ts             面板分组、排序（读 case.ts 的派生结果）
│   ├── routes.ts / abi.ts
├── host/
│   ├── kernel/              ★ 必须唯一，不可绕过
│   │   ├── journal.ts       append-only CaseEvent 日志（JSONL，按 caseId 分片）
│   │   ├── transition.ts    唯一写入口：校验 + 落事件 + 更新卡快照
│   │   ├── policy.ts        授权/升级规则求值（纯函数 + 配置）
│   │   ├── trace.ts         traceId 生成与传播
│   │   └── migrate.ts       旧卡 → 新契约
│   ├── modules/
│   │   ├── observer/        感知：建卡 + 草拟 acceptance + 证据
│   │   ├── decision/        决策：CaseFile → DecisionOutput（无工具 agent）
│   │   ├── scheduler/       路由 / 队列 / 租约 / 非抢占 / 升级路由
│   │   ├── execution/       adapter 接口 + session adapter（+ 1 个 system 样例）
│   │   └── verification/    machine / decision / user 三级验收
│   ├── routes/              只做 HTTP ↔ 模块调用，不含业务规则
│   ├── wire.ts              ★ 唯一组合根
│   └── host-api.ts          宿主 ABI 唯一接触面
└── client/
    ├── components/          StageChip / WaitReason / CaseTimeline / EvidenceDrawer / FailureCompare / PolicyTab
    ├── hooks/               数据与副作用
    └── api.ts               所有 fetch
```

### 3.2 三条不可协商的边界规则

1. **模块之间不许互相 import 内部实现**。只允许 `shared/*` 与 `host/kernel/*`。
   例：`decision` 不许 `import { deliver } from '../execution/...'`；它只返回 `ApprovedPlan`，由 `wire.ts` 交给 scheduler。
2. **所有状态变更只走 `kernel/transition.ts`**。`routes/`、`modules/`、`client/` 都不许直接写 `status`。
3. **`wire.ts` 是唯一组合根**。新增/替换模块 = 改 `wire.ts` 一行 + 加目录，不改别处。

强制手段（不靠自觉）：

| 规则 | 手段 |
| :-- | :-- |
| 模块互不 import | `biome.json` 的 `noRestrictedImports` 分组规则；违反 CI 红 |
| 只走 transition | 单元测试遍历 `routes/*` 断言无 `status:` 直写；`kernel` 外出现 `patch({ status` 用 `scripts/check-*.mjs` 扫 |
| 组合根唯一 | `wire.ts` 之外出现 `new Scheduler(` / `new Decision(` 同上脚本拦截 |
| 时间线可重放 | 测试 `replay(journal) === currentCardState` |

### 3.3 影响范围表（改一个功能动多少）

| 改动类型 | 需要动 | 不需要动 | 影响面 |
| :-- | :-- | :-- | :-- |
| 新增一个 system adapter（如"发消息"） | `modules/execution/adapters/*` + `wire.ts` 一行 + 测试 | 契约、调度、前端 | **局部** |
| 调整升级规则（哪些给用户） | `host/kernel/policy.ts` + fixtures | 执行、验收、UI | **局部** |
| 新增一类验收规则（如"部署健康检查"） | `modules/verification/*` + acceptance 模板 | 决策、调度 | **局部** |
| 改时间线 UI 呈现 | `client/components/*` | host 全部 | **局部** |
| 加一个卡字段（非状态） | `shared/contract.ts` + 读写处 | 调度、验收 | **小范围** |
| 改状态机 / 阶段定义 | `shared/case.ts` + 内核 + 迁移 + 全链路测试 + UI 映射 | — | **系统性，需版本化** |
| 换存储（JSON → SQLite） | `kernel/journal.ts` 实现 | 模块、UI | **局部**（契约不变） |

**结论**：除状态机本身，其余改动都被限制在单目录内。这是"模块化单体 + 系统性内核"的取舍：**共享内核保一致性，独立模块保可替换**。

### 3.4 契约变更（v2 关键字段）

```ts
// Card 增量（保留现有字段，全部可选，旧数据可解析）
revision: number        // 内容/标准版本
decisionSeq: number     // 只随决定相关变化递增；CAS 令牌
traceId: string         // 全链路 id
authority?: 'delegated' | 'user'
verdicts: Verdict[]
acceptance: AcceptanceCriterion[]
planId?: string
deliveryState?: 'idle' | 'waiting' | 'leased' | 'dispatched' | 'executed'
               | 'verifying' | 'confirmed' | 'failed' | 'unknown'
waitReason?: WaitReason
outcome?: Outcome

type WaitReason =
  | 'session-busy' | 'wip-limit' | 'queued' | 'awaiting-decision'
  | 'awaiting-user-escalation' | 'awaiting-receipt' | 'awaiting-verification'
  | 'preempted' | 'lease-expired' | 'retrying'
```

```ts
// shared/case.ts：唯一的状态机
type Phase = 'sense' | 'decide' | 'execute' | 'verify' | 'closed'
type CaseEvent = {
  id: string; caseId: string; traceId: string
  at: number; phase: Phase
  from: string; to: string
  actor: 'observer' | 'decision' | 'scheduler' | 'executor' | 'verifier' | 'user' | 'system'
  authority: 'delegated' | 'user' | 'system'
  reason: string
  evidenceRefs: string[]
  policyVersion: number
  attempt?: number
  meta?: Record<string, unknown>
}
function transition(card: Card, event: TransitionInput, policy: Policy): TransitionResult
```

`transition()` 是纯函数：输入卡 + 事件意图 + 策略，输出新卡 + 新事件（或拒绝原因）。落盘由 `journal.ts` 负责。**纯函数意味着可以单测穷举所有状态迁移**。

---

## 4. 可观测与时间线

### 4.1 用户质疑时，页面必须回答的三个问题

| 问题 | 数据来源 | 页面位置 |
| :-- | :-- | :-- |
| **标准是什么**（卡片要求） | `acceptance[]`（批准时冻结的版本） | 详情第 2 段「计划」 |
| **实际做了什么** | `ExecutionResult`（adapter、attempt、exit code、产物） | 详情第 3 段「执行」 |
| **谁判的、凭什么** | `Outcome.criteriaResults[]` + verifier + evidenceRefs | 详情第 4 段「验收」+ 失败视图三栏对比 |

能分清三种根因：

```text
标准错   → acceptance 本身写错/太松，执行与判定都没问题
执行错   → acceptance 正确，ExecutionResult 不满足它
判定错   → 执行结果其实满足标准，但 verifier 判 failed（或反过来）
```

### 4.2 时间线可重放（硬要求）

- 所有事件 append-only 写 `journal`，卡上的 `status/deliveryState/outcome` 只是**快照**。
- 启动时校验：`replay(journal(caseId))` 必须等于卡快照；不等则告警并在面板标记「状态漂移」。
- 好处：面板显示的是事实，不是"最后一次写入的猜测"；也能回答"它为什么变过三次"。

### 4.3 可观测验收标准（可测，不是口号）

| # | 标准 | 怎么验 |
| :-- | :-- | :-- |
| O1 | 任意一张卡，从列表到看到 `traceId` 不超过 2 次点击 | 人工走查 5 张卡 |
| O2 | 任意 `failed`/`unknown` 卡，详情首屏能直接看到失败的 criterion、判定者、证据入口 | 人工走查 5 个失败案例 |
| O3 | `replay(journal) === card 快照` 对所有历史卡成立 | 自动化测试 + 启动自检 |
| O4 | 没有任何状态变更绕过 `transition()` | 代码扫描脚本 + 单测 |
| O5 | 每条 `CaseEvent` 都有 `traceId / actor / authority / reason / policyVersion` | schema 校验（zod 严格模式） |
| O6 | 失败卡的三栏对比能在一屏内放下（1440×900，面板 560px 宽） | 视觉走查 |
| O7 | 日志里不存在只有 message、没有 `caseId` 的错误行 | 日志格式测试 |
| O8 | 用户能在 10 秒内说出"是标准、执行还是判定的问题" | 5 个真实案例盲测 |

### 4.4 指标（面板 KPI + 埋点）

- 阶段分布：待决 / 排队 / 执行中 / 验收中 / 失败 / 未知
- 时延：批准 → dispatch、dispatch → 结果、结果 → 判定（p50/p95）
- 质量：确认率、失败率、unknown 率、秘书决定被 override 率、用户抽样审计一致率
- 队列：平均 `waitReason` 分布、WIP 触顶次数、租约过期次数

### 4.5 决策策略（默认值，可在设置页改）

「谁先判」和「判不了怎么办」固定成一条链，避免每张卡临时决定：

| 情形 | 先给谁 | 判不了时 |
| :-- | :-- | :-- |
| 执行结果 `unknown`（无回执 / 租约过期 / 结果矛盾） | **决策者先判**：重试、补偿、还是判失败 | 决策者给不出结论、或涉及 destructive → 升级用户 |
| `failed` 且 `effect=read` | 决策者自动重试一次 | 仍失败 → 升级 |
| `failed` 且 `effect=write-code` | 决策者判断是否重试 | 需要人确认才重投（写操作不自动重放） |
| `failed` 且 `destructive/external/spend` | 用户 | — |
| 低置信 / 无判例 | 决策者给建议 + 升级用户 | — |
| 通知类 | 用户只看 | — |

**本轮确认（2026-11-08）**：`unknown` **不直接找用户**，先由决策者判重试/补偿；判不了才升级。理由是 unknown 多由回执丢失或租约过期造成，属于「可自动收敛的运维问题」，不该占用户注意力。

**策略变更的三条硬约束**：

1. 改策略要**留版本**（`policyVersion`），并在卡上记录「按哪一版判的」；
2. 放大决策者权限（例如把 external 交给秘书）必须**显式确认 + 可回滚**，不能静默生效；
3. `destructive` 永远保留用户终审，不允许把上限完全委派。

### 4.6 Todo 清单与对账

执行清单（Todo）、未完成的三类分流（中断/忘更新/代价变高）与会话对账（失效已处理卡）见 [TODO-RECONCILE.md](TODO-RECONCILE.md)。要点：

- Todo 是**进度与结构**，不是事实；`done` 必须带证据，机器项仍是硬门槛；
- 未完成先分类再动作：A 异常中断 → 重试/补偿；B 忘更新 → 给会话一次补更新机会；C 代价变高 → 交决策者评估继续/缩小/终止；
- 对账先确定性后模型：产物已存在 / 后续轮次已完成 → 可失效；模型只能提议，且失效可逆、有证据、有汇总。

---

## 5. 前端页面设计（OpenDesign）

### 5.1 设计目标

不是"加一个字段"，而是**让生命周期可见**：用户打开卡片，从四个阶段读出「谁批的 / 要做什么 / 做了什么 / 谁判的」，并能追到证据。

### 5.2 七屏（原四屏 + 记录 / 设置 / 会话）

| 屏 | 内容 | 关键交互 |
| :-- | :-- | :-- |
| **1 工作台（列表）** | KPI（待我决定/秘书处理中/执行中/待验收/需关注）+ 视图切换 + 卡片行（阶段徽标、等待原因、谁批的、effect、主操作） | 点行开详情；多选「合并查看」；通知类与决策卡视觉区分 |
| **2 详情（时间线）** | 头部（标题 / `traceId` 可复制 / 状态 / 来源会话）+ 四段时间线（决定 → 计划 → 执行 → 验收）+ 证据抽屉 + 权限化动作区 | 每段可展开"为什么"；证据展开/复制；重试/补偿/升级/override |
| **3 失败排查** | 结论条（哪条 criterion 失败、谁判的、证据在哪）+ 三栏对比（卡片要求 / 实际结果 / 验收判定）+ 补救动作 | 失败处高亮；区分标准错/执行错/判定错 |
| **4 策略与模板** | 升级规则（destructive/spend/external 默认给用户，destructive 锁定不可委派）+ 验收模板库（可新建/试运行/版本化）+ 观测设置 | 预览"哪些会来找我"；模板改动用旧卡回放 |
| **5 记录** | 运行历史表：时间 / 阶段 / 卡 / 结果 / 耗时 / traceId；筛选 + 搜索 | 点行跳卡详情；按 traceId 定位整条链路 |
| **6 设置** | 六组：总开关 / 决策者（含暂停）/ 执行 / 预算超时 / 保留隐私 / 通知 + 危险区 | 暂停决策者后工作台出现横幅；危险操作二次确认 |
| **7 会话示意** | 会话内介入 chip（自动/仅记录/关闭）+ 任务卡回复节点（成功/失败） | 点节点打开卡片详情；关闭后显示恢复倒计时 |

### 5.3 视觉约束

- 宿主约束：入口是 DSH 侧边栏菜单，面板占主面板区（约 900–1400px 自适应），详情用 900px 模态；不做独立网站、四周不留宿主底色边。
- 风格：高密度工具感（Linear / Sentry / Vercel 类克制），不要渐变营销风。
- 等宽字体用于 `traceId`、命令、路径、exit code。
- 状态色语义固定：等待=琥珀、执行中=蓝、通过=绿、失败=红、未知=灰紫、失效=灰。
- 证据与 trace **全部显示**（不做默认脱敏），trace 保留 200 条；仅在导出/分享时提供"脱敏导出"选项。
- 明暗双主题；键盘可达。

### 5.4 OpenDesign 任务（已就绪，等待运行时）

| 项 | 值 |
| :-- | :-- |
| 项目 | `dsh-task-cards-scheduler-ui`（已建） |
| 产物 | 多屏 HTML 原型（可切换四屏、可点交互、明暗主题） |
| 输入 | §5.2 四屏规格 + §5.3 约束 + 真实中文数据（c-42 跑测试并提交 / c-43 删生产表 / c-44 构建失败通知 / c-45 部署 staging） |
| 状态 | **已产出**（2026-11-08）：`index.html` 单文件、自包含、无外部依赖；`deliverableValid: true`；四屏 + 明暗主题 + 批量/合并/改标准三个对话框均已实测 |
| 预览 | `http://127.0.0.1:7456/api/projects/dsh-task-cards-scheduler-ui/raw/index.html`（OD 运行中有效） |
| 截图 | [prototype/](prototype/)（工作台 / 详情 / 失败排查 / 策略 / 深色） |
| 覆盖 | 10 张卡覆盖全部阶段枚举（含「已失效」）；7 屏 + 明暗主题 + 会话分组 + 记录/设置/会话已实测；详情为**五段**（决定/计划/执行清单/执行/验收）；工作台带「对账」入口；面板铺满无外框 |

### 5.5 从原型到代码

| 原型产物 | 落地位置 |
| :-- | :-- |
| 颜色/间距/字号 | `src/client/styles.ts` 的 CSS 变量（`--dtc-*`） |
| 阶段徽标 | 新组件 `StageChip.tsx`（读 `deliveryState` + `waitReason`） |
| 等待原因 | 新组件 `WaitReason.tsx`（文案表进 locale） |
| 时间线 | 新组件 `CaseTimeline.tsx`（读 `CaseEvent[]`） |
| 证据抽屉 | 新组件 `EvidenceDrawer.tsx` |
| 失败三栏 | 新组件 `FailureCompare.tsx` |
| 策略页 | 扩展现有 `SettingsTab` → 新 `PolicyTab.tsx` |

原则：**原型只做参考，不引入 OD 运行时**；组件仍用现有 React + `styles.ts` 体系，避免第二套样式系统。
