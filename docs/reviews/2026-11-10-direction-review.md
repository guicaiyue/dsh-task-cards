# 方向复核：设计与实现是否同一条路（2026-11-10）

> 作者：Lead（产品负责人）。范围：`docs/design/scheduler/*` 与 `docs/{architecture,contracts,decision-agent,verification}.md`
> 对照当前实现（`src/`，181 个 TS 文件，HEAD `ac80930` + 未提交改动）。
> 目的：判断**底层方向**是否正确，再给修复方案；不做局部缝补。

---

## 0. 结论先行

1. **设计方向是对的**：四层闭环（感知/决策/执行/验收）+ 职责分离 + 验收标准前置冻结 + 分级证据 + 非抢占 WIP=1 + 水平触发对账，这套判断与文献和真实事故都对得上，不需要推翻。
2. **实现不是"没写完"，而是"被拍平了"**：设计里 7 个契约对象只落地了 4 个的一半；**决定层（Verdict / CaseFile / 决定状态机 / 授权策略）整体缺失**，执行层只有会话适配器、没有 ApprovedPlan 对象，三本账挤在 `cards.json` 一个文件里。
3. 于是系统实际长成「**智能收件箱 + 一键批准**」，而不是设计的「**案卷流水线**」。用户抱怨的四件事——审批多、自由文本、票拟踢回、顺序靠人——全部是这一处结构缺失的直接后果，不是调参能解决的。
4. 修复方向：**先补决定层与计划对象（结构），再谈体验**；分四阶段，每阶段有可测指标和停手条件。

---

## 1. 我核对了什么

| 设计文档 | 关键设计判断 | 实现现状 |
| :-- | :-- | :-- |
| `scheduler.md§0/§4.1` 四层 + 三本账 | 决定账/投递账/执行账分人分权 | 只有 `cards.json`（卡+事件+票拟+验收混一起），无 `plans.json`/`policy.json` |
| `scheduler.md§4.2` 7 个契约对象 | Card(verdicts/actionability)、Verdict、Acceptance、ApprovedPlan、ExecutionResult、Outcome、CaseFile | 有 Card（部分字段）、Acceptance、ExecutionResult、`VerificationOutcome`（简化版 Outcome）；**全仓库无 Verdict[]、ApprovedPlan、CaseFile**（grep 确认） |
| `scheduler.md§4.3` 两套状态机 | 决定状态机 9 态 与 执行状态机 10 态正交 | 只有 `status`(open/done/acknowledged/dismissed) + `deliveryState`；**决定状态机未实现**（`open` 一个值吞掉了 pending_secretary / escalated / stale） |
| `scheduler.md§4.5` 授权与升级 | authority=user/delegated、major/routine/notice 路由、低置信升级 | `authority` 字段有、写入有；**policy 求值缺失**（`PolicySchema` 实际是 agent 工具权限，不是审批策略）；升级路由未实现 |
| `EVIDENCE-MODEL` E0–E4 | 按 effect 选最低证据；无 E2 不得 confirmed | ✅ 已实现（acceptance+level+sourceRef；E2 门槛在 test 里） |
| `TODO-RECONCILE` | todo 只推进度不算验收；三类分流（中断/忘更/代价变高） | 部分：todo 有、planId 绑定有、executor 不能自证；**三类分流未实现** |
| `A-CORE-PLAN§3.1/3.2` 模块边界 | kernel 唯一写入口、模块互不 import、wire 唯一组合根、biome 强制 | 部分：transition 已是写入口；**无 noRestrictedImports 强制、无 replay 一致性测试** |
| `decision-agent.md` | 决策代理人只出票拟、不替人做不可逆决定 | ✅ 基本符合（autoApply 闸门），但它拿到的输入不是 CaseFile（没有判例/策略/能力/会话状态的结构化注入），输出也没有 Verdict 对象 |

---

## 2. 设计本身需要修正的三处（读真实数据后）

设计方向对，但不是每一条都成立：

### 2.1 「秘书默认终审」在当前实现下会失真

