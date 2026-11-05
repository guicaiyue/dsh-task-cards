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
pnpm release          # changeset version → build → commit → tag
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

仓库就是安装源（`link:` 软链，改完 `pnpm build` 即生效，宿主 HMR 会自动重载客户端）：

```bash
/vol1/1000/docker/dsh-npm/node_modules/.bin/dsh plugin --profile web add link:/vol1/1000/开发/NAS/dsh-plugins/dsh-task-cards
```

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
