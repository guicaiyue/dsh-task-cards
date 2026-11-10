# 任务卡的四层闭环：感知 → 决策 → 执行 → 验收

> 设计稿 v2，不含任何代码改动。对象：`dsh-task-cards` v0.4（2026-11-07）。
> 结论先行：观察者负责感知，决策者负责判断和批红，执行系统负责把批准的计划变成动作，验收负责判断动作是否满足卡片要求。**决策者不执行，执行系统不决策，观察者不验收，调度者不写票。**
> 用户是授权人：只在重大事情、通知类、低置信/无判例时升级；日常审批由决策者（秘书）完成。

**怎么读**：只想要结论 → §0 + §9；概念 → §2；长期理念 → §3；要落地 → §4–§6；现状证据 → §8。
**下一步阅读**：[A-core 实施方案](A-CORE-PLAN.md)（模块边界、可观测时间线、前端四屏、3 周排期）· [OpenDesign 前端任务书](open-design-brief.md)。

---

## 0. 一句话结论

| 层 | 谁 | 只做什么 | 不做什么 |
| :-- | :-- | :-- | :-- |
| **感知** | 观察者（agent） | 观察会话、建卡、草拟验收标准、提供证据 | 不决策、不执行、不验收 |
| **决策** | 决策者/秘书（agent） | 在授权策略内终审、写批红、产出 ApprovedPlan；重大/通知/低置信升级用户 | 不直接执行、不碰执行账 |
| **执行** | 执行系统（system） | 队列、租约、适配器（system / session）、返回 ExecutionResult | 不做内容判断、不写票 |
| **验收** | 验证器（分级） | 按 acceptance 判 `confirmed / failed / unknown` | 不替执行者改结果 |
| **贯穿** | 调度者（system） | CaseFile 路由、队列、租约、回执、升级路由、三本账 | 不写票、不执行、不改卡内容 |
| **授权人** | 用户 | 定策略、接升级、审计、override | 不做日常审批 |

三条硬分离：**决策者不执行；执行系统不决策；观察者不验收。** 再加一条：**调度者不在任何一条内容判断链上，它只保证流程和结构化数据。**

### 0.1 配套图

| 图 | 回答什么 | 文件 |
| :-- | :-- | :-- |
| 图 1 四层闭环与三本账 | 谁能改什么、谁不能改什么 | [01-roles-ledgers.architecture.html](diagrams/01-roles-ledgers.architecture.html) |
| 图 2 一张卡从感知到验收 | 卡/计划/结果/验收的状态与不可逆点 | [02-card-lifecycle.lifecycle.html](diagrams/02-card-lifecycle.lifecycle.html) |
| 图 3 routine vs major 的调度时序 | 秘书批红、用户升级、执行、验收 | [03-dual-approval.sequence.html](diagrams/03-dual-approval.sequence.html) |
| 图 4 每 tick：路由 / 决策 / 派单 / 验收 | 主路径、五个等待出口与非抢占 | [04-tick-admission.workflow.html](diagrams/04-tick-admission.workflow.html) |

---

## 1. 为什么这样拆：从观察者/决策者演进

最初的插件只有观察者和决策者：

- **观察者**：观察信息，给出方案或通知提示。
- **决策者**：降低用户操作，把不重要的任务审批通过，进入原会话执行；本质是观察者能力的一种细化拆分。

现在的变化是第三次拆分：

1. **把执行从决策者里拆出来**：决策只产出「批准的计划」，不负责「怎么执行、执行到哪」。
2. **执行做成系统化、结构化**：队列 + 租约 + 适配器 + 结果契约；不再是决策者直接 `followup` 一句话。
3. **增加验收**：执行结果是否符合卡片要求，由 acceptance + verifier 判，不靠「回合结束」猜。

演进成四层闭环：

```text
观察者（感知/建卡）
   → 决策者（判断/批红/升级）
   → 执行系统（队列/适配器/结果）
   → 验收（acceptance → confirmed/failed/unknown）
   → 回写卡 / 通知 / 升级
```

调度者是贯穿四层的案卷和队列，不是第五个 agent。

### 1.1 三条长期原则

