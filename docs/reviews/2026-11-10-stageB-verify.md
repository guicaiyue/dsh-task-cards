# 阶段 B 验收（2026-11-10）：授权与路由

> 验收人：card-analyst（只读；本文件为唯一写入；未改 `src/`/`tests/`、未 commit、未重启宿主）。
> 对象：阶段 B 交付快照 2026-11-10 16:36（HEAD `ac80930` + 未提交改动；优化员已结项 task-5，开始 C）。
> 判据：Lead 的 B 验收四条（§12 口径 / wait 结构 / notice 不进 KPI / escalated 独立车道 + override 可追溯）+ direction-review §9/§10/§12 + B 阶段补充（决策排水）。
> 探针：仓库外 `/tmp/dtc-stageB/`（数据集指纹、route 全量/剔除合成回放、wait 服务端降级入口级、Verdict 落账、KPI/车道、drain）；全部读冻结数据集或临时 Store，不依赖实现方测试。
> 浏览器（升级车道渲染、delegated override 按钮点击）**归 Lead**，本报告不下结论。

## 0. 结论

**阶段 B 通过。** 四条验收数字全部达标；两项收口复核通过；决策排水代码层与 Lead 真机 E2E 一致。附 **1 条非阻断返工（测试稳定性）** + 2 条观察（线上尚无 delegated 票、/case 字段数是 7 不是 6）。

| 验收项 | 目标 | 实测 | 判定 |
| :-- | :-- | :-- | :-- |
| 可逆升级率（剔除合成） | ≤30% | **1/7 = 14.3%** | ✅ |
| route vs §12 手工镜像 | 0 diff | **0/11**（真实 routable）；46 张真实卡全量也是 0 | ✅ |
| wait 结构闸门 | 缺失即 escalate，且服务端 | **7/7 全部 escalate**（入口级 `applyAdvice` 实测） | ✅ |
| notice 不进 KPI / escalated 独立车道 / override 可追溯 | 三条 | 代码 + 探针全过 | ✅ |
| Verdict 票上带 authority/policyVersion/confidence | 三项齐 | schema + 写路径实测（线上 0 张 delegated，见 §3） | ✅ |
| `GET /case` 返回案卷字段 | — | **7 个 key**（含 verdicts） | ✅ |
| 决策排水（后补） | 扫描/N/退避/开关/定时器清理 | 代码 + 探针全过 | ✅ |

## 1. 数据与口径（可追溯/可复现）

- **数据源**：`/data/dsh/dsh-task-cards/cards.json`（容器内，`DSH_HOME=/data/dsh`）；宿主 `/vol1/1000/docker/dsh-dev/data/dsh/dsh-task-cards/cards.json`。
- **冻结副本**：`/tmp/dtc-stageB/frozen/cards.json`，**sha256 `125613df82f61b2022304698adecd0e88514b3073a417d88737bdafaa009aeee`**，card-id-set hash `065b70407923c586`；口径 = cards.json 全量 52 张 → 合成标记（`gate` 或 title 命中 `/探针|probe|P0-|对抗|拦下|测试卡|合成/`）6 张 → **真实 46** → 真实 decision **15**（有票拟 11 / 无票拟 4）→ 非 destructive decision **11**（有票拟 **7** = 升级率分母）。
- 线上实时数据在验收期间仍在增长（16:31 为 52 张，16:37 已 53 张）；**所有回放数字以冻结副本为准**（`DTC_CARDS_FILE/DTC_DATA_DIR` 可复跑）。
- 背景更正（已同步 §12）：上一轮 §10 的「0/11」是我脚本 bug；正确基线就是本表。

## 2. B 验收数字（route 离线回放，冻结数据集）

实现文件：`src/host/decision/route.ts::route()`（纯函数，入参 `RouteInput{card, advice, policy, conflict}`；注意与 direction-review §5 写的 `route(caseFile)` 命名不同，实际入参更窄——CaseFile 是决策输入层，route 只吃路由所需字段；不算走样，建议文档对齐措辞）。

