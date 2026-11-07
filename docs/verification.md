# 验收

改完面板或宿主，**在浏览器里点到它渲染出来才算改完**。下面是每次交付前的最小检查。

## 0. 静态

```bash
pnpm verify
```

全绿即：lint / 类型 / 125 个测试 / 构建 / ABI 形状与体积 / 代码预算。

## 1. 宿主活着

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:13080/dsh-task-cards/api/cards
```

期望 `401`（栅栏生效且路由已注册）。`404` = 插件没加载；`500` = 路由逻辑抛错（看宿主日志里的 `[dsh-task-cards]`）。

## 2. 面板（浏览器，`http://127.0.0.1:13080`，需登录）

| 检查 | 期望 |
| :-- | :-- |
| 侧栏「任务卡」入口 | 有图标 + 文案，点开进主面板 |
| 顶部 | 四个 KPI、卡片/提示词两个 tab、刷新按钮 |
| 卡片顺序 | 第一条是「要我决策」的未结束卡（不是最新生成的那张）；会话树按组内最该处理的卡排，组头显示「n 待处理」，已结束的组沉底 |
| 手写一条（回车） | 立刻出现在「手写卡片」组，行上有「知道了」，KPI 跟着变 |
| 观察者写的通知卡（`info` + `source=agent`） | 行上没有「知道了 / 忽略」，只有「删除」；卡片在视口里停满 2 秒才自动变灰进「已结束」——切走页签、滚出视口、隐藏窗口都不算 |
| KPI「要我知晓」 | 数最近 24 小时的知晓卡；读掉通知后数字不归零，超过 24 小时才掉 |
| 侧栏未读圆点 | 有未读知晓卡时「任务卡」图标右上角有圆点；打开卡片页自动已读后 ≤10 秒消失 |
| 点「知道了」(人手写的 info) | 卡片变灰、移到「已结束」，KPI 变化 |
| 点「删除」 | 卡片消失；刷新后仍然没有（落盘了） |
| 会话卡点「查看详情」 | 弹窗显示标题、卡本身、时间线（用户/模型分段）；Esc 与点遮罩都能关 |
| 提示词页 | 显示默认提示词；改一句 → 保存 → 再刷新仍在 |
| 深色主题 | `body[data-ds-dark-theme]` 下面板配色跟着变 |
| 客户端热重载 | 改 `src/client/**` 并 `pnpm dev`，浏览器不刷新也会出现新 UI（宿主 500 ms 轮询 bundle） |
| 宿主热重载 | 改 `src/host/**` 并 `pnpm dev`，**1–2 s 后**接口行为即变（不用重启 dsh）；用一次可观察的改动验证（如错误码/文案）。**但 chokidar 监听会静默死掉**：新端点一直是 404 而客户端已是新版，就是它；`systemctl restart dsh.service`（`NODE_ENV=production` 的部署里别把热重载当默认前提） |

## 2.1 三车道与来源（v0.4）

| 检查 | 期望 |
| :-- | :-- |
| 判断卡（`ask=judgment`） | 行上有「判断」chip；主按钮「批准」，详情展开票拟方案 |
| 许可卡（`ask=permission`） | 行上有「许可」chip；主按钮「批准并执行」、次按钮「拒绝」；详情显示「将执行 / 范围 / 影响 / 可撤回」；不可逆时行上变成「查看并确认」，详情必须勾选「我已知晓」才能点「批准并执行」 |
| 澄清卡（`ask=clarification`） | 行上有「澄清」chip；主按钮「补充信息」；详情显示问题、候选按钮、输入框（输入前「提交」禁用） |
| 来源块 | 详情里能看到「你说过」的真人原话；系统代发时显示「系统代发」和来源卡 id；面板打开着别的卡时显示「面板当时打开」 |
| 可逆诊断改动 | `write-code + reversible=true + 日志/插桩/复测` 的许可卡，在 `autoApproveDiagnostics` 或 `decisionAutoApply` 打开时自动放行，卡直接 done；两个开关都关时停在许可；含 commit/push/删除的始终停在许可。 |
| 对象不明的多卡指代 | 卡里说「三张旧卡」但没有 id 时，决策结果强制变成澄清「你指的是哪几张卡？请给出卡片 id」，不出现批准按钮。 |
| 自动执行闸门 | `advice.blockedReasons` 非空时，详情显示人话原因（缺能力 / 指代不明 / 影响等级不是只读） |
| 旧卡兼容 | 没有 `ask` 的历史卡按「判断」显示，不出现 `ask_undefined` |
| presence | 面板打开时每 20 s `POST /presence`，宿主返回 `{ok:true}`；打开卡片详情后心跳里带 `sessionId` / `openCardId` |
| 观察者→卡片→决策代理端到端 | 真机新会话发一条 55 字决策请求：观察者建出 decision 卡，`origin.triggerText` 等于用户原话、`sourceKind=human`；redecide 后出票拟，`advice.ask=judgment`、`effect=read`、`requires=[session.reply]` |
| 实时会话的卡片答复 | 批准后聊天里出现「任务卡答复」折叠块（不是用户气泡）；展开显示「这张卡把答复发回了原会话，触发了本轮回复」、来源卡片和去掉标记的正文，模型回复正常 |
| 冷会话的卡片答复 | `agents.get` 返回空时先 `sessionController.agents.resolveAgent` 恢复再 `followup`，聊天仍显示「任务卡答复」通知；恢复失败才退回 `prompt` + 文本标记 |