1. **确定性内核，agent 外壳**：能机器验证的不要交给 agent；需要解释的不要假装机器能验证。
2. **契约稳定，适配器可替换**：`ApprovedPlan → ExecutionResult → Outcome` 是稳定契约；system adapter / session adapter 是可替换实现。
3. **证据与判断分离**：谁提供证据、谁做判断、谁承担风险，三者分开；观察者不判自己的提案，执行者不自证，用户不做默认审批。

---

## 2. 概念区分

### 2.1 卡 ≠ 任务 ≠ 审批 ≠ 通知

| 概念 | 是什么 | 在本项目里 |
| :-- | :-- | :-- |
| **卡片** | 一个决策载体：问题 + 证据 + 可选项 + 验收标准 | 观察者建卡；决策者批红 |
| **计划 Plan** | 一个可执行单元：指令 + effect + acceptance + 约束 | 决策者产出 ApprovedPlan，执行系统执行 |
| **审批** | 对某个版本的表态：同意/拒绝/改/等/升级 | verdict 绑定 `decisionSeq` 与内容版本 |
| **通知** | 不需要动作的状态同步，看到即完成 | `info/notice` 卡；用户只看，不进执行 |

**判据**：答不答都不影响下一步 → 通知；答了产生动作 → 审批；答完还要有人做 → 需要 plan。

### 2.2 决定状态 ≠ 投递状态 ≠ 执行状态 ≠ 验收状态

| 维度 | 回答的问题 | 谁写 | 例子 |
| :-- | :-- | :-- | :-- |
| **决定状态** | 需不需要表态？谁批的？ | 决策者/用户 | `pending_secretary` / `escalated_user` / `approved` / `rejected` |
| **投递状态** | 计划有没有送进执行系统？ | 调度者 | `waiting` / `leased` / `dispatched` |
| **执行状态** | 执行者做了什么？结果是什么？ | 执行系统 | `executed` / `result=...` |
| **验收状态** | 结果是否符合 acceptance？ | 验证器 | `verifying` / `confirmed` / `failed` / `unknown` |
| **阅读状态** | 用户看没看到？ | 面板 | `unread` / `read`（只影响角标） |

原则：阅读状态不参与调度；决定状态、执行状态、验收状态永不互相冒充。

### 2.3 执行 ≠ 验证 ≠ 验收

| 概念 | 定义 | 谁做 |
| :-- | :-- | :-- |
| **执行 Execution** | 按 plan 产生动作/副作用 | 执行系统（system/session adapter） |
| **验证 Verification** | 对照 acceptance 做检查，产出证据 | 系统规则 / 决策者 / 用户（分级） |
| **验收 Acceptance** | 基于验证结果做「接受/不接受」的决定 | 决策者（routine）/ 用户（重大） |

**判据**：执行者只返回原始结果；验证者只产出 `confirmed/failed/unknown` 与证据；验收决定由有责任的角色做。三者不能由同一个角色一手包办。

### 2.4 角色：观察者 / 决策者 / 执行系统 / 验证器 / 调度者 / 用户

| 角色 | 是什么 | 能做什么 | 不能做什么 |
| :-- | :-- | :-- | :-- |
| **观察者** | 独立 agent | 建卡、草拟 acceptance、提供证据 | 不决策、不执行、不验收 |
| **决策者（秘书）** | 独立 agent | 在授权策略内终审、写批红、产出 ApprovedPlan、语义验收、升级 | 不直接执行、不碰执行账、不能越权 |
| **执行系统** | system 组件 | 队列、租约、适配器、返回 ExecutionResult | 不做内容判断、不写票 |
| **验证器** | 分级：system / decision / user | 按 acceptance 判 outcome | 不替执行者改结果 |
| **调度者** | system 组件 | 路由、队列、租约、回执、升级、三本账 | 不写票、不执行、不改卡内容 |
| **用户** | 授权人 | 定策略、接升级、审计、override | 不做默认审批 |

**判据**：任何一次「批准」必须能追到有权限的 actor；调度者只搬运「已批准」的事实，不生产批准。

### 2.5 排序 / 去重 / 合并 / 批处理