设计假设秘书有**授权策略**（policy）与**判例**（precedents）作为依据，所以敢终审。
实现里 `advice` 只是一次 LLM 输出，**没有 policyVersion、没有绑定判例 id、没有置信度门槛的强制**。结果：真实数据 33 次票拟里 **19 次判 `wait`（58%）**——它不是在做决定，是在把决定退回给人。

> 修正：**wait 必须携带结构化问题**（缺哪条事实、给了就能决），否则 `wait` 不合法、按 `escalate` 处理。这是契约级约束，不是提示词能保证的。

### 2.2 「通知卡」不该走卡片流水线

设计说 notice「看到即结束」，但实现里 info 卡也是完整 Card（占 KPI、要 acknowledge、进事件流）。真实数据 46 张卡里 **24 张是 info（52%）**，我点了 21 次「知道了」。

> 修正：`actionability=notice` 的卡不进决定状态机、不占 KPI、不产生 verdict，只写**时间线事件**（可折叠）。通知不是工作项。

### 2.3 「非抢占 WIP=1」缺依赖表达

设计默认 FIFO + 非抢占，但**没有卡片依赖**。真实使用里我手动重排过 3 次（P0 顺序、闸门五轮、M2.1 插队）——用户被迫当调度器。

> 修正：ApprovedPlan 增加 `dependsOn: planId[]`，调度器按拓扑+FIFO 决顺序；卡上显示「等 A 完成」。

---

## 3. 实现偏离的根因（一句话）

**把「流水线」做成了「收件箱」**：
设计的每一步都是**有契约的对象**在流动（CaseFile→Verdict→ApprovedPlan→ExecutionResult→Outcome），
实现把它压成了**一张卡 + 一个 advice + 一串事件**。压平带来了三个后果：

1. **状态被合并**：决定状态和执行状态挤在 `status`/`deliveryState` 两个字段里，导致「已批准但没执行」「执行完但没验收」「失败但不知道谁管」在数据上不可区分——我们前几轮打的补丁（laneOf、drift、unknown→attention）全是在补这个缝。
2. **审批没有层级**：没有 actionability 路由，所有卡同一优先级进同一个面板；没有 policy，秘书没有授权边界，只能 `wait`。
3. **人机边界靠页面**：因为没有 Verdict 对象，"谁批的、依据什么、置信多少"只能散落在日志里，最后靠面板令牌这种传输层手段兜底（P0-4 的教训）。

---

## 4. 为什么不能再缝补（三次反噬的证据）

| 补丁 | 想解决 | 反噬 |
| :-- | :-- | :-- |
| `laneOf` 六车道 | 面板显示错 | 只是把两个状态字段的映射硬编码到视图层；底层仍是两套状态 |
| 执行回执（receipt） | 投递即执行 | 对了，但它只是把「执行」一环补上；决定层仍空，票拟仍可 wait 踢回 |
| 面板令牌（P0-4） | 防自批 | 边界建在 HTTP 层，同容器 root agent 可伪造；真正该做的是 Verdict 的 `authority/evidenceRefs` 审计 |

**共同点**：都在补「结果」，没补「结构」。

---

## 5. 修复方案（四阶段，方向优先）

> 原则：**先让对象模型对齐设计，再让行为对齐对象**。每阶段必须带可测指标，不达标不进下一阶段。

### 阶段 A：契约与账本（结构地基，2–3 天）

1. 补 4 个缺失契约（`shared/contract.ts`，zod 唯一真源）：
   - `Verdict`（id/cardId/decisionSeq/actor/actorType/authority/channel/decision/optionId/text/rationale/confidence/evidenceRefs/at）；
   - `ApprovedPlan`（id/cardId/sessionId/instruction/effect/acceptance/executionMode/priority/dependsOn/idempotencyKey/lease/attempts）；
   - `Outcome`（planId/verified/criteriaResults/verifier/confidence/at）；
   - `CaseFile`（card/origin/policy/precedents/capabilities/sessionState/acceptanceDraft/priorVerdicts）。
