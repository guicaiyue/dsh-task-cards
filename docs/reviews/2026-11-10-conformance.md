# 设计符合性矩阵（2026-11-10）

> 审计员：card-analyst（只读；本文件是唯一写入；未改 `src/`/`tests/`、未 commit）。
> 快照：HEAD `ac80930` + **142 个未提交改动**（P0-1..P0-6 轮次后）；代码基准时间 2026-11-10 14:47。
> 输入：`docs/design/scheduler/dsh-task-cards-scheduler.md`（551 行，简称 **S**）、`A-CORE-PLAN.md`（334 行，**A**）、`EVIDENCE-MODEL.md`（**E**）、`TODO-RECONCILE.md`（**T**）、`UI-UX-SPEC.md`（**U**）、`docs/{architecture,contracts,decision-agent,verification}.md`。
> 判定口径：**已实现**＝有类型/实例且行为符合；**部分**＝有骨架但边界不全；**未实现**＝全仓库未命中或无实例；**走样**＝有实现但与设计语义不同（写清走成什么、代价是什么）。
> 数据口径：`/vol1/1000/docker/dsh-dev/data/dsh/dsh-task-cards/`（生产型真实数据，下称「真数据」）：**51 张卡**、**134 条 journal 事件**、**76 条 records**、1 个 todo 文件、**无 evidence/、无 plans.json、无 policy.json**。

## 0. 结论摘要

| 层 | 设计 | 实现现状 | 判定 |
| :-- | :-- | :-- | :-- |
| 感知（观察者） | 回合结束建卡，草拟 acceptance | 观察者+兜底+跳过分流已落地；**不草拟 acceptance**；回合内靠 gate 外挂 | **部分**（acceptance 缺失，走样见 A1-§4.7） |
| 决策（秘书/批红） | Verdict 票 + delegated 终审 + 升级路由 | 只有「票拟建议」（advice），**0 条 delegated 票**；人在面板批；无 major/routine/notice | **未实现**（有建议无决策账） |
| 执行（调度/适配器） | ApprovedPlan + plans.json + 租约/attempt/补偿 | planId 字符串代替计划；无 plans.json；适配器入参是 Card；回执已补 | **走样**（卡即计划） |
| 验收（分级） | system/decision/user 三级 + acceptance 冻结 + Outcome | system 级可用（回执/证据）；decision 级 0；user 级=手动 reopen；Outcome 不落盘 | **部分** |
| 贯穿（三本账/时间线） | 三本账分离、可重放、policyVersion | 一本 cards.json + 一卡一 journal；replay 无启动自检；policyVersion 恒 3 | **走样**（三账合流） |
| 契约对象 | 7 个对象 | 2 个有类型有实例、1 个有类型无实例、4 个只在文档 | **部分（2/7）** |
| 状态机 | 决定 9 态 + 执行 10 态 | 实际 4 个状态字段，决定 0/9、执行 8/10 | **走样（合并成一套）** |
| 边界强制 | 三条规则 + 强制手段 | 只有「客户端/宿主」边界被强制；另两条靠自觉 | **未实现** |

一句话：**确定性内核、单一写入口、回执、闸门这些「骨架判断」是对的且真实救过场；但四层闭环的「决策层」和「计划/验收账」在实现里被压缩成「卡 + advice + 回执」，7 个契约对象只剩 2 个有实体的。这不是没缝完，是中间两层被降级实现。**

---

## A. 逐章符合性

### A1. S（四层闭环主设计）