| 概念 | 定义 | 边界 |
| :-- | :-- | :-- |
| **排序** | 给就绪集一个确定的全序 | P1 只 FIFO；展示顺序 ≠ 投递顺序 |
| **去重** | 同一来源的重复卡只留一张 | P0b 修 bug，不是新能力 |
| **合并看** | 面板一次看多张、逐项否决 | 可选；不合并执行 |
| **合并做** | 多张卡合成一个 plan | **不做**：没有改卡内容通道，且与单写者冲突 |
| **批处理** | 一个回合给会话多条独立指令 | 默认不做；失败会互相牵连 |

### 2.6 队列 / 非抢占 / 打断

| 概念 | 定义 | 本项目默认 |
| :-- | :-- | :-- |
| **WIP** | 同一会话同时在飞的 plan 数 | 1 |
| **非抢占** | 当前 plan 执行完/超时，再投下一张 | 默认 |
| **urgent** | 新任务排到下一轮队首 | 只影响下一轮，不打断当前回合 |
| **抢占** | 取消当前 plan，立即执行新 plan | 仅 `preemptible=true` + 显式 `interruptPolicy`；普通任务不允许 |
| **补偿** | 投递/执行后只能补偿，不能假装回滚 | 所有已 dispatch 的 plan |

**判据**：会话是单线程的，中途注入会让 agent 看到半截上下文；所以默认排队，抢占是例外。

### 2.7 「当前决策者」现在指谁

| 读法 | 身份 | 它的「审批结果」 | 权限 |
| :-- | :-- | :-- | :-- |
| **决策者（默认）** | 任务卡系统里的独立 agent（秘书） | 批红 / 拒绝 / 改 / 升级，是**最终决定** | 授权范围内终审；重大/通知/低置信升级 |
| 会话执行者 | 原会话 agent | 执行反馈：做了/做不了/需补充 | 只执行、只回执；不批准 |
| 用户 | 授权人 | 升级审批 / override / 审计 | 最高权限；不做日常审批 |

---

## 3. 可长期沿用的理念（精简）

| 理念 | 采用的一句话规则 | 不采用的部分 |
| :-- | :-- | :-- |
| **Ports & Adapters / 六边形** | 稳定契约 + 可替换适配器；执行系统是 adapter，不是新 agent | 不引入完整六边形分层 |
| **Functional core / imperative shell** | 确定性的队列/账本/验收在内核；开放判断在 agent 外壳 | 不把一切塞进纯函数 |
| **Durable execution / activity** | plan、租约、结果落盘；dispatch 是可重试 activity | 不引入 Temporal/工作流引擎 |
| **Acceptance criteria / DoD** | 验收标准执行前写、执行前冻结；按卡类型沉淀模板 | 不做事后补标准 |
| **Verification vs validation** | 机器项用系统验证；语义项用决策者/用户验收 | 不用 LLM 判机器项 |
| **Separation of duties** | 提议者、决策者、执行者、验证者分离 | 不做形式上的双人控制 |
| **Tiered autonomy / levels of automation** | 低风险自动、边界升级、重大人工 | 不做「全自动」或「全人工」 |
| **Level-triggered reconciliation** | tick 重算「该做什么」，事件只唤醒 | 不把事件当唯一真相 |
| **WIP / backpressure / non-preemptive** | 每会话 WIP=1，默认非抢占 | 不搞复杂公平队列 |
| **Idempotency / at-least-once** | 幂等键只做记录去重；重试安全不承诺 | 不承诺 exactly-once |
| **Compensation, not rollback** | dispatch 之后只能补偿 | 不假装回滚 |
| **Approval bound to version** | 票绑 `decisionSeq` + 内容版本 | 不用 `updatedAt` 当 CAS |

---

## 4. 设计

### 4.1 四层与三本账

| 账本 | 写的人 | 关键内容 | 回答的问题 |
| :-- | :-- | :-- | :-- |
| **决定账** | 决策者、用户 | verdict、authority、policyVersion、confidence、rationale | 谁在什么状态下批了什么？ |
| **投递账** | 调度者 | ApprovedPlan、租约、attempt、priority、waitReason | 计划送出去了吗？为什么还没送？ |
| **执行账** | 执行系统（结果）、验证器（outcome） | ExecutionResult、acceptance、criteriaResults、evidence、verifier | 做了什么？符合要求吗？ |

