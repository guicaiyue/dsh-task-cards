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
| `agents.get(sessionId).followup(message)` | `{id, role:'user', content:[{type:'text',text}], source:{kind:'dsh-task-cards', form:'notice', summary, cardId}}` | 实时会话的卡片作答：聊天显示成「非人类触发」通知，不是用户气泡 | 退回 `sessionController.prompt` |
| `sessionController.agents.resolveAgent(sessionId)` | `{agent?: {followup}}` | 冷会话的卡片作答：先恢复成 live agent，再走 `followup`，保留自定义 source | 退回 `sessionController.prompt` |
| `sessionController.prompt(request, signal)` | `{requestId, sessionId, mode:'queue', content:[{type:'text',text}]}` | 最后兜底；source 被宿主重写成 `user`，只靠文本标记识别 | 记异常 |
| `sessionController.modelCatalog()` | → `{groups:[{id, models:[{id,name}]}], default}` | `/models` 让用户选模型 | 只能跟随默认模型 |
| `agentDefaultModel.currentSelection()` | → `{provider, model, reasoningEffort?}` | 观察者默认模型 | 记录「没有可用模型」 |
| `workspaceRegistry.create(path, title)` | → `{id,title,path,sessionIds,attachSession}` | 观察者会话挂到自己的 workspace | 侧栏看不到，观察照常 |
| `workspaceRegistry.list()` | → workspace 列表 | 诊断路由 `/workspaces` | 路由报 `NO_REGISTRY` |
| `userQuestions.ask / askTimed / answer` | 提问与回填 | 问题卡两边都能答 | 提问建卡跳过 |
| `sessionQuery.readSession(id)` | → `{events, title?}` | 时间线、标题、`/inspect` | 相关路由报 `NO_QUERY` |
| `tools.schemas()` / `tools.restrict({deny})` | 读出全局工具并摘掉 | 观察者会话不带工具定义 | 观察者可能看到工具 |
| `webServer.register(route)` | → `dispose()` | 9 个面板后端路由 | 面板无后端 |
| `connection.requestRejection(req)` | → `0`/`403` | 用宿主自己的信任栅栏 | 退回「只认回环/白名单」 |

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

1. **`sessionController.prompt` 的第二个参数是必需的 `AbortSignal`**，不传宿主内部直接抛。它会把 source 固定成 `{kind:'user', rpcId}`，所以优先用 `sessionController.agents.resolveAgent` + `followup`，只有恢复失败才靠文本标记区分系统代发。
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