2. 账本分离：`cards.json`（卡快照）｜`journal/`（事件，已有）｜**`plans.json`**（计划/租约/结果/验收）｜**`policy.json`**（审批策略，与 agent 工具权限分开命名）。
3. 决定状态机落地：Card 新增权威字段 `decision: 'created'|'card_ready'|'pending_secretary'|'escalated_user'|'approved'|'rejected'|'conflicted'|'stale'|'notice'|'closed'`；
   `status` 降级为**派生视图**（与今天 `laneOf` 同层），不迁移旧数据也能跑。
4. 验收：replay(journal) === 卡快照；旧卡迁移后 `decision` 可推导；`pnpm verify` 全绿。

### 阶段 B：路由与授权（决定层，3–4 天）

1. `kernel/policy.ts`（纯函数）：`route(caseFile) → {decider: 'user'|'secretary'|'auto', reason, threshold}`；实现 major/routine/notice 三档与升级阈值。
2. 决策代理人输入改 `CaseFile`（含判例、策略版本、能力清单、会话状态）；输出 `{verdict: Verdict, plan?: ApprovedPlan}`，**`wait` 必须带 `question`**，否则按 escalate。
3. 升级路由：`escalated_user` 卡在面板单独车道，带「为什么升级/缺什么/秘书倾向」。
4. 验收指标：**wait 率 ≤20%**、升级率可解释（每条有 reason）、notice 不占 KPI。

### 阶段 C：调度与执行（3–4 天）

1. scheduler 消费 **ApprovedPlan**（不再直接消费卡）：priority + dependsOn 拓扑 + FIFO + 非抢占 WIP=1。
2. dispatch 前持久化 plan/lease（已有雏形），dispatch 后写 attempt；回执落 `Outcome` 的前置 `ExecutionResult`。
3. 验收指标：**同一 planId 重复 dispatch = 0**、**依赖被违反 = 0**、卡死 >5min = 0。

### 阶段 D：验收与面板（2–3 天）

1. 三级验收（system/decision/user）与 E0–E4 证据绑定；`todo` 三类分流（中断/忘更/代价变高）按 TODO-RECONCILE §3 实现。
2. 面板按**决定状态**分道（等秘书批/等用户升级/执行中/验收中/已结束），通知折叠；每条决定可展开 Verdict（谁、依据、置信、判例）。
3. 验收指标：**用户干预率 ≤0.3 次/回合**、**卡/回合 ≤0.3 张**、**假拒绝 = 0**、**unknown 必须落到人**。

### 停手条件

- 阶段 A 若 replay 不一致，不进 B；
- 阶段 B 若 wait 率不降到 20% 以下，不加新能力，先查 CaseFile 信息是否不足；
- 阶段 C 若重复 dispatch 不为 0，不进 D；
- 任何阶段若发现需要再改状态机，回到阶段 A 重新版本化，**不允许在补丁里加第三个状态字段**。

---

## 6. 与当前补丁的关系（保留 / 回退）

| 现有补丁 | 处置 |
| :-- | :-- |
| 执行回执（receipt.ts） | **保留**，它是 ExecutionResult 的前身，阶段 C 直接接 |
| acceptance + E2 门槛 | **保留**，阶段 D 扩为三级验收 |
| 闸门 gate | **保留**（effect=destructive 的第一道），但把它产生的卡改为 `escalated_user` + Verdict(authority=system) |
| laneOf 六车道 | **保留为视图层**，阶段 A 后改读 `decision` |
| 面板令牌 | **降级为"防误触"**，不再宣称是人机边界；人机边界改由 Verdict.actor/authority + 审计实现 |
| drift 修复 | 阶段 A 用 replay 取代，可删 |

---

## 7. 一句话交给下一轮

**不要再往「收件箱」上加功能。** 先把 `CaseFile → Verdict → ApprovedPlan → ExecutionResult → Outcome` 这五个对象立起来，把三本账分开，其余的体验问题会自己消失一半。

---

## 8. 与审计员符合性矩阵的交叉验证（2026-11-10 15:00）

审计员独立产出 `2026-11-10-conformance.md`（269 行，设计原文 + 代码 + 真实数据三方交叉）。两处结论互相印证，并把我的判断量化了：

