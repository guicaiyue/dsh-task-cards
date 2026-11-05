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
