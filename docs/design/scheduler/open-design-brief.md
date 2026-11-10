# OpenDesign 前端设计任务书（四屏原型）

> 用途：交给 OpenDesign 生成 `dsh-task-cards` 的生命周期可观测前端原型，作为 `src/client` 实现基准。
> 状态：**OD 已打通**（agent `deepseek-harness` + 本地网关模型），由本会话执行生成。
> 关联：[A-core 方案](A-CORE-PLAN.md) §5 · [四层闭环设计](dsh-task-cards-scheduler.md)

---

## 1. 项目参数

| 项 | 值 |
| :-- | :-- |
| OpenDesign 项目 | `dsh-task-cards-scheduler-ui` |
| 产物 | 多屏 HTML 原型（四屏可切换、可点交互、明暗双主题） |
| 语言 | 中文界面 |
| 部署形态 | DSH Web 侧栏面板内（宽 420–560px）+ 900px 详情模态；**不是独立网站** |

---

## 2. 四屏规格

### 屏 1：卡片工作台

- KPI：待我决定 / 秘书处理中 / 执行中 / 待验收 / 需关注（失败或未知）。
- 视图：全部 / 待决策 / 执行中 / 待验收 / 失败。
- 卡片行：标题、**阶段徽标**（待决 / 已批待执行 / 排队 / 执行中 / 验收中 / 已确认 / 失败 / 未知 / 已升级 / 通知）、**等待原因**（等会话空闲 / WIP=1 非抢占 / 等用户升级 / 等回执 / 等验收结果）、**谁批的**（秘书 / 我 / 系统）、effect（read / write-code / destructive / external / spend）、相对时间、主操作。
- 通知卡与决策卡视觉明显不同（通知只需看到）。
- 多选后「合并查看」+ 逐项否决。

### 屏 2：卡片详情（生命周期时间线）— 核心屏

- 头部：标题、卡 id、`traceId`（可一键复制）、状态大徽标、来源会话入口。
- 纵向四段，每段可展开「为什么」：
  1. **决定**：批红人（秘书 delegated / 用户 user）、policy 版本、confidence、依据摘要、CaseFile 快照入口。
  2. **计划**：instruction、effect、**验收标准列表**（machine / evidence / manual）、executionMode（system / session）、priority、是否可抢占。
  3. **执行**：adapter、第几次 attempt、租约、耗时、原始 `ExecutionResult`（exit code / stdout 摘要 / 产物）。
  4. **验收**：每条 criterion 通过或失败 + 证据、判定者（system / 决策者 / 用户）、最终 outcome（confirmed / failed / unknown）。
- 证据抽屉：原始日志、diff、API 响应、文件哈希；可展开、可复制。
- 动作区按权限显示：重试、补偿、升级给用户、override、采纳方案。

### 屏 3：失败排查（焦点视图）

- 结论条：一句话说清「为什么不可接受」（哪条 criterion 失败、谁判的、证据在哪）。
- 三栏对比：**卡片要求** vs **实际执行结果** vs **验收判定**，逐条对齐，失败处高亮。
- 补救：重试 / 补偿 / 转人工 / 修改验收标准（生成新卡，需重新批准）。
- 明确区分三种根因：标准问题 / 执行问题 / 判定问题。

### 屏 4：策略与验收模板

- 升级规则：destructive / spend / external 默认升级给用户；低置信、无判例也升级；可预览「哪些会来找我」。
- 验收模板库：提交代码、部署、通知三类模板，可查看/编辑（机器项用等宽字体）。
- 观测设置：trace 保留数量、用户抽样审计比例。

---

## 3. 视觉与交互约束

- 高密度工具感（Linear / Sentry / Vercel 类克制），不要渐变营销风、不要大圆角。
- 等宽字体用于 `traceId`、命令、路径、exit code。
- 状态色语义固定：等待=琥珀、执行中=蓝、通过=绿、失败=红、未知=灰紫。
- 明暗双主题；键盘可达；单屏信息不靠 hover 才能看到。
- 真实感中文数据：c-42「跑测试并提交 feat/scheduler 分支」（write-code，秘书已批，执行失败）、c-43「删除生产库 tmp_orders 表」（destructive，已升级）、c-44「构建失败通知」（通知）、c-45「部署到 staging」（external，验收中）。

---

## 4. 环境事实（2026-11-08 核实）

| 项 | 值 |
| :-- | :-- |
| OD 容器 | `open-design`，daemon `127.0.0.1:7456`，认证关闭（`OPEN_DESIGN_DISABLE_API_AUTH=1`） |
| 外部入口 | `https://192.168.1.4:7456`（自签证书） |
| MCP 桥 | DSH web profile 的 `mcp-open-design`，工具 `mcp__open-design__*` |
| 可用 agent | `deepseek-harness`，模型 `local/deepseek/deepseek-v4.1-flash` |
| 生成命令 | `start_run(project, requestId, prompt, agent="deepseek-harness", model="local/deepseek/deepseek-v4.1-flash")` |
| 产物（2026-11-08） | `index.html`（112 KB 单文件，自包含）；截图见 [prototype/](prototype/) |

## 5. 执行方式

任务书即 §1–§3。恢复后：

1. `list_agents` 确认有可用 agent；
2. `start_run(project="dsh-task-cards-scheduler-ui", requestId=<新 UUID>, prompt=<§1–§3 全文>, agent=<可用 agent id>)`；
3. `get_run` 每 30–60s 轮询，成功后在 OpenDesign 里看预览，导出 HTML 原型；
4. 原型落到 `docs/design/scheduler/ui/`，作为 `src/client` 实现基准（映射见 [A-CORE-PLAN.md](A-CORE-PLAN.md) §5.5）。
