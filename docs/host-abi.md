# 宿主 ABI

插件对 DSH 的依赖收敛在 `src/host/host-api.ts`（宿主侧）与 `src/client/context.ts`（客户端侧）两个文件里。**DSH 升级时只核这两份表**：字段还在就没事，缺了就在这两个文件里补窄化类型，别处不写 `ctx.xxx` 的形状。

## 宿主侧（`HostRuntime`）

| 能力 | 用法 | 用途 | 缺失时 |
| :-- | :-- | :-- | :-- |
| `root.inject(names, cb)` | 声明依赖后拿 `ctx` | 取宿主服务 | 插件仍启动，功能降级 |
| `root.effect(fn, label)` | 注册清理函数 | 卸载时摘路由/停扫描器/撤 preset | — |
| `root.on('session/event' / 'agent/status' / 'agent/error')` | 订阅会话事件、回合状态 | 观察者触发、问题卡捕获 | 观察者不工作 |
| `agents.create({sessionId, meta:{cwd, agentPreset}, setup, agentOptions})` | → `{agent:{ctx}, dispose()}` | 建观察者会话 | 记录一条异常，跳过 |
| `agentPresets.register(def)` | → `dispose()` | 注册只有提示词的空 preset | 观察者退回默认 preset（带工具） |
| `agentPresets.select(agent, presetId)` / `composedPreset(ctx)` | 建会话后补选 preset | 兜底：factory 没认 `meta.agentPreset` | — |
| `agents.get(sessionId).followup(message)` | `{id, role:'user', content:[{type:'text',text}], source:{kind:'dsh-task-cards', form:'notice', summary, cardId}}` | 实时会话的卡片作答：聊天显示成「非人类触发」通知，不是用户气泡 | 先尝试 `agents.resolveAgent`，仍失败就保持卡片未投递 |
| `sessionController.agents.resolveAgent(sessionId)` | `{agent?: {followup}}` | 冷会话的卡片作答：先恢复成 live agent，再走 `followup`，保留自定义 source | 拒绝投递并保留卡片（不伪装成用户） |
| `sessionController.prompt(request, signal)` | `{requestId, sessionId, mode:'queue', content:[{type:'text',text}]}` | **仅老宿主**（没有 `agents.resolveAgent`）的最后兜底；source 被宿主重写成 `user`，只靠文本标记识别 | 当前 DSH 不走这条路 |
| `sessionController.modelCatalog()` | → `{groups:[{id, models:[{id,name}]}], default}` | `/models` 让用户选模型 | 只能跟随默认模型 |
| `agentDefaultModel.currentSelection()` | → `{provider, model, reasoningEffort?}` | 观察者默认模型 | 记录「没有可用模型」 |
| `workspaceRegistry.create(path, title)` | → `{id,title,path,sessionIds,attachSession}` | 观察者会话挂到自己的 workspace | 侧栏看不到，观察照常 |
| `workspaceRegistry.list()` | → workspace 列表 | 诊断路由 `/workspaces` | 路由报 `NO_REGISTRY` |
| `userQuestions.ask / askTimed / answer` | 提问与回填 | 问题卡两边都能答 | 提问建卡跳过 |
| `sessionQuery.readSession(id)` | → `{events, title?}` | 时间线、标题、`/inspect` | 相关路由报 `NO_QUERY` |
| `tools.schemas()` / `tools.restrict({deny})` | 读出全局工具并摘掉 | 观察者会话不带工具定义 | 观察者可能看到工具 |
| `webServer.register(route)` | → `dispose()` | 9 个面板后端路由 | 面板无后端 |
| `connection.requestRejection(req)` | → `0`/`403` | 用宿主自己的信任栅栏 | 退回「只认回环/白名单」 |
| `tools.guard(fn)` | `ctx.tools.guard(exec => string \| undefined)` → disposer | 回合内危险动作的**单调**前置拦截：同步判定，任何 guard 返回原因即 deny，后续 listener 翻不回「允许」 | 插件照常启动，但没有前置闸门：命中危险动作时只建卡 + 打日志，并在卡 detail 写「本宿主不支持前置拦截，请人工确认」（**不假装拦住了**） |
| `tools/pre-execute` waterfall | `ctx.on('tools/pre-execute', (exec, next) => …, { prepend: true })` → `{kind:'deny', reason}` | `tools.guard` 拿不到时的退路：可 async，能先建卡再 deny | 同上（退到「只建卡 + 告知」） |

