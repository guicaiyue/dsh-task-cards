# 命令

```bash
pnpm install          # 首次；会跑 prepare → pnpm build
pnpm dev              # tsdown --watch：改 src 自动重建 lib/（宿主 HMR 会热重载客户端）
pnpm build            # 产物到 lib/（index.js / observer-prompt.js / client.js + sourcemap）
pnpm typecheck        # tsc --noEmit（strict）
pnpm lint             # Biome 检查
pnpm lint:fix         # Biome 自动修复
pnpm format           # Biome 只格式化
pnpm test             # vitest run（三个 project）
pnpm test:watch       # vitest 交互式
pnpm test:abi         # 断言 lib/client.js 的 ABI 形状与体积（需先 build）
pnpm budget           # 代码预算：文件 / 接线 / 函数行数
pnpm verify           # lint → typecheck → test → build → test:abi → budget
pnpm changeset        # 记一条变更说明
pnpm release          # changeset version → build → pack tgz → tag → push → gh release
```

## 热重载

改代码**不需要重启 dsh**（本机 profile 已在 `cordis.patch.yml` 里启用 `hmr`）：

| 改了什么 | 怎么生效 | 等多久 |
| :-- | :-- | :-- |
| `src/client/**` | `dsh-client-hmr` 每 500 ms `stat` `lib/client.js`，变了就推 `rebuilt` 给浏览器 | 重建后 <1 s |
| `src/host/**` | `dsh-hmr` 用 chokidar 监听 `root`（本机 = `/vol1/1000/开发/NAS/dsh-plugins`），`lib/index.js` 一变就重载插件、重跑 `apply` | 重建后 1–2 s（debounce 100 ms + 写稳定窗口） |
| `settings.json` / `policy.json` | 已加载的逻辑每次都重读文件 | 立即 |
| `package.json` 的 `exports` / 新增文件 | 重载插件时会重新解析，实际等价于宿主热重载 | 1–2 s |
| `pnpm add` / `pnpm update`（装或升级依赖） | **不在 HMR 队列里**（包操作在队列之外执行） | 需要重启 |
| 环境变量、`DSH_HOME`、profile 的 bundle 列表 | 进程启动时读 | 需要重启 |

想确认「宿主这次真的换了代码」：挑一个本次改动能观察到的行为（比如改完 `/inspect` 的错误码），
浏览器里 `fetch('/dsh-task-cards/api/inspect')` 看返回即知。**没反应先看产物时间，再考虑重启**——
不要像我曾经那样「没立刻看到变化就断言要重启」。

## 装到 DSH

**分两种环境，不要混用。**

### 开发/测试：dsh-dev 容器（唯一的源码安装点）

源码仓库只有一份，挂进 `dsh-dev` 容器，容器内热部署。宿主机 dsh **不** link 这个仓库。

```bash
# 容器里 dsh 由 /workspace/dev.patch.yml 直接加载产物，不需要装：
#   - id: dsh-task-cards
#     name: /workspace/nas-plugins/dsh-task-cards/lib/index.js
# 改 src/** → dsh-dev-watch 容器重编 lib/ → dsh-hmr / client-hmr 热重载
docker compose -f /vol1/1000/docker/dsh-dev/compose.yaml exec dsh \
  bash -lc 'cd /workspace/nas-plugins/dsh-task-cards && pnpm dev'
```

### 生产：只装发布版

生产**不装源码仓库**。要装就装发布产物（GitHub Release 里的 tgz）：

```bash
# ① 出发布包（在仓库里，会 changeset version → build → pack → tag → push → gh release）
pnpm release

# ② 生产安装（下载 Release 资产后）
/vol1/1000/docker/dsh-npm/node_modules/.bin/dsh plugin --profile web \
  add file:/path/to/dsh-task-cards-<version>.tgz
```

`dsh plugin ... add` 会自动把包名写进 profile 的 `dsh.profile.bundles`，靠插件自带的
`cordis.patch.yml` 插入配置行；**不要**再手工往 `cordis.patch.yml` 写 `- id: dsh-task-cards`。

## 改完代码跑什么

```bash
./scripts/preflight.sh          # ① pnpm verify 全绿 ② 拍一张度量快照
./scripts/preflight.sh --no-shot
```

单一入口，省得记两个命令。`pnpm verify` 本身覆盖 lint / typecheck / test / build / ABI / 三项边界检查 / 代码预算。

## 度量快照（`docs/metrics/`）

```bash
node scripts/snapshot-metrics.mjs              # 读 $DSH_HOME/dsh-task-cards，写 docs/metrics/<日期>.json + history.md
node scripts/snapshot-metrics.mjs --print-only # 只打印
DTC_DATA=/tmp/dtc node scripts/snapshot-metrics.mjs
```

固定口径：卡总数 / open / 人出手次数 / `zeroAction`（收尾了却没人动过的比例）/
ask 的「人答 vs 默认收尾」（`autoRate` 越高说明问得越没必要）/ `silence.unaccounted`（拒绝之后
没有去向的条数，正常恒为 0）。一天一行写进 `history.md`，改完插件前后各拍一张就能判断变好还是变坏。