| 维度 | 审计员数字 | 与本文判断 |
| :-- | :-- | :-- |
| 契约对象 | **2/7**（ExecutionResult、Card 部分）；Acceptance 有类型但**生产 0 实例**；Verdict/ApprovedPlan/CaseFile 只在文档 | 一致：被拍平 |
| 三本账 | **未分离**：无 plans.json；`policy.json` 实为工具白名单；决定账 0 条 delegated；`evidence/` 目录生产不存在 | 一致：账本缺失 |
| 状态机 | 实际 **4 个状态字段**；决定状态机 **0/9 命中** | 一致：决定层未实现 |
| 授权 | `delegated` **全仓 0 处写入**；policyVersion 恒 3；票拟自动执行绕过调度 | 一致：授权未落地 |
| 边界 | 只有 1/4 有强制；模块互引 25+ 处；status 旁路 5 处；组合根 3 个；78/134 事件无 traceId | 补充：我的文档低估了边界侵蚀 |

### 8.1 设计内部有一处必须裁决的矛盾

- `scheduler.md §4.5`：决策者（秘书）在授权范围内**终审**，`authority=delegated`。
- `decision-agent.md`：决策代理人**只出票拟**，不替人做不可逆决定，自动执行仅限可逆。

实现按后者做了，所以真实数据 **0 条 delegated 票**、58% 票拟判 wait。两份文档方向相反，不裁决就无法确定 B 阶段怎么做。

### 8.2 裁决建议（我作为产品负责人拍板）

**采纳「分级授权」，但把授权边界写死成可枚举规则**，理由：用户要的是「少做决定」，纯建议者模型天然降不下来。

| 档 | 谁定 | 条件（全部满足才可 delegated） |
| :-- | :-- | :-- |
| auto | 系统 | `effect=read` 或可逆诊断写；有判例支持；无外部副作用 |
| delegated | 秘书终审 | 可逆 + 有判例 + confidence≥0.8 + 不碰生产外部 + 非 spend/destructive |
| user | 用户 | 不可逆 / spend / destructive / 方向变更 / 低置信 / 无判例 / 有冲突票 |

并且：**delegated 票必须可在面板一键 override（补偿而非回滚）**；delegated 率与 override 率进 KPI，作为「授权是否放太宽」的监控。

### 8.3 对分阶段方案的调整

- 阶段 A 增补：**CaseEvent 改 zod 校验 + traceId 必填**（审计员数据：78/134 事件 traceId 为空，时间线不可重放）；
- 阶段 A 增补：**边界强制**（biome noRestrictedImports 分组 + `check-kernel-only-writes.mjs` + `check-single-composition-root.mjs`），因为 A-core 自己写了「不靠自觉」；
- 阶段 B 前置：先落 §8.2 的授权表（policy.json），再做路由；
- 阶段 C 增补：`plans.json` 承载 plan/lease/attempt/priority/idempotencyKey，替代内存租约；
- 阶段 D 增补：acceptance 生产写入链（observer 草稿 → decision 确认 → approve 冻结），否则 E2 证据链永远不可达。


---

## 9. 指标口径修正（2026-11-10 15:20，审计员预研后）

审计员用 43 条真实票拟离线回放，证明原指标「wait 率 ≤20%（分母=全部决策卡）」**数学上不可达**：

| 口径 | 用户/等待比例 |
| :-- | :-- |
| 现状 `verdict='wait'` | 23/43 = 53.5% |
| §8.2 严格（auto 也要判例） | 37/43 = 86.0% |
| auto=只读不要求判例 | 15/43 = 34.9% |
| 只看 effect/可逆 | 10/43 = 23.3% |

硬约束：`destructive` 必须用户终审，真数据里就有 10 张 = 23.3%。**分母含全部决策卡时 ≤20% 不可能。**

### 9.1 裁决：拆成三个指标，不再用一个比例包打天下

| 指标 | 定义 | 目标 | 意义 |
| :-- | :-- | :-- | :-- |
| **升级率** | user 档 / 全部 decision 卡 | ≤30% | 用户被叫的频率（destructive 天然 ~23%，留 7% 余量） |
| **wait 率** | `verdict=wait` / 秘书处理过的 decision 卡（不含 notice） | ≤20% | **秘书功课不够**，而不是用户被叫；wait 必须带结构化 question |
| **用户决策密度** | 用户实际拍板次数 / 会话回合数 | ≤0.3 | 直接对应用户体感（现状约 0.6） |