## 3. 观察者（可选，会产生真实模型调用）

1. 在任意会话跑一轮长回复（> `minReplyChars`）。
2. 回合结束后几秒内，面板应出现新卡（`fromAgent`）。
3. 卡片「查看详情」→ 时间线应显示那一轮的用户输入与模型输出。
4. `GET /dsh-task-cards/api/inspect?ids=<observerSessionId>`（或面板记录的会话 id）能查到请求头里的工具清单——观察者会话应为空或极少。

## 4. 决策代理人（会产生真实模型调用，约 20–30 s）

| 检查 | 期望 |
| :-- | :-- |
| 决策卡没有票拟时 | 行内显示「待出票拟」+「重新出票拟」；点它 → 卡片行 20 s 内出现结论 chip |
| 详情弹窗 | 琥珀色「票拟」块：结论 chip、把握、出票时间、摘要、2–3 个方案（名称 / 成本 / 长期收益 / 最坏情况 + 采纳）、依据、判例编号 |
| 提示词页 | 「决策代理人」区：开关、模型、提示词（placeholder 说明留空用默认画像）、判例库（空态 / reworked 标红） |
| 票拟合法性 | `basis` 不含编造的判例编号；无判例时写「无同类判例」且把握不是 high；试错期场景的 `gain` 应写「0 步」而不是「更清晰」 |
| 采纳（有副作用，别在真实决策卡上试） | 卡变 `done`、`answer` 落卡、判例多一条；只在不重要的卡上验 |
| 采纳参数错误 | `option: "9"` → 400 `BAD_OPTION`，卡状态不变（这一条可以随便测） |
| 返工标记 | 点「这个决定后来返工了」→ 判例 `outcome=reworked`，**下一次决策输入里不再出现这条** |

宿主侧日志关键字：`decision: 完成：N/M 张出票拟（纠正车道 K 张）`，失败是 `decision: 失败（N 张卡）：<原因>`。

## 5. 出问题先看哪

| 现象 | 先查 |
| :-- | :-- |
| 面板一片空白 | 浏览器 console：`__ModuleLoader__` 报错通常是 bundle 形状坏了 → `pnpm test:abi` |
| 面板有壳没有数据 | `/cards` 的响应（401/403 = 认证或栅栏；500 = 看宿主日志） |
| 侧栏没有入口 | `lib/client.js` 是否 rebuild（`ls -l lib/`）；宿主 HMR 日志 |
| 观察者不建卡 | `records.json` 最近一条的 `status` / `error`；`settings.enabled` 与 `minReplyChars` |
| 卡不落盘 | `$DSH_HOME/dsh-task-cards/cards.json` 是否存在、`.bad-*` 文件、面板顶部 warning |
| 决策卡一直「待出票拟」 | `journalctl -u dsh | grep decision`：没日志 = 决策阶段没被调用（看 `decisionEnabled`）；有「失败」= 模型/预设/超时问题 |
| 票拟字段缺 | `cards.json` 里该卡的 `advice` 对象；`options` 为空说明模型没给名字（解析会丢掉无名方案） |

## 6. 在容器/远程浏览器里验收（bsk、agent-browser）

bsk 驱动的 Chromium 不在宿主命名空间，它的 `127.0.0.1` 不是 dsh：

1. 走 LAN 桥地址 `http://192.168.192.1:13080`；首次需要 token 换 cookie：
   `TOKEN=$(journalctl -u dsh -n 200 | grep -o 'token=[A-Za-z0-9_-]*' | tail -1 | cut -d= -f2)`
   `curl -s -c /tmp/dsh.jar "http://192.168.192.1:13080/?token=$TOKEN"`
2. 之后用 `curl -b /tmp/dsh.jar` 直接打 API（`/cards`、`/decisions`、`/action`）。
3. **重启 dsh 后 token 会换**：取 token 的 journal 时间窗要落在重启之后，否则拿到空串 → 全部 401。
4. 页面里的 `.dtc-*` 元素点击有时被扩展浮层挡住；用 `evaluate` 里 `element.click()` 更稳。