关键：**调度者只写投递账；执行系统写执行结果；验证器写 outcome；决策者/用户写决定账。** 四本权限不交叉。

### 4.2 契约与对象模型

**Card（在现有基础上增加）**

```ts
revision: number                 // 内容版本；当前没有改内容通道，先留作未来用
decisionSeq: number              // 只随决定相关变化递增：状态迁移、票写入、内容变更（未来）
                                 // 不随已读/已确认/updatedAt 递增；CAS 用它
verdicts: Verdict[]              // 票：谁、什么权限、批了什么
actionability: 'notice' | 'permission' | 'decision'   // 从 kind+ask+effect 派生
acceptance: AcceptanceCriterion[]                     // 验收标准；approved 时冻结
planId?: string
deliveryState?: 'idle' | 'waiting' | 'leased' | 'dispatched' | 'executed' | 'verifying'
               | 'confirmed' | 'failed' | 'unknown'
waitReason?: string
```

**Verdict（票）**

```ts
{
  id, cardId, decisionSeq
  actor, actorType: 'user' | 'decision-agent' | 'executor'
  authority: 'user' | 'delegated' | 'none'   // delegated = 秘书在授权范围内终审
  channel: 'panel' | 'chat' | 'system'
  decision: 'approve' | 'reject' | 'modify' | 'wait' | 'escalate'
  optionId?, text?, rationale, confidence
  evidenceRefs: string[]
  at
}
```

**AcceptanceCriterion（验收标准）**

```ts
{
  id
  kind: 'machine' | 'evidence' | 'manual'
  check: string        // exitCode==0 / file.exists(path) / response.status==200 / test.pass ...
  expect: string
  evidenceRequired: boolean
  verifier: 'system' | 'decision' | 'user'
}
```

**ApprovedPlan（决策者产出，执行系统消费）**

```ts
{
  id, cardId, sessionId
  instruction
  effect: 'read' | 'write-code' | 'destructive' | 'external' | 'spend'
  requires: string[]
  acceptance: AcceptanceCriterion[]     // 从卡上冻结复制
  executionMode: 'system' | 'session' | 'hybrid'
  priority: 'normal' | 'urgent'
  preemptible: boolean
  idempotencyKey
  constraints?: { maxDurationMs?, maxTokens?, allowedTools? }
  lease?, attempts[]
}
```

**ExecutionResult（执行系统返回）**

```ts
{
  planId
  executor: 'system' | 'session'
  status: 'succeeded' | 'failed' | 'partial' | 'unknown'
  evidence: Array<{ kind, ref, excerpt }>
  artifacts?: Array<{ path, hash }>
  error?: string
  durationMs
  at
}
```

**Outcome（验证器产出）**

```ts
{
  planId
  verified: 'confirmed' | 'failed' | 'unknown'
  criteriaResults: Array<{ criterionId, pass, evidence }>
  verifier: 'system' | 'decision' | 'user'
  confidence
  at
}
```

**CaseFile（喂给决策者的结构化案卷）**

```ts
{
  card, origin, policy, precedents, capabilities,
  sessionState, acceptanceDraft, priorVerdicts, relatedPlans
}
```

**存储**：`cards.json`（卡、verdict、acceptance）、`plans.json`（plan、lease、attempt、result、outcome）、`policy.json`（授权/升级/通知/审计策略）。面板只读派生摘要。

### 4.3 状态机

**A. 决定状态（卡）**

| 状态 | 含义 | 出口 |
| :-- | :-- | :-- |
| `created` | 刚建卡 | → `card_ready` |
| `card_ready` | 卡内容 + acceptance 草稿就绪 | → `pending_secretary` / `notice` |
| `pending_secretary` | 等决策者批红 | → `approved` / `rejected` / `escalated_user` |
| `escalated_user` | 重大/通知/低置信，等用户 | → `approved` / `rejected` / `pending_secretary` |
| `approved` | 有效票（delegated 或 user） | → 生成 ApprovedPlan |
| `rejected` | 拒绝 | 终态（可重开） |
| `conflicted` | 决定状态上互相矛盾的票 | → 人工裁决 |
| `stale` | 票绑的版本/状态已变 | → 重新 pending |
| `notice` | 通知卡，用户只看 | `closed`（看到即结束） |
| `closed` | 卡生命周期结束 | — |