> **工具门禁能力与实测边界（2026-11-10，`dsh` / `dsh-tools` 0.2.1-rc.5）**
>
> **接口存在（已核对源码）**：`tools.guard(fn)` 与 `tools/pre-execute` waterfall 都在；
> `ToolRuntime` 的 service 名是 `tools`（`super(ctx,"tools")`），pre-execute 派发点是
> `ctx.waterfall(carrier, "tools/pre-execute", exec, () => ({kind:"allow"}))`，`guard` 在
> waterfall 之后由 `guardReason()` 叠加。宿主自带插件 `dsh-experimental-auto-review`
> 用 `ctx.effect(function*(){ yield ctx.on('tools/pre-execute', …) })` 注册。
>
> **实测（真机会话，2026-11-10）：本插件注册的 listener 一次也没收到回调**。
> 注册日志与启动自检都正常，但在任意会话执行危险命令（`rm -rf /tmp/…`）时：
> `闸门回调`（guard 与 pre-execute 两个计数）恒为 0，命令照常执行。已尝试的两种挂法都无效：
> 插件根 ctx 的 `on('tools/pre-execute', handler, {prepend:true, global:true})`、
> 以及按会话把同一 handler 挂到 `agent.ctx`（从 `ctx.agents.get(sessionId).ctx` 取）。
> 结论：**工具事件按 agent 作用域派发，插件的根 ctx 不在其作用域链里；`global:true`
> 与 `agent.ctx` 两条路本文实测都收不到**（host 侧接线细节未在本仓库内验证）。
>
> **覆盖范围（真机实测补充）**：闸门只对**插件观察到、并成功把 listener 挂到 agent 作用域**的会话生效（`session/event` 第一次出现时挂载）。插件启动前就存在的会话、或从未产生事件的会话不在覆盖范围；**lead 会话实测「完全不拦」就属于这一类**（那是别的 workspace 的会话，没有被观察/挂载），不是全局失效。面板「策略 → 回合内闸门覆盖范围」也写了同一条，避免误解为全局生效。
>
> **实测已知事实（2026-11-10，真机多轮验证，升级 DSH 时按这几条核对）**
> 1. **同一 tool call 会被 `tools/pre-execute` 回调多次**（实测同一次执行 4 次，`callId` 相同）；故判定必须幂等：本插件用「每执行只判一次」缓存（`gate/judged.ts`，exec 对象 WeakMap + callId 60s）+ 券宽限期（核销后 5s 内重复判定仍视为允许），两者共同保证同一次调用只建 1 张卡、只消费 1 次券。
> 2. **waterfall 与 guard 拿到的 exec 不同源**（不是同一个对象，甚至 callId 也可能不同）——所以**不能**靠对象同一性去重，必须用语义 key + 宽限期。
> 3. 宿主顺序：`tools/pre-execute` waterfall 先跑 → allow 后再跑 `guard`；两条路径都判会重复消费券（这是「批准后仍拦」的最终根因）。
> 4. 工具事件按 agent 作用域派发；插件根 ctx 收不到时，用 `agent.ctx` 挂载 + `global:true` 才会回调（实测已生效）。
>
> **本插件的处理（诚实降级）**：不假装拦住了。首次通过 `session/event` 的 `tool/call`
> 观察到工具调用、而两个回调计数仍为 0 时，自动切到 `observe-only`：只建卡（卡上写
> 「本宿主未提供可用的前置拦截，请人工确认」）+ 打日志，并把模式写进日志
> （`闸门降级：本宿主未提供可用的前置拦截（…）`）。升级 DSH 后重新核对这几条，
> 若 listener 开始回调，`guard/pre-execute` 路径会自动恢复拦截（代码保留）。

