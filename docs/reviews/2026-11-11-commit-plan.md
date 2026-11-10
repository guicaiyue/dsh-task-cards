# 提交方案（A→D 成果，2026-11-11）

> 现状：HEAD `ac80930`（设计稿提交），工作区 **183 个未提交改动**。本文只给分组与命令，**尚未执行**。
> 规则：`type(scope): 中文摘要`；不 push main；每个 commit 前 `pnpm verify`。

## 0. 前置检查（执行前逐项确认）

```bash
cd /vol1/1000/开发/NAS/dsh-plugins/dsh-task-cards
git status --porcelain | wc -l          # 期望 183
git diff --stat | tail -1               # 确认没有 lib/、临时文件
grep -n "lib/" .gitignore | head -2     # 产物不进库
```

若出现 `.tmp-*`、`*.bak-*`、`/tmp` 引用，先剔除。

## 1. 八个提交（顺序即依赖顺序）

### C1 契约与枚举
```
feat(contract): 补齐 Verdict/ApprovedPlan/Outcome/CaseFile 与决定状态机
```
文件：
- `src/shared/contract.ts`、`contract-enums.ts`、`contract-parts.ts`、`case-contract.ts`、`case-event.ts`、`case.ts`、`decision-state.ts`、`evidence.ts`、`execution.ts`、`outcome.ts`、`todo.ts`、`config-contract.ts`、`state.ts`、`routes.ts`
- `tests/shared/*`（contract/case/state/lifecycle）

### C2 三账分离与内核
```
feat(host): 拆出 plans/approval-policy 账本，决定状态迁移与启动自检
```
文件：
- `src/host/kernel/*`、`src/host/plans/*`、`src/host/policy/*`、`src/host/cards/*`、`src/host/stats*`、`src/host/wire.ts`、`src/host/index.ts`、`src/host/host-api.ts`
- `tests/host/{kernel,store,replay,plans-*,stats*,ledgers}*`

### C3 授权与路由
```
feat(host): 三档路由（auto/delegated/user）+ wait 结构闸门 + 决策排水
```
文件：
- `src/host/decision/*`、`src/host/routes/{decisions,case}.ts`
- `tests/host/{route,decision-*,verification}*`

### C4 计划与调度
```
feat(host): 调度消费 ApprovedPlan（dependsOn/priority/幂等/租约/重试上限）
```
文件：
- `src/host/scheduler/*`、`src/host/execution/*`、`src/host/routes/plan-create.ts`
- `tests/host/{scheduler,retry-storm,plans-scheduler}*`

### C5 验收与台账自证
```
feat(host): 三级验收 + acceptance 白名单 + todo 三类分流
```
文件：
- `src/host/verification/*`、`src/host/evidence/*`、`src/host/todo*`、`src/host/reconcile/*`、`src/host/gate/*`
- `tests/host/{verification,acceptance-chain,todo,evidence}*`

### C6 面板
```
feat(client): 决定状态分道 + Verdict 详情 + KPI 由 /stats 驱动
```
文件：
- `src/client/**`
- `tests/client/**`

### C7 边界强制与配置
```
build(ci): 组合根/模块棘轮/内核写入口三项强制检查接入 verify
```
文件：
- `scripts/check-single-composition-root.mjs`、`scripts/check-cross-module-imports.mjs`、`scripts/cross-module-allowlist.json`、`biome.json`、`package.json`、`tsdown.config.ts`、`vitest.config.ts`、`tests/setup-env.ts`

### C8 文档与验收报告
```
docs: 方向复核、设计符合性矩阵、A–D 四阶段验收报告与 E 计划
```
文件：
- `docs/**`、`AGENTS.md`

## 2. 执行方式

```bash
# 每个 Cx 之前
pnpm verify          # 必须全绿

# 逐个提交（示意）
git add src/shared/*.ts tests/shared/*.ts
git commit -m "feat(contract): 补齐 Verdict/ApprovedPlan/Outcome/CaseFile 与决定状态机"

# 全部完成后
git log --oneline -9
git status --porcelain   # 期望空
```

## 3. 提交后建议

- 打 tag：`git tag -a v0.5.0-a2d -m "A→D 四阶段收官"`（仅在产品负责人同意时）；
- 不 push main；如需备份，推 `feat/task-cards-a2d` 分支。

## 4. 风险

| 风险 | 处置 |
| :-- | :-- |
| 183 个改动里混入临时文件 | 提交前 `git status` 全量过一遍 |
| 某分组验证时依赖未提交的其它分组（跨组 import） | 按依赖顺序提交，每步 `pnpm verify`；若失败则合并相邻组 |
| 文档里写死了旧数字（如 444/446） | C8 前统一校对一遍 |