**B. 执行状态（plan）**

| 状态 | 含义 | 出口 |
| :-- | :-- | :-- |
| `planned` | ApprovedPlan 已创建，未入队 | → `waiting` |
| `waiting` | 未投递；原因见 `waitReason` | → `leased` / `cancelled` |
| `leased` | 已落租约，准备 dispatch | → `dispatched` / `waiting` |
| `dispatched` | 已交给执行系统 / 会话（**不可逆点**） | → `executed` / `unknown` |
| `executed` | 执行系统返回结果 | → `verifying` |
| `verifying` | 验收中 | → `confirmed` / `failed` / `unknown` |
| `confirmed` | 验收通过 | → `closed` |
| `failed` | 验收失败/执行失败 | 补偿 / 重试（按 effect）/ `closed` |
| `unknown` | 无结果/无法验收 | 升级 / 人工确认 / `closed` |
| `cancelled` | 投递前取消 | `closed` |

**C. 验收状态**：`verifying → confirmed | failed | unknown`；`unknown` 必须落到决策者或用户，不允许自动消失。

### 4.4 调度循环（伪代码）

```text
on tick(2s) / on startup / on event:
  snapshot = load(cards, plans, policy, sessions)
  revalidatePlans(snapshot)        # 票失效/卡被删 → plan cancelled
  expireLeases(snapshot)           # 启动时 leased 无 attempt → 立即重排
  route(snapshot)                  # notice/major → user；routine → secretary
  dispatchDecisionJobs(snapshot)   # 给决策者 CaseFile（agent 会话，异步）
  for plan in order(readyPlans):
      if sessionBusy/WIP>=1: wait(plan, reason); stop this session
      if conflictOrStale: cancel(plan)
      persistLease(plan)            # 先落盘再 dispatch
      dispatchAdapter(plan)         # system adapter or session adapter
      markDispatched(plan)
  captureResults()                 # ExecutionResult → 执行账
  verifyPending()                  # acceptance → Outcome（system/decision/user）
  closeOrEscalate()
```

关键点：

1. **先落盘保护「不丢计划」，不保护「不重复」**；write+ 重投必须人确认。
2. **每会话 WIP=1**；默认非抢占；urgent 只排下一轮队首。
3. **dispatch 是不可逆边界**；之后只能补偿。
4. **验收不是「回合结束」**；没有 Outcome 的 plan 不能算完成。
5. **决策者与执行系统之间没有直接调用**；调度者转发 CaseFile / ApprovedPlan / Outcome。

### 4.5 路由、授权与升级

**决策者的形态**：像观察者一样，是独立、无工具的 agent 会话——输入 `CaseFile` JSON，输出 `DecisionOutput` JSON：`{ verdict, approvedPlan? }`。批准时它给出 plan 草案（instruction / effect / acceptance / executionMode 建议）；不批准时只给 verdict 与理由。它不直接改卡、不直接调执行系统；调度者校验 policy 与 schema 后落成 `ApprovedPlan` 并转发。这样它的「能力」来自结构化案卷和判例，而不是工具权限；也避免它既是裁判又是执行者。

**默认策略**（`policy.json`，用户可改）：

| 卡/动作 | 默认决策者 | 升级用户 |
| :-- | :-- | :-- |
| 只读 / 可逆小动作 | 决策者（或自动） | 否 |
| write-code、普通许可 | 决策者 | 低置信/无判例时 |
| clarification | 决策者（有证据） | 答不了时 |
| judgment（现有方向内） | 决策者 | 方向变更/重大时 |
| destructive / spend / external | **用户** | 总是 |
| severity=high、方向变更、低置信、无判例 | **用户** | — |
| info / notice | 用户**只看** | 不进执行 |

**重大默认定义**：`destructive / spend / external` + `severity=high` + 方向变更 + 低置信 + 无判例 + 用户显式标记。