| 口径 | routable | deciders | 升级率 |
| :-- | :-- | :-- | :-- |
| 全量（含合成，**仅作对照**） | 17 | auto 4 / secretary 2 / user 11 | **11/17 = 64.7%**（与优化员数字一致） |
| **剔除合成（B 验收口径）** | 11 | auto 4 / secretary 2 / user 5 | 全量 5/11 = 45.5%（含 destructive） |
| **非 destructive routable（§10 分母）** | **7** | auto 4 / secretary 2 / user 1 | **1/7 = 14.3% ≤30% ✅** |

- 逐卡 reason 与 §12 一致：`effect=read → auto`（4 张）；`write-code 无判例 + high(0.95) → secretary`（1 张）；`write-code 有判例 + normal(0.8) → secretary`（1 张）；`write-code 无判例 + normal(0.8) → user`（1 张，唯一 user）；`pending_secretary`（无票拟）4 张单列、不进分母。
- notice 排除：`kind!=='decision'` → `route` 返回 `{decider:'auto', reason:'notice: 非决策卡'}`（防御性中立，不进决定状态机）。
- 置信映射在实现里显式：`shared/contract.ts:76 CONFIDENCE_VALUE = {high:0.95, normal:0.8, low:0.5}`（可审计）。

## 3. 两项收口复核

### 3.1 `Verdict.policyVersion` 真在票上 ✅

- schema：`shared/contract.ts::VerdictSchema` 含 `policyVersion: z.number().int().default(1)`（另有 authority/confidence/rationale/evidenceRefs/actorType/channel）。
- 写路径入口级实测（临时 Store + `applyAdvice` + `plans.recordVerdict`）：secretary 档 → plans.json `verdicts` 实际写入：
  `{actor:'secretary', actorType:'secretary', authority:'delegated', policyVersion:1, decision:'approve', rationale:'reversible+precedent+high-confidence', confidence:0.95, evidenceRefs:['P-1']}`。
- **线上 `plans.json` 当前 `verdicts: 0`**：Lead 的真机 E2E 走的是 `route.decider=auto`（只读卡→auto），auto 档不产生 delegated 票，属预期；第一张真实 secretary 票出现后即可在 `plans.json` 与 `GET /case` 里核对。

### 3.2 `GET /case?id=` 返回案卷 ✅

- `routes/case.ts:20-29` 返回 **7 个 key**：`verdicts`（阶段 B 新增：`plans.verdictsOf(id)`）、`ok`、`card`、`events`、`badLines`、`todo`、`evidence`。
- 说明：Lead 说的「6 个字段」应是「6 个案卷负载字段 + ok」；实际 7 key 无误。

## 4. 决策排水（后补项）代码层复核 ✅

实现：`src/host/decision/drain.ts`；接线：`wire.ts:144-155`。

| 检查 | 实测 |
| :-- | :-- |
| 扫卡条件 | `card.decision === 'pending_secretary' && !card.advice`（含手动建卡/迁移卡/重启卡）✅ |
| 每轮上限 | `MAX_PER_ROUND = 3`；探针：5 张 pending 首轮取 **3**，同 tick 再排取剩余 **2** ✅ |
| 重试上限/退避 | `MAX_ATTEMPTS = 2` + `BACKOFF_MS = 5min`；探针：+6min 后再次可取、每卡累计 2 次后不再取 ✅ |
| 开关 | `Settings.autoDecide` 默认 true（`config-contract.ts:32`、`defaults.ts:66`）；探针 `autoDecide=false → 0` ✅ |
| 定时器与清理 | 30s interval + `timer.unref()` + `root.effect(() => () => clearInterval(timer), '…decision drain')` ✅（卸载即清） |
| 事件 | 每张入队卡写 `decision:drain` 卡事件（探针累计 8 次）✅；日志「决策排水：本轮处理 N 张（剩余 M 张 pending_secretary）」✅ |
| Lead 真机 E2E | API 建卡 → 75s 内「决策排水：本轮处理 1 张」→ `advised` → `route.decider=auto`（Lead 侧证据，与本代码一致）✅ |

## 5. 面板/数据层（代码层）