| 章节 | 设计要求（关键句） | 代码位置 | 判定 + 理由 |
| :-- | :-- | :-- | :-- |
| §0 角色硬分离 | 「决策者不执行；执行系统不决策；观察者不验收；调度者不在内容判断链上」 | 决策者：`host/decision/*` 只写 `card.advice`（`apply.ts::applyAdvice`），但 `autoapply.ts` 可直接 `deliverToOrigin` | **部分**。分离在「建议 vs 执行」成立；但决策者没有 verdict/授权，做的事比设计少一层（见 §4.5） |
| §2.1 卡≠任务≠审批≠通知 | 4 类对象分开：卡（决策载体）/ Plan / 审批 / 通知 | 卡 `shared/contract.ts::CardSchema`；Plan 只有 `card.planId` 字符串；审批=card.answer+authority；通知=`kind=info` | **走样**：4 类压成 1 类。代价：无法表达「一张卡多个 plan」「一次审批绑多 plan」「通知与审批同源不同命运」 |
| §2.2 五维状态永不互相冒充 | 决定/投递/执行/验收/阅读五维分开 | `status`（5 值）+ `deliveryState`（10 值）+ `laneOf` 派生 6 车道 | **走样**：决定维不存在；投递/执行/验收三维合成 `deliveryState`。详见 §D |
| §2.3 执行≠验证≠验收 | 执行者只回原始结果 | `execution/adapter.ts::DispatchOutcome{accepted}`（只表示已接受）、`receipt.ts` 回执、`verification/verify.ts` 纯函数 | **已实现**（P0-3 后语义正确）✅ |
| §2.4 六个角色 | 观察者/决策者/执行系统/验证器/调度者/用户，各「能/不能」表 | 观察者 `observer/`、调度 `scheduler/`、执行 `execution/`、验证 `verification/`、用户=面板；**决策者角色只剩 advice** | **部分**：6 角色里决策者缺位（只出票拟，不批红） |
| §2.6 WIP=1/非抢占/租约 | 每会话 WIP=1，默认非抢占，先落租约再派 | `scheduler/admission.ts`（WIP=1、非抢占、90s 租约内存态）、`scheduler.ts` | **部分**：WIP/非抢占已实现且有测试；**租约不落盘**、`planned/cancelled` 状态不存在。真数据 13 次 dispatch 全走通 |
| §4.1 三本账 | 决定账/投递账/执行账，四本权限不交叉 | 无账本模块；卡内 `advice/answer/authority`、journal、records、todo、evidence 混放 | **未实现（三账合流）**。详见 §C |
| §4.2 对象模型（7 对象） | Card/Verdict/AcceptanceCriterion/ApprovedPlan/ExecutionResult/Outcome/CaseFile | 见 §B | **2/7** |
| §4.3 两套状态机 | 决定 9 态 + 执行 10 态（含 planned/cancelled） | 见 §D | **走样**：决定 0/9；执行 8/10；另有 todo 5 态做第 3 套 |
| §4.4 调度循环 | tick：revalidatePlans → expireLeases → route(major/routine) → dispatchDecisionJobs → order(readyPlans) → persistLease → dispatch → captureResults → verify → close/escalate | `scheduler.ts::tick` 只做「过期租约→准入→dispatch→回执→验收」；无 plans、无 route、无 decisionJobs、无补偿 | **部分**：主路径有；「计划校验/路由/补偿/升级」四项缺。代价：失败只有 failed/unknown，没有补偿动作 |
| §4.5 路由授权升级 | policy.json 决定谁先判；delegated 批红；票绑 decisionSeq；冲突→conflicted；低置信→升级 | `AUTHORITIES=['delegated','user','system']` 但**全仓库 0 处写 delegated**；无 major/routine/notice 命中；无冲突/陈旧态；升级只有 `waitReason=awaiting-user-escalation` | **未实现**。代价：所有非 destructive 决策也 100% 占用户注意力 —— 这正是设计要消灭的成本 |
| §4.6 执行系统 | `execute(plan: ApprovedPlan)`；system/session adapter；已达成交付再落盘 | `adapter.ts::execute(card: Card)`（入参是卡不是计划）；只有 session adapter；system adapter 只有接口注释 | **走样**：计划对象缺失，adapter 拿卡即兴决定投什么话（`execution/session.ts::dispatchTextOf`）。代价：执行无法被策略/acceptance 约束，也无法重试同一计划 |
| §4.7 验收 | acceptance 由观察者草稿→决策者确认→模板兜底；approved 时冻结；三级验证 | `verification/verify.ts` 用「todo+evidence+receipt」三源；`Card.acceptance` 有 schema 但**无生产写入点**（P0-4 引入，observer/decision/routes 都不写）；只有 system 级 | **走样**：acceptance 冻结链断在「没人写 acceptance」；decision 级验证者不存在。代价：E2 证据链在生产不可达（真数据 0 acceptance / 0 evidence 目录），任务卡永远无法 confirmed |
| §4.8 恢复/面板/可观测 | 启动 revalidate、租约恢复、trace 全链路、面板时间线 | drift 修复、receipt restore、`/case` 聚合、面板五段；**replay 自检缺失**；traceId 真数据 37/51 卡有、14 张缺（78/134 事件 traceId 为空） | **部分**：可观测有七成；「事实可重放」没有自检（见 §F-O3） |

### A2. A（模块边界/契约 v2/指标）