> ⚠️ 度量必须和测试隔离：闸门的用例会真的走 deny 分支。`gateStats()` 在
> `VITEST`/`NODE_ENV=test` 下落到 `os.tmpdir()`，否则每跑一次 `pnpm verify` 都会往真实账本
> 里加几条 `denied`（2026-11-12 实测：一次 verify 后 `denied=8 / askCreated=2`，全部来自测试）。

## 在命令行看面板 / 答卡片（不需要浏览器）

面板要有登录 cookie；cookie 由 `dsh web` 启动时打印的带 token 的 URL 换出来。

```bash
# ① 取 URL（这条日志只在启动时打一次）
URL=$(docker logs dsh-dev 2>&1 | grep -aoE 'http://[0-9.]+:3080/\?token=[A-Za-z0-9_-]+' | tail -1)

# ② 换 cookie
curl -s -c /tmp/dsh-ck.txt -o /dev/null "$URL"

# ③ 读统计（含 noise / silence）
curl -s -b /tmp/dsh-ck.txt http://192.168.1.4:3080/dsh-task-cards/api/stats

# ④ 看卡片
curl -s -b /tmp/dsh-ck.txt http://192.168.1.4:3080/dsh-task-cards/api/cards
```

**特权写**（作答 / 批准 / 拒绝 / 重开 / override）要先换面板令牌，令牌只发给
「浏览器 UA + 面板来源（Origin/Referer）」的请求——这是有意的人机边界，脚本要显式伪装：

```bash
O=http://192.168.1.4:3080
TOK=$(curl -s -b /tmp/dsh-ck.txt -X POST "$O/dsh-task-cards/api/presence" \
  -H "Origin: $O" -H "Referer: $O/" \
  -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' \
  -H 'Content-Type: application/json' \
  -d '{"active":true,"sessionId":"panel-cli","tab":"workbench"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')

curl -s -b /tmp/dsh-ck.txt -X POST "$O/dsh-task-cards/api/action" \
  -H "Origin: $O" -H "X-Panel-Token: $TOK" -H 'Content-Type: application/json' \
  -d '{"id":"c-xxxx","action":"answer","answers":[{"id":"a","selected":["选项文字"]}]}'
```

动作名：`answer` / `acknowledge` / `complete` / `dismiss` / `reopen` / `approve` / `deny` / `override` / `run-now` / `acceptance`。

## 在命令行建 dsh 工作区（侧栏分组）

侧栏的「工作区」是宿主 `workspace` 服务的登记项，**不是插件的数据**——插件只是通过
`ctx.workspaceRegistry` 读它。要新建一个工作区（比如给插件仓库自己建一个），走宿主的
Typert Remote，不需要浏览器：

```bash
O=http://192.168.1.4:3080                       # 容器里的 dsh web
TOK=$(docker logs dsh-dev 2>&1 | strings \
      | grep -aoE 'token=[A-Za-z0-9_-]+' | tail -1 | cut -d= -f2)

# ① 换 cookie（必须带 Host: 公开地址，否则被 browser-trust 判成 403 forbidden）
curl -s -c /tmp/dsh-ck.txt -o /dev/null -H "Host: 192.168.1.4:3080" "$O/?token=$TOK"

# ② 建工作区
curl -s -b /tmp/dsh-ck.txt -X POST "$O/api/workspace/create" \
  -H "Host: 192.168.1.4:3080" -H "Origin: $O" -H 'Content-Type: application/json' \
  -d '{"type":"client-request","rpcId":"w1","method":"workspace/create",
       "payload":{"args":{"request":{"path":"/workspace/nas-plugins/dsh-task-cards"}}}}'
```

三个必须知道的形状（都实测踩过）：

| 现象 | 原因 |
| :-- | :-- |
| `not found` | 路径是 `/api/<namespace>/<method>`，中间是**斜杠**（`workspace/create`），不是点 |
| `Remote payload must contain exactly one plain-object args field` | `payload` 必须写成 `{"args":{…}}` |
| `missing "request"` | 参数按 descriptor 命名，`workspace/create` 收的是 `{"request":{"path":"…"}}` |
| `403 forbidden` | 缺 `Host: <公开地址>`；browser-trust 按 Host 判定，`127.0.0.1` 和容器内网 IP 都不过 |

工作区登记项落在 `$DSH_HOME/storages/workspace.json`（**不要手改**，会绕过校验与事件推送）。
`path` 必须是宿主机上真实存在的目录——Docker 里的容器路径（`/workspace/...`）只在容器里有效。

## 数据文件

都在 `$DSH_HOME/dsh-task-cards/`：

| 文件 | 内容 |
| :-- | :-- |
| `cards.json` | 卡片（数组；旧格式 `{cards:[…]}` 也认） |
| `settings.json` | 观察者设置与系统提示词 |
| `policy.json` | 工具 / 技能白名单 |
| `records.json` | 观察者运行记录（最近 200 条） |
| `workspace/` | 观察者会话的工作目录 |

写入都是 tmp + rename；坏文件被挪成 `*.bad-<时间戳>` 并在面板顶部报警。