**三个例子**：

| 卡 | 路由 | 谁决定 | 执行 | 验收 |
| :-- | :-- | :-- | :-- | :-- |
| 提交代码到 feat 分支 | routine → 秘书 | 秘书批红（delegated） | session adapter：回原会话 | system：测试过 + 无密钥；decision：diff 语义 |
| 删除生产表 | major → 用户 | 用户批/拒；秘书可给建议 | system adapter：DB API | system：备份/行数；user：显式确认 |
| 构建失败通知 | notice → 用户 | 不决策，只看 | 不执行 | 看到即结束 |

**秘书批红规则**：

1. 票绑 `decisionSeq`；提交时带 `expectedDecisionSeq` + `expectedStatus`，不匹配 409。
2. 秘书在授权范围内写 `authority=delegated` 的 verdict；越权 → 拒绝，转升级。
3. 用户 verdict `authority=user` 优先级最高；投递前可 override，投递后只能补偿。
4. 冲突不猜：同一版本上 approve/reject 互斥 → `conflicted`，转人工。
5. 低置信/证据不足 → `escalate` 或 `wait`，不许硬批。
6. 每条秘书决定记录 `policyVersion / rationale / confidence / evidenceRefs`，供用户抽样审计。

### 4.6 执行系统

**适配器接口**（统一契约，两种实现）：

```ts
interface ExecutionAdapter {
  readonly kind: 'system' | 'session'
  execute(plan: ApprovedPlan): Promise<ExecutionResult>
}
```

- **system adapter**：命令/API/工具/文件操作；返回 exit code、JSON、产物。
- **session adapter**：把 instruction 投回原会话（followup/prompt）；返回回合输出 + 证据。
- `executionMode` 由动作类型 + acceptance 决定：能确定性验证 → system；需要上下文/解释 → session；混合 → session 执行 + system 校验机器项。
- **适配器不验收**；它只返回原始结果。验收由验证器做。
- **决策者不选适配器**；策略/动作类型决定，避免「谁批谁顺手选最省事的路径」。

**队列与抢占**：

- 每会话 WIP=1；默认非抢占；当前 plan 完成/超时后，下一张按 FIFO + priority 投递。
- `urgent` 只排下一轮队首；不打断当前回合。
- `preemptible=true` + `interruptPolicy` 才允许 cancel + 补偿；普通任务不允许。
- 观察者建卡不能自带执行权；`priorityHint` 只是建议，由调度者/决策者定。

### 4.7 验收

**验收标准**：

- 三类：`machine`（exit code/文件/API/测试）、`evidence`（agent 输出/观察者证据）、`manual`（用户/秘书 checklist）。
- 作者：观察者草拟（它看过上下文）→ 决策者确认/规范化（它担风险）→ 模板兜底（按卡类型沉淀）→ 用户只审例外。
- **approved 时冻结**；执行后改标准 = 新卡/重批。
- 没有 acceptance 的卡，不能交给纯系统执行；只能走 agent/人工验收。

**验证分级**：

| 验收类型 | 验证者 | 证据来源 |
| :-- | :-- | :-- |
| 机器可判 | system verifier | ExecutionResult（exit code/JSON/文件） |
| 语义可判 | decision verifier | ExecutionResult + 观察者证据 + 上下文 |
| 重大/低置信/人工 | user verifier | 结构化证据 + 人工判断 |

**观察者的位置**：只提供 `ExecutionObservation {planId, evidence, proposedOutcome}`，**不写 outcome、不关单**。它是证据源和异常探测器，不是裁判。

**失败处理**：

- `failed`：补偿 / 重试（read 可自动；write+ 人确认）/ 新决策卡。
- `unknown`：决策者或用户确认；write+ 不自动重投。
- 任何等待都有超时和升级路径。

### 4.8 恢复、面板与可观测