| 章节 | 设计要求 | 代码位置 | 判定 + 理由 |
| :-- | :-- | :-- | :-- |
| §2.2 A1 契约 v2 | Verdict/Acceptance/ApprovedPlan/ExecutionResult/Outcome | `shared/contract.ts`(Card/Acceptance/Advice)、`shared/execution.ts`(ExecutionResult)、`shared/outcome.ts`(VerificationOutcome)；**Verdict/ApprovedPlan 无** | **部分（2/5）** |
| §2.2 A2 内核 | CaseEvent + transition() + 单一写入口 + traceId | `kernel/{journal,transition,migrate}.ts`；transition 同 patch 写 status ✓；**迁移/路由/交付仍旁路写** | **部分**：单一写入口没有强制，实际 4 处旁路（§F） |
| §2.2 A3 调度 | 路由/队列/decisionSeq CAS/WIP=1/非抢占/waitReason | `scheduler/*`：队列/准入/waitReason ✓；CAS 仅 approve 用；路由/升级缺 | **部分** |
| §2.2 A4 执行 | ExecutionAdapter + session adapter | `execution/*` ✓（P0-3 后语义正确），system adapter 仍是注释 | **部分** |
| §2.2 A5 验收 | acceptance + 三级 | 见 A1-§4.7 | **部分** |
| §2.2 A6 面板 | 阶段徽标/等待原因/五段时间线/证据抽屉/失败三栏 | `client/{stage,components}/*`；证据抽屉以详情段+失败页呈现 | **已实现**（UI 侧基本齐）✅ |
| §2.2 A7 迁移 | 旧卡补字段、双读、可回滚 | `kernel/migrate.ts` + 备份 ✓；但「伪造 from=idle 事件」「新卡不生成 traceId」仍在 | **部分** |
| §3.1 目标结构 | `modules/` 下 observer/decision/scheduler/execution/verification 平行，prints kernel 唯一 | 实际目录是 `host/{observer,decision,scheduler,execution,verification,todo,evidence,reconcile,gate,policy,question,scanner,cards}`——没有 `modules/` 分组；`kernel/` 还存在但 verification/todo/reconcile 与它双向依赖 | **走样**：结构与命名未落地，但「目录恰好等于模块」的精神在。代价：边界无物理表达，模块互引无法用 lint 分组 |
| §3.2 规则 1 模块不互引 | 「只允许 shared/* 与 host/kernel/*」 | 实测 **25+ 处跨模块内部 import**：`decision/runner→observer/waiter`、`question/record→observer/payload`、`observer/context,turns→question/record`、`observer/prompt→decision/defaults`、`scanner→question/answer`、`routes/*→decision/question/observer` 内部 | **未实现**（全是自觉）。代价：四层分离只存在于命名，改一个模块会牵动多个 |
| §3.2 规则 2 只走 transition | 「routes/modules/client 都不许直接写 status」+ 扫描脚本/单测 | `kernel/transition.ts` 确实唯一写 deliveryState；但 status 仍被 `routes/action.ts`(complete/dismiss/acknowledge)、`question/deliver.ts`、`question/record.ts`、`scanner/scanner.ts`、`cards/store.ts::markSeen` 直写；**无脚本、无扫描测试** | **未实现**（强制手段 0）。代价：P0-7 修完的「单一真源」随时可被下一个功能破坏 |
| §3.2 规则 3 wire.ts 唯一组合根 | 「wire.ts 之外出现 new Scheduler/new Decision 由脚本拦截」 | 组合发生在 **3 处**：`index.ts`（kernel+定时器）、`kernel/assemble.ts`（new Scheduler/Verifier/Receipt/Todo/Evidence）、`wire.ts`（new Decision/Observer/Scanner） | **走样**：组合根有 3 个；无拦截脚本。代价：装配顺序与依赖图无法单点阅读 |
| §3.4 Card v2 字段 | revision/decisionSeq/traceId/authority/verdicts/acceptance/planId/deliveryState/waitReason/outcome | 有：decisionSeq/traceId/authority(可选)/acceptance(可选)/planId/deliveryState/waitReason/artifacts/gate/answers；**缺 revision、verdicts、outcome**；authority 枚举无 `none` | **部分** |
| §4.2 时间线可重放 | `replay(journal) === 快照`，启动校验+漂移标记 | `shared/case.ts::replay` 只被测试调用；`kernel/drift.ts` 只修 status 漂移，不做 replay 比对 | **未实现**（O3 未落地） |
| §4.3 O1–O8 | 8 条可观测验收标准 | O1 traceId 可点 ✓（详情）；O2 失败首屏三栏 ✓；O3 ✗；O4 ✗；O5 部分（78/134 事件 traceId 空、policyVersion 恒 3）；O6 ✓（失败页）；O7 ✗（无日志格式测试）；O8 未测 | **部分（约 3.5/8）** |
| §4.4 指标 | 阶段分布、p50/p95 时延、确认/失败/unknown/override 率、waitReason 分布、WIP 触顶、租约过期 | 面板 5 KPI + `stage.ts::kpiOf/kpiDetailOf`；**无 p50/p95、无 override 率、无抽样一致率、无埋点** | **走样/未实现**：有阶段分布与部分比率，无时延与质量指标。代价：无法回答「这套机制有没有让人少干活」 |
| §4.5 决策策略链 | unknown 先决策者再升级；failed 按 effect 分流；低置信升级 | `verification/verifier.ts` unknown→escalate（直接给用户）；`decision` 只在建卡后跑一次票拟，**不消费 unknown/failed** | **未实现**（策略链 0/6 情形）。代价：unknown 永久停在「需关注」，无人自动收敛（真数据 3 张 stuck unknown） |
| §5 七屏 | 工作台/详情/失败/策略模板/记录/设置/会话示意 | 见 A5 | **部分** |

### A3. E（证据模型）

| 章节 | 设计要求 | 代码位置 | 判定 + 理由 |
| :-- | :-- | :-- | :-- |
| §3 E0–E4 分级 + effect 最低证据 | 5 级；read≥E1、write-code≥E2、spend/destructive≥E4 | `shared/evidence.ts::EvidenceLevel='E1'\|'E2'\|'E3'\|'E4'`（**无 E0**）；`verification/verify.ts` 只要求「至少一条 ≥E2」；**effect→最低证据映射不存在**；spend/destructive 的 E4 人工确认未接验收 | **部分**：分级字段有，规则未落地 |
| §4 取证流程 | plan 声明 checker→执行后跑→EvidenceRecord→criteriaResults+evidenceRef+hash | `evidence/store.ts::check` + `routes/evidence.ts`（P0-4：只按 acceptance 收集）✓；`criteriaResults` 存在 `VerificationOutcome.criteria` 但**不落盘**；hash 只有 file | **部分** |
| §4 证据形态白名单 6 种 | exit/file/http/git/db/text + sourceRef | 只有 `exit`/`file`/`http`（`shared/evidence.ts::CheckSpec`）；sourceRef ✓（P0-4） | **部分（3/6）** |
| §5 有界预算 | ≤5 条/卡、单条 10s、总 ≤30s、语义 ≤1、深度 1、禁止递归 | 10s ✓；≤5 只限单次请求 acceptance 条数（`routes/evidence.ts::MAX_CHECKS`），累计无上限（实测 8 次调用 → 8 条）；30s 总预算 ✗；语义判定 ✗（`semanticNeeded` 只置位不消费）；深度 1 ✓（无 verifier-of-verifier 代码） | **部分** |
| §7 防造假最小组合 | 标绿需 E1/E2；清单改短要 reason；标准冻结；证据来自进程/文件系统 | E2 门槛 ✓；todo 基线锁 ✓（`todo/store.ts` baseline locked + needsReview）；标准冻结=acceptance 但无 writer；证据=checker 真跑 ✓ | **部分** |
| §8 V1–V6 | V1 预算、V2 confirmed≥E2、V3 证据可看、V4 无递归、V5 冻结快照、V6 低风险抽样 | V2 ✓；V4 ✓；V3 部分（证据列表+detail/sourceRef 可见，无原文链接/哈希时间展示）；V1/V5/V6 ✗ | **部分（2.5/6）** |

### A4. T（Todo 与对账）

| 章节 | 设计要求 | 代码位置 | 判定 + 理由 |
| :-- | :-- | :-- | :-- |
| §1.1 Todo 契约 | items/status/evidence/cost/blocker/baselineIds/frozen/revision | `shared/todo.ts` 全字段 ✓；`todo/store.ts` 增删改/冻结 ✓ | **已实现** ✅ |
| §1.2 规则1 done 必须带证据 | 无 evidence 的 done 记 `done-unverified`，不得 confirmed | `todo/store.ts:134` 仍是空操作（`item.status='done'` 赋值给自己）；防线只剩 `verify.ts` 的「至少一条 E2」 | **走样**：清单自述与证据没有区分。代价：清单完成度仍可被自述刷高 |
| §1.2 规则2 基线冻结（执行者提议→秘书确认） | 方案 B | `routes/todo.ts`：任何特权调用可 freeze；无秘书确认 | **走样**（半步）：只有「删基线要 reason」在执行 |
| §1.2 规则3 清单不是验收标准 | acceptance 是硬门槛 | `verify.ts` 只用 todo 判「完成度/分流」，confirmed 要证据/回执 | **已实现** ✅ |
| §2 验收简化 | 全绿+机器项 → confirmed；全绿但机器项失败 → failed | `verify.ts::confirmedOutcome` 要求 ≥E2；`incompleteOutcome` 处理未完成 | **已实现** ✅（条件：evidence 存在） |
| §3 三类分流 A/B/C | A 中断→unknown/failed；B 忘更新→一次补更新；C 代价变高→决策者评估 continue/rescope/abort | `verifier.ts`：A ✓（failed→retry）、B ✓（continue-session 一次）、C 半（blocked/cost.up→unknown+escalate，但没有决策者消费） | **部分（C 无出口）** |
| §4 防假账四防线 | 证据、基线、子项不计分母、机器项优先 | `completionOf` 只算 baseline ✓；`skipped` 计入完成（应只算 done）✗；机器项优先 ✓ | **部分** |
| §5 对账 | 确定性判据（产物存在/后续轮次/superseded）+ 模型提议 + 汇总/可重开/可审计 | `reconcile/reconcile.ts`：superseded ✓ + artifacts-exists ✓（P1-9 已补）+ destructive/spend 不自动失效 ✓ + 可重开 ✓ + summary ✓；模型提议 ✗ | **已实现（确定性部分）** ✅；模型提议未做 |
| §5.6 新增卡状态 invalidated | 卡状态加 `invalidated` | 未加进 `CARD_STATUSES`；用 `deliveryState='invalidated'` + `laneOf='closed'` 表达 | **走样（可接受）**：语义达到，契约未按设计改。代价：卡状态与计划状态继续混用 |
| §7 T1–T7 | 7 条验收标准 | T1（派发带清单）✗ —— **全仓库没有 dispatch 创建 todo 的路径**，真数据 todo 只有 1 个探针文件；T2 ✓；T3 部分；T4 ✓；T5 部分；T6 ✓（reconcile 测试）；T7 部分 | **部分（3.5/7）**；T1 是结构性缺失 → B 类分流在生产从不触发 |

### A5. U（UI/交互，简表）

| 屏/能力 | 设计要求 | 代码 | 判定 |
| :-- | :-- | :-- | :-- |
| 1 工作台 | KPI + 会话分组 + 六过滤 + 行内动作 | `WorkbenchTab.tsx`、`stage.ts::kpiOf/filterCards`、`CardRow/CardActions` | **已实现** ✅（分组头待处理已与 lane 同源） |
| 2 详情 | 五段时间线 + traceId + 证据 + 权限动作 | `DetailTab/DetailSegments`、`/case` | **已实现** ✅ |
| 3 失败排查 | 结论条 + 三栏对比 + 补救动作 | `FailureTab.tsx` | **已实现** ✅ |
| 4 策略与模板 | 授权矩阵（destructive 锁定）+ 验收模板 CRUD/试运行/版本化 + 观测设置 | `PolicyTab.tsx`：**硬编码 3 个模板只读展示**；许可证矩阵无 | **未实现**（U4/U5 不满足） |
| 5 记录 | 运行历史带 traceId、按 trace 搜、跳详情 | `RecordsTab`、`/records`（journal+skipped）；`records.json` **无 caseId/traceId** | **部分**（U2 不满足） |
| 6 设置 | 六组 + 暂停横幅 + 危险区 | `SettingsTab`；`SettingsSchema` 无执行/WIP/日预算/保留/通知项 | **部分**（六组≈4 组） |
| 7 会话示意 | 会话内介入 chip + 卡回复节点 | 节点有（`chat/taskCardAnswer`）；`sessionOverrides` 全仓库未命中 | **部分**（U7 不满足） |

### A6. 文档自身与实现的一致性

| 文档 | 声称 | 实际 | 判定 |
| :-- | :-- | :-- | :-- |
| `architecture.md`（94 行，11-10 01:03） | 目录树只有 cards/observer/decision/question/scanner/policy/routes（10 路由、21 组件、8 hooks）；「两条数据流」无内核 | 现已有 kernel/scheduler/execution/verification/todo/evidence/reconcile/gate，8 个新路由 | **过期**：架构图描述的是 P0 之前的插件 |
| `contracts.md`（11-10 13:13） | 卡字段、回执、P0-4、artifacts、gate、威胁模型、路由表 | 大部分与代码同步（P0 轮次已回填）；但我上一份复核发现的「actor 自报/planNonce 未校验」在实现里已由面板令牌收口，文档的威胁模型与 `routes/auth.ts` 一致 | **基本一致**（少数行为需按 p04-followup 的回填更新：nonce 仍只作标识） |
| `decision-agent.md`（11-07） | 决策代理人=「票拟建议者」：只写 advice、降车道、autoApply 闸门 | 与代码一致；但**与主设计 S §4.5 的「决策者=verdict+ApprovedPlan 的终审者」不是同一个角色** | **文档内部冲突**：decision-agent.md 描述的是收缩后的实现，主设计要的是授权批红 |
| `verification.md`（11-07） | 验收清单：125 个测试、旧面板四 KPI、旧 tab | 现状 389+ 测试、六 KPI/七屏、auth/todo/evidence 路由未覆盖 | **过期**（作为交付清单仍可用，数字与屏数需更新） |

---

## B. 7 个契约对象对照（Lead 指定核对项）

| 对象 | 设计字段要点（S §4.2 / A §3.4） | 代码里的类型 | 实例数据 | 判定 |
| :-- | :-- | :-- | :-- | :-- |
| **Card** | revision、decisionSeq、verdicts、actionability、acceptance、planId、deliveryState、waitReason、outcome… | `contract.ts::CardSchema`（212-265）：有 decisionSeq/traceId/authority/acceptance/planId/deliveryState/waitReason/artifacts/gate/answers；**缺 revision、verdicts、actionability、outcome** | 真数据 51 张：traceId 37/51、decisionSeq 37/51、acceptance 0、planId 0、gate 5、artifacts 有（字段存在）；**revision/verdicts/outcome 0** | **部分** |
| **Verdict** | 票：id/cardId/decisionSeq/actor/authority/channel/decision/optionId/text/rationale/confidence/evidenceRefs/at | **无类型**；仅 `AdviceSchema.verdict`（approve/reject/modify/wait 枚举）与 `card.answer` | **0 条**（advice 43 张是建议，不是票） | **只在文档 / 走样** |
| **AcceptanceCriterion** | id/kind(machine\|evidence\|manual)/check/expect/evidenceRequired/verifier | `contract.ts::AcceptanceSchema` = `{id, level, spec:{exit\|file\|http}}`——字段与设计不同（无 kind/check/expect/verifier，有 level） | 生产 **0**；测试夹具若干 | **有类型、无生产实例**（且形态走样） |
| **ApprovedPlan** | id/cardId/sessionId/instruction/effect/requires/acceptance/executionMode/priority/preemptible/idempotencyKey/constraints/lease/attempts | **无类型**；`card.planId: string` + `planNonce` 是唯一残余 | **0**；无 `plans.json` | **只在文档** |
| **ExecutionResult** | planId/executor/status/evidence[]/artifacts[]/error/durationMs/at | `shared/execution.ts::ExecutionResult`：planId/executor/status/dispatchedTurn/receiptTurn/replyChars/durationMs/at/error（无 evidence[]/artifacts[]） | **6 条实例**（journal `meta.execution`，真数据） | **有类型有实例，字段走样** |
| **Outcome** | planId/verified/criteriaResults[]/verifier/confidence/at | `shared/outcome.ts::VerificationOutcome`：verified/action/verifier/reason/criteria/semanticNeeded（无 planId/confidence/at） | **0 条落盘**（只作函数返回值 + 事件 reason） | **有近似类型、无实例** |
| **CaseFile** | card/origin/policy/precedents/capabilities/sessionState/acceptanceDraft/priorVerdicts/relatedPlans | **无类型**；近似物：`GET /case` 聚合 `{card,events,todo,evidence}`；`decision/input.ts::buildDecisionInput` 输出**给模型看的文本**（cardRow 无 acceptance/priorVerdicts/plans） | 每次决策运行临时生成，无落盘 | **只在文档 / 近似** |

**结论**：7 个对象里，**有类型且有真实实例的只有 2 个**（ExecutionResult、部分 Card）；AcceptanceCriterion 有类型但生产 0 实例；Verdict/ApprovedPlan/CaseFile 只存在于文档；Outcome 有近似类型但不落盘。这条是「四层闭环中间两层被降级」的最直接证据。

---

## C. 三本账（Lead 指定核对项）

| 账本 | 设计（S §4.1） | 实际落点 | 判定 |
| :-- | :-- | :-- | :-- |
| **决定账** | 决策者/用户写：verdict、authority、policyVersion、confidence、rationale | `cards.json` 里的 `advice`（建议）+ `answer/answeredAt/answeredVia`（人的动作）+ `card.events`；`precedents.json`（判例=事后行为记录）；`authority` 字段只有 7 张卡有值且**全是 system**，真数据 134 事件里 authority=user 13、system 121，**delegated 0**；`policyVersion` 恒 3（`kernel/transition.ts:91`） | **未分离**：无 verdict 账；authority/policyVersion 是事件字段而非账 |
| **投递账** | 调度者写：ApprovedPlan、租约、attempt、priority、waitReason | `cards.json.journal/` 的 `waiting/leased/dispatched` 事件（各 13 条）+ 卡上 `waitReason`（7 张）；**租约只在 `Admission` 内存 Map**；**无 attempts 数组、无 priority、无 plans.json** | **未分离**：投递事实=事件，计划对象不存在 |
| **执行账** | 执行系统写 ExecutionResult；验证器写 Outcome/criteriaResults/evidence/verifier | journal `executed` 事件 13 条（其中 6 条带 `meta.execution`）；`evidence/` 目录**不存在**（生产 0 条证据）；`todo/` 1 个探针文件；**Outcome 不落盘** | **未分离**：执行结果只在事件 meta，验收结论无账 |
| 存储设计 | `cards.json`（卡/verdict/acceptance）、`plans.json`（plan/lease/attempt/result/outcome）、`policy.json`（授权/升级/通知/审计） | 实际只有 `cards.json`（卡+acceptance+planId+gate+answer 全部塞一起）、`records.json`、`precedents.json`、`journal/`、`todo/`（1 文件）；**`plans.json` 不存在；`policy.json` 在数据目录不存在** | **走样（三账合一）** |
| `policy.json` 实质 | 授权/升级/通知/审计策略 | `host/policy/policy.ts`：只是**工具/技能白名单**（observer/worker/default 三角色 tools/skills），与授权、升级、阈值无关；`PolicySchema.version` 存在但从未被 transition 读取 | **走样**：名字对、内容不对 |

**代价**：三账合流意味着「谁在什么权限下批了什么」无法独立审计（只能从事件流反推）；「计划被重试了几次/优先级是否生效」无处查；「验收结论」无法与执行结果并列，失败排查只能看事件 reason。真数据里 3 张 `unknown` 卡、2 张 `decision/error` 记录、13 次 dispatch 的 attempt 次数都不可回溯。

---

## D. 两套状态机（Lead 指定核对项）

### D.1 设计：两套独立状态机

- **决定状态机（卡）** 9 态：`created → card_ready → pending_secretary → approved/rejected/escalated_user`，另 `conflicted`（冲突不猜）、`stale`（票绑版本已变）、`notice → closed`（S §4.3A）。
- **执行状态机（plan）** 10 态：`planned → waiting → leased → dispatched → executed → verifying → confirmed/failed/unknown`，另 `cancelled`（投递前取消）（S §4.3B）。
- 原则（S §2.2）：决定/投递/执行/验收状态**永不互相冒充**。

### D.2 代码实际：4 个状态字段，两套状态机合并

| # | 状态字段 | 取值 | 写入口 | 对应设计 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | `Card.status` | 5：open/acknowledged/scheduled/done/dismissed（`case-contract.ts:64`） | transition（派生）+ 路由/交付/扫描/已读直写 | 设计里没有这套；是 P0 前的卡状态遗产 |
| 2 | `Card.deliveryState` | 10：idle/waiting/leased/dispatched/executed/verifying/confirmed/failed/unknown/invalidated（`case-contract.ts:17-28`） | `kernel/transition.ts` 唯一写 | 把设计的**投递+执行+验收**三机合成一台；`planned`/`cancelled` 缺，`idle` 替代 planned |
| 3 | `todo.status` | 5：pending/doing/done/blocked/skipped（`shared/todo.ts:5`） | `todo/store.ts` | 设计之外的第三套（清单） |
| 4 | `laneOf` 派生 | 6 车道：closed/attention/running/decision/info/auto（`state.ts`） | 纯函数派生 | 设计之外的第 4 套（面板车道），P0-7 新增 |

映射：`statusForDelivery(deliveryState)` 一份表（`case-contract.ts:76`），把 `waiting..unknown` 全部收成 `done`；`invalidated→dismissed`；`idle` 不约束。

**设计的两套状态机下落**：
- 决定状态机：**0/9 命中**。`pending_secretary`/`escalated_user`/`conflicted`/`stale`/`card_ready` 在全仓库零命中；「待秘书」=没有字段；「升级用户」=只有 `waitReason='awaiting-user-escalation'`（不是状态）；「冲突」不存在（同一 `decisionSeq` 上无法出现两张互斥票——因为没有票）。
- 执行状态机：**8/10**（waiting/leased/dispatched/executed/verifying/confirmed/failed/unknown）；缺 `planned`（用 idle 代替）与 `cancelled`（用 `invalidated` 近似，语义不同：invalidated=对账失效，cancelled=投递前撤销）。

**走样代价**（按重要性）：
1. 「票绑 decisionSeq、冲突不猜、陈旧票失效」失去载体 → 两个标签页同时批、或改了内容再批，系统无法识别冲突，只能靠 CAS 后到者报 409（且只有 approve 带 `expectedSeq`）。
2. 「决定状态 ≠ 执行状态」被合并后，`status` 沦为执行态的投影；P0-7 为了修「批准后仍在待决策」把它收成派生值——**修好了显示，修掉了设计的第二套状态机**。现在「待秘书批红」这种状态在数据上不存在。
3. 没有 `planned`，=没有「已生成计划、未入队」这一可观测窗口；`invalidated` 同时承担「对账失效」「拒绝/取消」两种含义，面板只能靠 reason 区分。
4. 多出两套（todo + laneOf）说明：**每缺一个设计状态，就长出一个补丁状态机**。

---

## E. policy / authority / 路由升级（Lead 指定核对项）

| 设计（S §4.5 / A §4.5） | 代码 | 判定 |
| :-- | :-- | :-- |
| `authority: 'user' \| 'delegated' \| 'none'` | `AUTHORITIES = ['delegated','user','system']`（`case-contract.ts:55`）：缺 `none`、多 `system` | **走样**（枚举层面） |
| 秘书在授权范围内写 `authority=delegated` 的 verdict；越权 → 拒绝并升级 | **全仓库 0 处写 `delegated`**：仅出现在枚举、locale 文案、`stage.ts` 统计分支；`routes/action.ts` 人工批准写 `authority='user'`，scheduler/verifier 写 `system` | **未实现**（秘书批红路径 0；真数据 0 delegated） |
| 路由：major（destructive/spend/external/high/方向变更/低置信/无判例）→ 用户；routine → 秘书；notice → 只看 | `major`/`routine`/`notice` 路由**全仓库零命中**；`kind=info` 当通知；`ask` 只影响面板按钮文案 | **未实现** |
| 升级阈值（低置信/无判例/severity=high） | `confidence` 是 `high/normal/low` 枚举，**不是数值阈值**；`decision` 提示词要求「无判例 confidence 不许 high」（仅提示词约束）；升级动作只有 verifier 的 `action='escalate'`→`waitReason` | **未实现**（阈值/可配置均无） |
| 票绑 `decisionSeq` + `expectedDecisionSeq/expectedStatus` 409 | kernel CAS 支持（`transition.ts::assertCas`），但只有 approve 传；其它 action 无令牌 | **部分** |
| 每条秘书决定记 `policyVersion/rationale/confidence/evidenceRefs` | 事件有 `policyVersion` 但恒 3；`confidence` 只在 `advice`；`rationale`=`advice.basis`；`evidenceRefs` 永远 `[]` | **走样**（记录存在但无真实来源） |
| `policy.json`（授权/升级/通知/审计）；改策略留版本、放大权限需显式确认、destructive 不可委派 | 只有工具/技能白名单；`route /policy` GET/POST 白名单；无版本、无确认流程；destructive 的「不可委派」靠 `answer-guard.ts` 的 effect 正则（自动执行闸门），不是策略矩阵 | **走样** |
| 决策者与执行系统之间无直接调用（调度者转发） | `decision/autoapply.ts` 直接 `deliverToOrigin`（不经 scheduler/transition） | **走样**（自动执行旁路，真数据 6 条 auto 执行路径） |

---

## F. 边界规则强制手段（Lead 指定核对项）

| 规则（A §3.2） | 设计要求的强制手段 | 实际 | 判定 |
| :-- | :-- | :-- | :-- |
| 规则 1：模块之间不许互相 import 内部实现，只允许 `shared/*` + `host/kernel/*` | 「biome.json 的 noRestrictedImports 分组规则；违反 CI 红」 | `biome.json` 只有两条限制：`src/client/**` 禁 `node:*`/`../host`；`src/host/**` 禁 `react`。**没有模块分组**。`tests/shared/boundaries.test.ts` 也只查 client↔host、zod。实测 25+ 处跨模块内部 import（decision→observer、question→observer、observer→decision/question、scanner→question、routes→各模块内部、observer/preset→policy 内部） | **未实现（0 强制）** |
| 规则 2：所有状态变更只走 `kernel/transition.ts`；routes/modules/client 不许写 status | 「单测遍历 routes 断言无 status 直写；kernel 外出现 patch({status 用 scripts/check-*.mjs 扫」 | `scripts/` 只有 `check-budgets.mjs`、`check-client-bundle.mjs`、`release.mjs`；测试无 status 扫描。实测 status 旁路：`routes/action.ts`（complete/dismiss/acknowledge/answer）、`question/deliver.ts`、`question/record.ts`、`scanner/scanner.ts`、`cards/store.ts::markSeen`；deliveryState 侧唯一（transition） | **未实现（只在 deliveryState 上成立）** |
| 规则 3：`wire.ts` 唯一组合根 | 「wire.ts 之外出现 new Scheduler(/new Decision( 用脚本拦截」 | 组合在 3 处：`index.ts`（kernel + 定时器）、`kernel/assemble.ts`（new Scheduler/Verifier/ReceiptTracker/TodoStore/EvidenceStore）、`wire.ts`（new Decision/Observer/Scanner）；无脚本 | **走样（3 个组合根）** |
| 规则 4：时间线可重放 `replay(journal) === 快照` | 「测试 + 启动自检」 | `shared/case.ts::replay` 只被 `tests/shared/case.test.ts` 与 `kernel.test.ts` 调用；`drift.ts` 只修 status 漂移，不跑 replay 比对；启动日志无「状态漂移」检查 | **部分（测试有，自检无）** |
| O5 事件字段完整 | schema 校验（zod 严格模式） | `CaseEvent` 是 TS 接口（非 zod），journal 写入无校验；真数据 **78/134 事件的 traceId 为空串**、policyVersion 恒 3 | **未实现**（只有接口，无校验） |
| 前端边界 | client 不碰 Node/宿主；宿主不碰 React | biome + boundaries.test ✓ | **已实现** ✅ |

---

## G. 三个问题的回答

### G1. 设计方向本身有没有问题？——有三处设计判断在真实数据面前不成立

1. **「决定状态机」假设存在第二个决策者（秘书）**。真实数据：delegated 票 **0** 条、decision agent 只产 `advice`、71 次人工/自动动作全是 user/system；「pending_secretary / escalated_user / conflicted」没有任何数据。设计用 9 个状态支撑「秘书终审」，实际系统里只有 1 个决策人（用户）和 1 个建议者（模型）。**判断不成立的不是「分级授权」这个理念，而是「当时就有第二决策者」这个前提。**
2. **「ApprovedPlan 作为独立可重试对象」假设投递有中间态**。真实数据：13 次 dispatch 全部是 session adapter 把一句话 `followup` 回会话；「计划」= 那句话，「执行中」= 回执（turn 前进）。plan/lease/attempt/priority 这些字段在真实运行中没有承载物（plans.json 从未存在），而设计 4.4 循环里一半步骤（revalidatePlans/cancel/compensate/priority）因此空转。**结论：在「session 投递」这一类动作上，卡即计划是自然的；独立 plan 账本只有等 system adapter 落地才成立。**
3. **「acceptance 冻结 + E2 证据」假设验收标准可事先写成可判定规则**。真实数据：生产 **0 条 acceptance、0 条证据**；唯一被真实用上的「验收」是回执+回复非空（决策卡）和人工重开。用户真实需求是「批准后会话继续干、我知道它干了」，而不是「先写 DoD 再验 exit code」。**E2 证据链对「代码交付」有价值，但对占真数据 43/51 的决策/信息卡没有落点。**

补充两条「设计对、但价值被低估/高估」的判断：
- **被低估**：回合内闸门。它不在 A-core 的设计里（是后来补的），但真数据里 5 张 gate 卡（`rule:destructive-sql`、`prod-db:conn:prod`）说明**唯一真拦住事故的机制是它**，而主设计把感知层绑在「回合结束」。方向应改为「回合内感知优先，回合后补卡」。
- **被高估**：调度复杂度（优先级/抢占/urgent/租约）。单会话开发场景 WIP=1 + 回执足够；90s 租约与 180s receipt TTL 实际只承担「防卡死」，不是资源调度。

### G2. 偏离的根因：「没做完」为主（约 7 成），「做错方向」为辅（约 3 成）

**没做完（可补）**
- 7 对象缺 4（Verdict/ApprovedPlan/CaseFile 无类型，Outcome 不落盘）＋ Card 缺 revision/verdicts/actionability。
- 决定状态机 0/9；delegated 0 写入；major/routine/notice 0 命中；升级阈值 0。
- plans.json/policy.json（授权版）从未存在；三账未分离。
- 指标（p50/p95、override 率、抽样一致率）0；O3/O4/O5/O7 无校验。
- 边界强制手段（两条脚本 + 一组单测）0；acceptance 生产写入点 0；dispatch→todo 注入 0；records caseId/traceId 0。
- 这些都是「把设计里写好的东西实现完」即可，不需要重新设计。

**做错方向（需回退/重定）**
- **decision-agent 被实现成「建议者」而不是「授权决策者」**：`decision-agent.md` 把它写成只出票拟（这一版文档其实与实现一致，但与主设计 S §4.5 冲突）。结果是四层闭环的第二层在数据上不存在，用户注意力成本没有下降——这正是设计要解决的问题。
- **决定状态机被合并进执行状态机**：P0-7 为修「面板误判」把 status 变成 deliveryState 的派生值。修得对（消除双写），但**方向上是把设计的两套状态机合成一套**；代价是 pending_secretary/escalated/conflicted/stale 永久不可表达。正确做法是「两个独立字段 + 一个派生展示」，而不是「一个执行态 + 一个派生 status」。
- **验收链被设计成「先证据后判」再被实现成「先回执后判」**：P0-3 把 executed 定义成回执，是对的；但随后 P0-4 把 acceptance 冻结成唯一证据源，却没接生产写入点，导致验收在生产只剩「回执」一种判据——设计的三级验收退化为一级。（半方向、半没做完。）
- **三账合一**：实现选择了「一台 JSON + 一卡一 journal」，与设计「三本账分离、四本权限不交叉」相反。这个背离在单机单写者下是**合理的工程取舍**，但它使「权限不交叉」的设计承诺失效；应显式改文档而不是留一个不成立的承诺。

### G3. 要回到设计，最致命的 3 个缺失

1. **决策账（Verdict + delegated authority + 票绑 decisionSeq）**。没有它：秘书批红/升级路由/冲突/陈旧票/override 全部不存在，四层里的「决策层」在数据上是空的；用户仍是唯一决策人，系统只降低了「写字成本」（回投一句话），没有降低「看和批」的注意力成本——而后者才是设计目标。**这是第一位，因为它是「四层」与「投递插件」的分水岭。**
2. **ApprovedPlan + 投递账落盘（plans.json：plan/lease/attempt/priority/idempotencyKey）**。没有它：dispatch 只有「一次性投递」语义，没有可重试/可补偿/可解释的中间态；失败只能 failed/unknown，验收无法挂 planId 级 criteriaResults；重启/重投/幂等只能靠事件反推。**这是第二位，因为执行与验收两层都挂在它上面。**
3. **acceptance 的生产写入链 + Outcome 落盘（criteriaResults/verifier/confidence）**。没有它：E2 证据链在生产不可达（0 acceptance），验收结论只有事件 reason（无 criteriaResults），失败排查无法回答设计 O2/O8 的「标准错/执行错/判定错」。**这是第三位，因为它是「可验证」这套承诺的唯一载体。**
> 次致命（不在前三，但决定前三个能否维持）：**边界强制手段**（模块互引 lint、status 旁路扫描、组合根扫描、replay 启动自检、CaseEvent zod 校验）。A-core 自己写了「不靠自觉」，实际 5 条规则里 4 条只有自觉；没有它，前三个补完也会在几轮迭代里再次漂移。

---

## H. 附录：证据与快照

### H.1 数据统计（真数据 2026-11-10 14:46）

- `cards.json`：51 张。字段出现次数：traceId 37、decisionSeq 37、deliveryState 37、authority 7、gate 5、artifacts（有）、**acceptance 0、planId 0、planNonce 0、verdicts 0、revision 0、outcome 0、answers 0、evidenceEpoch 0**。
- status：open 6 / acknowledged 21 / done 22 / dismissed 2；deliveryState：idle 24 / confirmed 10 / unknown 3 / 缺失 14。
- 54 个 journal 文件、134 条事件：idle 39、confirmed 23、waiting 13、verifying 13、leased 13、executed 13、dispatched 13、unknown 7；`meta.execution` 6 条；**traceId 为空 78/134**；actor：scheduler 39 / system 56 / verifier 26 / executor 13；authority：system 121 / user 13 / **delegated 0**。
- `records.json`：76 条（decision/ok 24、observer/ok 26、observer/invalid 3、observer/empty 20、decision/error 2、observer/skipped 1）；**带 caseId/traceId 的 0 条**。
- `todo/`：1 个文件（`c-mwa76z0c-4mrzi.json`，内容 `probe note`，frozen=true）——生产中的 todo 尚未被真实使用。
- **`evidence/` 目录不存在；`plans.json` 不存在；`policy.json` 不存在**（`host/policy/policy.ts` 的默认白名单在内存）。

### H.2 关键代码索引

- 契约：`src/shared/contract.ts`（CardSchema 212-265、AcceptanceSchema 199-208、CardGateSchema 180-194）、`src/shared/case-contract.ts`（DELIVERY_STATES 17-28、CARD_STATUSES 64、AUTHORITIES 55、statusForDelivery 76-88）、`src/shared/case.ts`（CaseEvent 9-24、TRANSITIONS 60-120、replay 164-177）、`src/shared/execution.ts`、`src/shared/outcome.ts`、`src/shared/todo.ts`、`src/shared/evidence.ts`。
- 内核：`src/host/kernel/{journal,transition,migrate,drift,assemble,flags}.ts`。
- 调度/执行/验收：`src/host/scheduler/{scheduler,admission,queue}.ts`、`src/host/execution/{adapter,session,receipt}.ts`、`src/host/verification/{verify,verifier}.ts`。
- 决策：`src/host/decision/{runner,apply,autoapply,answer-guard,input,parse}.ts`。
- 闸门：`src/host/gate/{classify,gate,card}.ts`。
- 面板/边界：`src/shared/state.ts`（laneOf/statusForDelivery 派生）、`src/client/stage.ts`、`src/host/routes/auth.ts`、`biome.json`、`scripts/{check-budgets,check-client-bundle}.mjs`、`tests/shared/boundaries.test.ts`。
- 文档：`docs/{architecture,contracts,decision-agent,verification}.md`。

### H.3 本轮未复核（避免越界）

- 未跑 `pnpm verify`（符合性判定不需要；最近一次自述 389 passed + 1 skipped）。
- 未审 P0-1 闸门规则表本身（Lead 已拍板，审计边界外）；只核对了「它存在且真实拦截过」。
- 运行数据只读，未改动。