### 9.2 授权表修正（§8.2 的 A 档）

- **auto**：`effect=read` 或可逆诊断写 → **不要求判例**（只读卡占真数据 19 张，若要求判例会把它们推给用户，直接顶破指标）；
- **delegated**：可逆 + **有判例** + confidence≥0.8 + 非 spend/destructive/external；
- **user**：不可逆 / spend / destructive / external / 方向变更 / 低置信 / 冲突票；**「无判例」只对 write-code 及以上作为升级理由**，对只读不成立。

### 9.3 验收方式

用 `route(caseFile)` 对 43 张真实卡离线回放（不跑模型），统计：升级率、wait 率、每条升级 reason、wait 是否带 question、notice 是否进 KPI。回放器由审计员自建，不依赖实现方的测试。


---

## 10. 指标二次修正（2026-11-10 15:35，审计员实测后）

审计员用真数据离线回放，指出 §9 仍有两处不可达/不可测。裁决如下：

### 10.1 升级率：排除 destructive 后统计（更贴近「授权质量」）

真数据：`kind=decision` 21 张，其中 **destructive 10 张（47.6%）**。若分母含 destructive，30% 数学不可达——但这不是实现问题：**destructive 本来就该用户终审**。

改为两个指标：

| 指标 | 定义 | 目标 |
| :-- | :-- | :-- |
| **可逆升级率** | user 档 / **非 destructive 的 decision 卡** | **≤30%**（离线回放：0/11 = 0% ✅） |
| **危险动作密度** | destructive 尝试次数 / 回合数 | 越低越好，当前 10/71 ≈ **0.14/回合**，作为行为观察值 |

### 10.2 wait 率：改成结构判据，不设数值闸门

离线 replay 只能回放路由，**不能预测新 prompt 会不会判 wait**（wait 是模型输出属性）。且旧数据 7 张 wait 全是 destructive，路由后必然落 user 档——用 wait 率做闸门会奖励「把 wait 改成 user」这种假优化。

| 判据 | 要求 |
| :-- | :-- |
| **结构闸门（离线可验）** | 每条 `wait` 必须带 `question` + `reason` + 可直接决定的选项；缺任一项 → 降级 escalate，**计入升级率** |
| **基线报告** | 旧 prompt wait 率 **41.2%**，只作 baseline 记录，不作闸门 |
| **抽样（可选）** | 若 B 完成后需要评估新 prompt 效果，允许 **10 张抽样重跑**（10 次模型调用），仅作观察 |

### 10.3 决策密度 baseline
27 次用户动作（approved 8 + answered 8 + denied 5 + dismissed 2 + completed 4）/ 71 回合 ≈ **0.38/回合**；目标 ≤0.3。分母口径以会话日志 turn 数为准，由审计员出精确 baseline。

### 10.4 决定状态机是 10 个值，不是 9
created / card_ready / pending_secretary / escalated_user / approved / rejected / conflicted / stale / notice / closed。

---

## 11. 阶段 A 验收后的两处裁决（2026-11-10 16:05）

验收报告：`2026-11-10-stageA-verify.md`（6/7 过，2 个边界返工点）。我对两个返工点做如下裁决：

### 11.1 组合根（R1）：接受「分层组合」，不接受「任意多处」

严格「wire.ts 单一组合根」在本仓库尺寸下不可行：`wire.ts` 已 250 行、`assemble.ts` 90 行，合并必破 300 行预算，拆文件又会增加组合点。

裁决：**分层组合根**，三层各有唯一职责，禁止第四处：

| 层 | 文件 | 只做什么 |
| :-- | :-- | :-- |
| 入口 | `index.ts` | 生命周期、调用 wiring |
| 模块装配 | `wire.ts` | 事件接线、模块实例化、`root.inject` |
| 内核装配 | `kernel/assemble.ts` | Scheduler/Verifier/Receipt/Todo/Evidence 的构造 |

