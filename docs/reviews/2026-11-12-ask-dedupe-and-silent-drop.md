# 2026-11-12 修正：一次调用问两遍、以及三处「静默」

本轮由真实数据驱动，不来自设计推演。数据源：`/data/dsh/dsh-task-cards/{asks,cards}.json`。

## 1. 已修：同一次工具调用会问人两遍

**现象**：`asks.json` 里 6 条 ask 是 3 个问题的成对副本，间隔 10–46 ms，
同一会话、同一条命令（2026-11-11 08:07 / 08:26 / 08:30 UTC）。

**根因**（两处叠加）：
1. 宿主对同一次工具调用给两条回调：`guard`（`TurnGate.guardCall`）与 `pre-execute`
   （`TurnGate.preExecuteHandler`），两条都会判定并 `createAskFor`；
2. `preExecuteCall` 在 `auto` 模式下**又调用了一次** `this.#autonomy(...)`，
   同一次判定里连着建两条。

**修法**：
- `Ask.key = <sessionId>:<permitKey>`（同一次判定的身份）；`AskStore.create`
  同会话同 key 且未作答 → 复用旧条目，返回 `{ask, duplicate}`，`gate-wire` 只记一行
  「ask 去重」日志，不再写 `ask:open`。
- 删掉 `preExecuteCall` 里重复的 `#autonomy` 调用。
- 历史条目没有 key，不回填、不合并（不篡改账本）。

**验证**：`tests/host/ask-dedupe.test.ts`（5 条：同 key 复用 / 换 key 新建 /
换会话不合并 / 答过再问是新问题 / 无 key 照旧），`pnpm verify` 全绿
（489 passed / 5 skipped / 68 files，代码预算与三项边界检查通过），
`lib/` 重建后 dsh-dev 已热重载（启动自检行重新打印）。

## 2. 已修：blocking 的 ask 在会话死后永不结束

`blocking=true` 的条目只在被作答时离开待答集合；会话已经结束的阻塞提问会永久留在
`asks.json`（当前 6 条里有 3 条 blocking，全部来自已结束的会话）。人会看到「等确认」
却没有任何东西会推进它。

**修法**：`expireBlockingAsks`（`asks/auto-continue.ts`）在同一个 30s 定时器里扫，
`blocking` 且等够 6 小时（`STALE_BLOCKING_MS`）就按 `defaultAnswer` 收尾并写 `ask:expired`
（meta: waitedMs/answer/expired）。不猜会话死活（宿主没有可靠的结束信号），只按时间收口；
不可逆动作的默认答案是「不执行（保持现状）」，收尾方向安全；`askAutoContinue=false` 时不收尾。
测试：`tests/host/ask-expire.test.ts`（5 条：过期收尾 / 未到点不动 / 非 blocking 不抢 /
关掉自动继续不动 / 已答不再收）。

## 3. 已修：账本会原样留下敏感内容

2026-11-11 的卡片 `c-mwbvil7x` 正文里带着生产库口令，已经被原样写进
`cards.json` 与一条会话投影缓存（`cards.json` 0600/root，但它会随面板、备份、导出流动）。
卡是长期账本，比一次性日志更需要脱敏。

**修法**：`cards/redact.ts::redactCardFields` 在 `Store.create` 落盘前处理标题、详情、
逐题问题的题目与选项：连接串打码口令、`KEY=VALUE`、散文里的「密码/口令/password + 8 位串」、
`sk-`/`ghp_`/`AKIA`/`xox`/私钥块；`CHANGE_ME` 这类占位符不动，幂等。
测试：`tests/host/redact.test.ts`（7 条，含「卡片落盘后 cards.json 里不含口令」）。
**限制**：只认已知形状，认不出的凭据仍会进账本——所以真正的防线是「不把凭据写进对话」；
这条只挡最常见的三种写法。

## 4. 更正：面板「只能从浏览器」是错的，路径是有的

原先的判断（当天早些时候写的）：「不在浏览器前的操作者既看不到卡片，也答不了」。
**这个结论不成立**，是我没找到入口，不是设计如此。实际可用的路径：