| 场景 | 机制 |
| :-- | :-- |
| 进程重启 | plan/lease/result/outcome 落盘；启动时 leased 无 attempt → 重排；dispatched 无结果 → unknown |
| 两个标签页 | 动作带 `expectedDecisionSeq` + `expectedStatus`；CAS 409；同 approve 幂等 |
| 用户批红/秘书批红同时 | 同一 store 串行写；用户票优先；越权拒绝 |
| 会话已死/无 sessionId | plan → waiting + 人工卡；禁止 done |
| 卡被删/票失效 | 投递前重查；plan cancelled |
| 多会话 | 每会话 WIP=1 + 全局串行 tick；跨会话公平 P4 |

面板显示：决定状态（秘书批/用户批/等升级）、执行状态（排队原因/已 dispatch/等结果）、验收状态（confirmed/failed/unknown + 证据摘要）、最后尝试、policyVersion、审计入口。

指标：待决卡数、秘书批红率、升级率、执行→验收延迟、确认率、unknown 率、重试率、用户抽样审计一致率。

---

## 5. 失败模式 → 机制

| 失败模式 | 机制 |
| :-- | :-- |
| 执行者自证 | 执行器只返回结果；验证器独立判 outcome |
| 「回合结束」当完成 | 必须有 Outcome；dispatched ≠ confirmed |
| 秘书越权批 destructive | 策略前置拦截；越权 → 拒绝 + 升级 |
| 用户被淹没 | 默认秘书终审；只升级重大/通知/低置信 |
| 观察者自判 | 观察者只提供证据；不写 outcome |
| 重复投递 | CAS + 租约 + 记录去重；write+ 重投人确认 |
| 旧票复用 | decisionSeq/版本绑定；stale 拒绝 |
| 队列插队 | 观察者只建卡；urgent 下一轮队首；非抢占 |
| 中途打断 | 仅 preemptible + interruptPolicy；否则等 |
| 会话已死 | waiting + 人工卡，不 done |
| 验收标准缺失 | 纯系统不许执行；转 agent/人工 |
| 秘书低置信硬批 | confidence/证据不足 → escalate/wait |
| 重启丢队列 | plan 落盘 + 启动短路 |
| 复杂度膨胀 | 一份 PLAN 契约、4 层、非抢占；不引入工作流引擎 |

---

## 6. 分阶段落地

| 阶段 | 做什么 | 不做什么 | 验证信号 |
| :-- | :-- | :-- | :-- |
| **P0a 观测**（1 天） | 加 `decisionSeq`、`acceptance`、`executionMode`、`authority`、plan/result/outcome 字段；行为不变 | 不改投递路径、不改 UI | 回放 20–50 张卡，状态/验收推导一致 ≥18/20；响应体积可控 |
| **P0b 四个真 bug**（1 天） | 同源重复卡去重、`run-now` 复查状态、auto 失败可重试、`acknowledged` 不关闭决策卡 | 不碰新能力 | 一提问一张卡；不双投；失败可重试；已读后仍能批 |
| **P1a 决策秘书 + 执行系统**（3 天） | 授权策略 + verdict schema + 升级路由；session adapter + system adapter 1 个；非抢占 WIP=1；租约/dispatch/结果捕获 | 不做语义验收、不做多会话、不做执行合并 | 20 张卡：秘书批红率/升级率可解释；重复 dispatch 0；卡住 >5min 0 |
| **P1b 验收**（2 天） | acceptance 模板 + 机器项校验 + 决策者语义验收 + 观察者证据；outcome/升级 | 不承诺全自动验收 | 机器项 100% 有证据；语义项有 rationale；unknown 能落到人 |
| **P2 system adapter 扩展**（2 天） | 把 1–2 个稳定动作从 session 迁到 system；幂等/补偿 | 不做通用适配器平台 | 迁移动作的确认率/成本对比 |
| **P3 升级/通知/审计 UI**（2 天） | 重大/通知分流、用户抽样审计、override | 不做全量审批台 | 用户只看重大/通知；审计一致率 |
| **P4 多会话**（以后） | 跨会话公平调度 | 不做分布式队列/共识 | 多会话无饿死/串味 |

**停手条件**：P1a 重复 dispatch 不归零，不上验收；P1b 机器项证据不全，不上语义验收；P3 用户审计成本过高，先减少升级量。

---

## 7. 现在不要做