- `kpiOf`（`client/stage.ts:96-140`）：notice/info 卡片 `continue` 前只计 attention，不进 pending/delegated；新增 `escalated / overridden / delegated` 计数。探针：`kpiOf(notice, escalated, delegated, overridden)` = `{pending:2, escalated:2, overridden:1, delegated:1, …}`（notice 未计 pending）。
- `laneOf`（`shared/state.ts:107`）：`decision==='escalated_user'` → `escalated` 独立车道；`groupCards` 含 escalated 组；探针 laneOf：notice=info / escalated=escalated / delegated=running。
- override 可追溯（`routes/action.ts:29-45,99-100`）：`POST /action {action:'override'}` → 写 `decision='escalated_user'`（事件 `delegated:overridden`）+ `authority='user'`（事件 `delegated:override-ack`），并 `assertPanelToken`；语义=人接管、不回滚旧状态。
- KPI 文案（`locale/workbench.ts:41`）：「待决 / 升级 / delegated / override / notice 不计」。
- 浏览器渲染与按钮点击归 Lead。

## 6. verify 记录（时间线，透明列出）

| 时间 | 结果 | 说明 |
| :-- | :-- | :-- |
| 16:31（B 交付态，含 drain 前） | **exit 0**：`55 files + 2 skipped`、**416 passed + 2 skipped**、bundle 126.9 KB、host 482.0 KB、ABI/三脚本/预算全过 | B 主体验收依据 |
| 16:36:58（+drain 最终态） | `418 passed + 2 skipped`、**1 failed**：`turn-gate.test.ts > 券的宽限期 > 核销后宽限期内重复判定仍放行…`（断言「闸门放行（一次性券）…card=c-」日志缺失） | 隔离重跑 `tests/host/turn-gate.test.ts` → **19/19 passed**；判定为**整套件并发下的偶发测试隔离问题**（gate 的券存在 `globalThis[Symbol.for('dsh-task-cards.gate-allow')]` 全局 Map，多个测试文件同 worker 共享 + 固定 sessionId/tool/argHash 可能互相消费/清理） |
| 16:38（C 已开工） | exit 2：`action.ts(216) TS2304 Cannot find name 'ensureApprovedPlan'` | **C 阶段在编辑中途**，不计入 B |

返工建议（非阻断）：`turn-gate.test.ts` 的宽限期用例应隔离全局券状态（唯一 sessionId + `afterEach` 清 `Symbol.for('dsh-task-cards.gate-allow')` 对应 key，或 setup 传入独立 permit 命名空间），并在 verify 里连续跑 3 次确认不 flake；否则 B/C 阶段每次全量 verify 都可能随机红。

## 7. 观察项

1. 线上尚无 delegated 票（`plans.json verdicts=0`）：schema/写路径已验，等第一张 secretary 票后线上核对（建议 B→C 期间观察一次）。
2. `/case` 返回 7 key（非 6）：文档/UI 若按 6 字段写会漏 `verdicts`，建议 contracts.md 明确列 7 个。
3. route 实际签名是 `route(RouteInput)` 不是 §5 写的 `route(caseFile)`：行为一致、入参更窄；建议 direction-review/contracts 对齐措辞，避免下一轮按文档找不到函数。

## 8. 阶段 C 验收器准备（Lead 指定五条）

1. **重复 dispatch = 0**：并发（同 tick 多卡/同卡多 tick）+ 重启两场景；读 `plans.json` 的 `attempts[]`、`idempotencyKey` 计数，与 journal 里 `dispatched` 事件数对账（期望 1:1）。
2. **依赖违反 = 0**：构造 `dependsOn` 链（A→B→C），用假 session 记录 dispatch 顺序；断言 B 在 A commanded 前不 dispatch、环依赖被拒。
3. **卡死 > 5min = 0**：租约 TTL 回收（推进 now）→ 卡回 waiting 且 `waitReason` 落盘；无 attempt 的 leased 记录被判定；`unknown` 必须落人。
4. **plans.json 损坏可恢复**：截断/非法 JSON/空文件三态，启动后应自愈（备份 + 空账本 + 日志），且不丢 cards/journal。
5. **语义等价**：13 次历史 dispatch 回放（用冻结数据集里的 journal 事件构造 plan/attempt，验证调度器对同输入产生同顺序/同 skip 判定）。
> 以上探针我按 §8 的结构建在 `/tmp/dtc-stageC/`（冻结数据 + 假 session + 可控时钟），C 交付即跑，不依赖实现方测试。