## 客户端侧（`ClientContext`）

| 能力 | 用法 | 备注 |
| :-- | :-- | :-- |
| `window.__ModuleLoader__.load({id, factory})` | 模块顶层调用 | `id` 必须等于包名 `dsh-task-cards` |
| `factory(require)` | 拿 `react` / `react/jsx-runtime` | 这两个永远外置，不打进 bundle |
| `ctx.locale.register(ns, dict)` / `bind(ns)` | 中英字典与 `t()` | 字典值只能是字符串，插值用 `{name}` |
| `ctx.slots.inject(name, cb)` / `ctx.slots.register(spec, component)` | 注册侧栏入口与主面板 | 侧栏 `id` 必须等于主面板 `key` |
| `ctx.uiWorkspace.openSession(sessionId)` | 从卡片跳到原会话 | 可选，没有就禁用跳转 |
| `ctx.uiConversation.events.register(definition)` | → `dispose()` | 为卡片答复注册专用 Chat 节点（`source.kind='dsh-task-cards'`），不抢别的非人工触发 | 没有就退回 DSH 内置 turn-trigger |
| `ctx.slots.register({name:'conversation.chat.node', key})` | 渲染自定义节点 | 节点标题/正文/主题色 | 没有就显示通用节点 |

## 踩过的坑（升级时优先复现这几条）

1. **`sessionController.prompt` 的第二个参数是必需的 `AbortSignal`**，不传宿主内部直接抛。它会把 source 固定成 `{kind:'user', rpcId}`，所以优先用 `sessionController.agents.resolveAgent` + `followup`；恢复失败时不再用 prompt 伪装用户，而是保留卡片并报 `NO_AGENT`。只有完全没有 `resolveAgent` 的老宿主才退回文本标记。
2. **`agents.get(id)` 只返回实时 agent**：冷会话返回 `undefined`。`followup(message)` 必须给完整 `{id, role:'user', content, source}`；`source.kind !== 'user'` 时 UI 才渲染成 `turn-trigger` 通知，`inject`/`steer` 的落点分别是 next-step/唤醒，卡片答复要用 `followup`（next-turn）。
3. **给会话设了 `parentSession` 之后不能再直接投递 prompt**（会被判为 subagent routing）。观察者身份只靠 `subagent/descriptor` 事件表达。
4. **`systemPrompt.section({complete:true})` 会独占整段系统提示词**；观察者 preset 里只挂这一个提示词插件，才不会混进默认 persona / skill。
5. **preset 声明的 plugins 按声明方 baseUrl 解析**，所以写绝对 `file://` URL；loader 会缓存模块，所以 URL 带 `?v=<ts>` 让改动的提示词立刻生效。
6. **热重载会在同一进程再跑一次 `apply`**，preset 注册会撞 `Duplicate agent preset`。`preset.ts` 里先撤上一轮（disposer 存在 `globalThis` 的 Symbol 槽），再兜底清 `definitions`。
7. **客户端 bundle 必须带 `sourceMappingURL`**，否则面板报错时只能看到一行压缩代码。
8. **宿主代码是热重载的，别急着说「要重启」**：`dsh-hmr` 监听 profile `cordis.patch.yml` 里的 `root`
   （本机 = `/vol1/1000/开发/NAS/dsh-plugins`），产物落盘 1–2 s 后插件被替换、`apply` 重跑。
   只有装/升级依赖、改环境变量这类不在 HMR 队列里的变更才需要重启。验证方法见 `docs/commands.md#热重载`。

## 升级 DSH 后的核对清单

```bash
pnpm typecheck          # host-api.ts / context.ts 的窄化类型先报错
pnpm test               # 路由、store、观察者输入、契约、客户端渲染
pnpm build && pnpm test:abi   # 客户端 bundle 形状与体积
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:13080/dsh-task-cards/api/cards   # 401 = 栅栏生效
```

再打开面板点一遍：建卡 → 完成 → 删除 → 详情 → 保存提示词（细节见 `docs/verification.md`）。