强制：`check-single-composition-root.mjs` 必须同时检查 `root.inject|ctx.inject` **与** `new <Module>(`，只允许上表三文件；`docs/architecture.md` 与 A-CORE-PLAN §3.2 同步改为「分层组合根」。

### 11.2 模块边界（R2）：用「棘轮」而不是一次清零

现存跨模块内部 import **55 处**，一次性清零会变成大规模重构，风险大于收益。

裁决：**棘轮机制**——
1. biome `noRestrictedImports` 覆盖设计列出的模块对（decision→scheduler|observer|question、question→observer、observer→decision 等）；
2. 新增 `scripts/check-cross-module-imports.mjs`：读 `scripts/cross-module-allowlist.json`（冻结现存 55 处），**新增违规 → exit 1；allowlist 里有、代码里已无 → 也 exit 1**（迫使清理）；
3. `docs/contracts.md` 写明「当前覆盖范围 + 棘轮规则」，不允许留「看起来强制实际只有一对」的假象。

### 11.3 顺带修掉的两个观察项
- `approval-policy.json` 外层 `.default({auto:[],delegated:[],user:[]})` 覆盖了内层默认规则串 → 线上文件三档全空。**这是 B 阶段的阻塞项**：`route()` 读它会拿不到任何规则。去掉外层 default 或改为 `{}` 让内层默认生效。
- `plans.json` 0 条计划属预期（写入在 C），A 只要求存在可写。

---

## 12. 阶段 B 的两个口径裁决（2026-11-10 16:15）

审计员自纠：§10 的「升级率 0/11」是其脚本 bug（tier 对象当索引键），真实数据是 **非 destructive decision 卡 11 张**（read 4 / write-code 无判例 2 / write-code 低置信 1 / 尚无票拟 4）。基线以更正后为准。

### 12.1 `route()` 对「无票拟（card_ready）」的默认 decider = 秘书

无票拟不等于需要用户拍板——它只是**还没跑决策代理人**。默认派给秘书产出票拟；秘书跑完再按策略路由。否则会把「系统还没干活」算成「用户被打扰」。

### 12.2 升级率分母与「无判例」的轻重

- **升级率** = user 档 / **有票拟且已路由的卡**（auto+delegated+user）；无票拟→秘书的不计入分母，单独报 `pending_secretary` 数。
- **「无判例」的权重按 effect 分档**（避免「无判例」把高置信的可逆改动全推给用户）：
  - `effect=write-code` 且 **confidence ≥0.9** → 允许 delegated（高置信补偿无判例）；
  - `confidence <0.9` 且无判例 → user；
  - 不可逆 / spend / destructive / external / 方向变更 / 冲突 → 永远 user。

用真实 11 张回放：read 4 → auto；write-code 无判例 2 张若置信 ≥0.9 → delegated；低置信 1 → user；无票拟 4 → 秘书。**预期 user = 1/7 = 14.3% ≤30%**。

### 12.3 目标不移动

≤30% 的闸门不变。若实现后仍 >30%，先查 CaseFile 信息是否不足（判例/置信没喂进去），**不许把目标改成 40%**。

---

## 13. 阶段 C 的边界定调（2026-11-10 16:45）

审计员在 C 代码上提前跑通四个探针（同键不重复派发、依赖违反=0、租约回收、plans.json 三态自愈），并指出三处需要定调的边界：

1. **租约回收实际是 2×TTL**（`expiresAt < now - ttlMs`）：不是 bug 但会随 ttl 放大 → 改为 `expiresAt + SKEW_MS < now`（SKEW=5s），写进契约。
2. **旧事件无幂等键**（13 次历史 dispatch 仅 6 条有键）：启动时给 dispatched 无键的旧 plan 补稳定键（`legacy:<cardId>:<turn>`），或明确「不参与幂等」并单列。
3. **at-least-once 边界**：崩溃在 execute 成功与 recordAttempt 之间会重派一次。指标名称统一为「**同幂等键不重复派发**」，**不得**表述为「重复 dispatch=0 / exactly-once」。

结论：C 的验收口径以「同键不重复 + 依赖不违反 + 卡死>5min=0 + 账本损坏自愈」为准，exactly-once 不在承诺范围内。