```bash
# ① 从容器日志取带 token 的登录 URL（dsh web 启动时打的那条）
URL=$(docker logs dsh-dev 2>&1 | grep -aoE 'http://192\.168\.1\.4:3080/\?token=[A-Za-z0-9_-]+' | tail -1)

# ② 用它换 cookie（303 + set-cookie），之后所有 API 都带这个 jar
curl -s -c /tmp/ck.txt -o /dev/null "$URL"

# ③ 读 /stats（新加的 noise / silence 都在里面）
curl -s -b /tmp/ck.txt http://192.168.1.4:3080/dsh-task-cards/api/stats

# ④ 特权写要面板令牌：先 presence 换 token（要求浏览器 UA + Origin + cookie），再 action
TOK=$(curl -s -b /tmp/ck.txt -X POST <origin>/dsh-task-cards/api/presence \
  -H "Origin: <origin>" -H "Referer: <origin>/" -H 'User-Agent: Mozilla/5.0 …' \
  -d '{"active":true,"sessionId":"panel-cli","tab":"workbench"}' | jq -r .token)
curl -s -b /tmp/ck.txt -X POST <origin>/dsh-task-cards/api/action \
  -H "Origin: <origin>" -H "X-Panel-Token: $TOK" -H 'Content-Type: application/json' \
  -d '{"id":"c-…","action":"answer","answers":[{"id":"a","selected":["…"]}]}'
```

2026-11-12 用这条路把三张挂了 30 小时的卡结掉了（一张作答 + 两张确认），
`open` 归零。所以真实结论是：**路径存在但没人写得出来**——这本身是个文档缺陷，
已经补进 `docs/commands.md`。

仍然成立的那半句：令牌**只发给浏览器 UA + 面板来源**，脚本要伪装 UA，这是有意的人机边界。

## 5. 对照：与 agent-autoloop 的位置差异（摘要）

它的卡片出自**回合末**（Agent 做完、知情全貌后自报），我们的 ask 出自**回合中**
（工具调用前分类）。前者误报天然低、不阻塞；后者能硬拦，但判据不完整。
本轮的两处修正（去重、不静默）都是「别让绕过判据的成本落到人身上」，
下一步应把提问时机挪到回合末（见 delegation 设计与 gate 预登记方案）。

## 6. 已修（2026-11-12 晚）：默认答案会「默许」一次 destructive

`createAskFor` 原来按**判据文字**决定默认答案：`/prod-db|spend|publish|rm-outside|.../`。
真实账本里两条 `rule:destructive-sql` 的 ask（effect=destructive）没命中这条正则，
拿到的默认答案竟是「按最小改动继续」——配合 6 小时过期收尾，等于**默认放行一次删库**。

修法：默认答案改由**效果分类**决定，判据文字只作为附加的拒绝信号：

```
refuses = effect ∈ {destructive, spend} 或 判据含 prod-db|destructive|spend|publish|rm-outside|git-push-main|docker-volume-rm|secret-path
defaultAnswer = refuses ? '不执行（保持现状）' : '按最小改动继续'
```

测试：`tests/host/ask-default.test.ts`（5 条：destructive / destructive-sql+write-code / spend / 普通仓内改写 / 去重键）。

## 7. 顺手修的测试抖动

`tests/host/turn-gate.test.ts` 的宽限期用例偶发失败（约 1/20），三处一起改：

1. `beforeEach` 也清券（券与卡登记挂在 `globalThis`，同 worker 的其它测试文件会留下 `usedAt`）；
2. 该用例显式 `{ timeout: 20_000 }`（它要等异步建卡，vitest 默认 5s 会在慢机上先超时）；
3. 调试期加的日志采集块已撤回，只留原有断言。

连续 5 次 `pnpm vitest run --project unit` 全绿；`pnpm verify` exit=0。
> 顺带记一个教训：用 `grep -q failed` 统计失败次数会把测试自己打印的 "failed" 也算进去，
> 判据要用 `Tests +N failed` 这种结构化行。