- 通用 DAG / BPMN 工作流引擎；
- 分布式队列 / 共识 / 跨进程锁；
- 执行合并（多张卡合成一个 plan）；
- 用 LLM 判机器项；
- 全自动验收（没有 acceptance 的自动通过）；
- 全局跨会话调度器；
- 多用户/远程审批；
- 复杂优先级/老化模型；
- 中间态无限扩张（状态数不增加，先加 reason）。

---

## 8. 现状缺口（只定位，不改代码）

> 行号相对 `dsh-task-cards/`；完整清单见 `.scratch/scheduler-design/current-state.md`。

1. **没有执行系统**：人工批红/票拟自动执行/scanner 三处直接 `followup`，互不排队；没有适配器、租约、结果契约。
2. **没有验收**：投递成功即 `done`；没有 acceptance、ExecutionResult、Outcome。
3. **决定与执行混在一起**：决策者直接投递；没有 ApprovedPlan。
4. **没有权限/升级模型**：没有 `authority`、policy、major/notice 分流。
5. **没有 CAS**：`Store.patch` 读改写，无 `decisionSeq`；`updatedAt` 不能当令牌。
6. **没有持久队列**：重启丢内存队列；scheduled 之外不会恢复。
7. **没有结构化结果**：执行者回执是自然语言；没有可验证的 evidence。
8. **现状竞争**：双 approve 双投、advice 覆盖、run-now 绕过、tick 快照、auto 失败不重试、同源双卡（详见 `.scratch/scheduler-design/current-state.md` §8.3）。

---

## 9. 小结

**先把四层拆开：观察者感知、决策者批红、执行系统执行、验证器验收；调度者只做案卷、队列、租约、回执和升级路由。** 决策者默认终审，用户只接重大/通知/例外；执行系统用统一契约 + 可替换适配器；验收标准执行前冻结，机器项系统判、语义项决策者判、重大项用户判。

**不要做的事**：不要给调度者加 AI 判断，不要做执行合并，不要用「回合结束」当验收，不要承诺幂等键能保证执行安全。

---

## 10. 来源

**架构 / 分层**

- Hexagonal Architecture / Ports & Adapters: <https://alistair.cockburn.us/hexagonal-architecture/>
- Functional core, imperative shell: <https://www.destroyallsoftware.com/talks/boundaries>
- Martin Fowler — Event Sourcing: <https://martinfowler.com/eaaDev/EventSourcing.html>

**长流程 / 人任务**

- Temporal — Durable Execution: <https://docs.temporal.io/encyclopedia/durable-execution>
- AWS Step Functions — Wait for callback: <https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html>
- Camunda — BPMN User Task: <https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/>
- microservices.io — Saga: <https://microservices.io/patterns/data/saga.html>

**验收 / 职责分离 / 人机协作**

- Scrum — Definition of Done: <https://www.scrum.org/resources/what-definition-done>
- Verification and validation: <https://en.wikipedia.org/wiki/Verification_and_validation>
- NIST SP 800-53 AC-5 Separation of Duties: <https://csf.tools/reference/nist-sp-800-53/r5/ac/ac-5/>
- NIST SP 800-63B-4 Authentication Fatigue: <https://pages.nist.gov/800-63-4/sp800-63b.html>
- EU AI Act — Article 14 Human Oversight: <https://artificialintelligenceact.eu/article/14/>
- Human-in-the-loop / levels of automation: <https://en.wikipedia.org/wiki/Human-in-the-loop>
- Goodhart's law（指标成为目标即失效）: <https://en.wikipedia.org/wiki/Goodhart%27s_law>

**调度 / 并发 / 一致性**

- Google SRE — Handling Overload: <https://sre.google/sre-book/handling-overload/>
- Kubernetes — Controllers: <https://kubernetes.io/docs/concepts/architecture/controller/>
- Little's Law: <https://en.wikipedia.org/wiki/Little%27s_law>
- Martin Kleppmann — distributed locking（lease/fencing）: <https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html>
- Stripe — Idempotency keys: <https://docs.stripe.com/api/idempotent_requests>
- microservices.io — Transactional Outbox: <https://microservices.io/patterns/data/transactional-outbox.html>
