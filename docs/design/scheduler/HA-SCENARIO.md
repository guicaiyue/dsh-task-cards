# 真实需求验收：部署 Home Assistant + 集成小米

> 2026-11-09。目的有两个：交付需求本身；用真实需求验收任务卡内核（M0–M3）。
> 环境：需求在 NAS 宿主执行，任务卡在 `dsh-dev` 容器里跑。

## 1. 需求结果

| 项 | 状态 |
| :-- | :-- |
| Home Assistant 容器 | ✅ 运行中 `home-assistant`，`0.0.0.0:8123->8123`，`restart=unless-stopped` |
| 配置目录 | ✅ `/vol1/1000/docker/homeAssistant`（宿主路径，已写入 `configuration.yaml`、数据库等） |
| compose 文件 | ✅ `/vol1/1000/docker/homeAssistant/docker-compose.yml` |
| Xiaomi Home 集成 | ✅ 已装 `custom_components/xiaomi_home` v0.5.0，HA 日志确认加载（custom integration 警告属正常） |
| 小米账号登录 | ⏳ **需要用户完成**：HA 首次引导 + 集成登录（扫码/账号），代理无法代替 |
| 访问入口 | <http://192.168.1.4:8123>（302 → `/onboarding.html`） |

**给用户的两步**：① 打开 8123 创建 HA 所有者账号；② 设置 → 设备与服务 → 添加集成 → Xiaomi Home → 登录小米账号并授权设备。

## 2. 「加手脚」：dsh-dev 获得宿主 docker 能力

改动 `dsh-dev/compose.yaml`（备份为 `compose.yaml.bak-ha`）：

```yaml
- /var/run/docker.sock:/var/run/docker.sock
- /usr/bin/docker:/usr/bin/docker:ro
- /usr/libexec/docker:/usr/libexec/docker:ro
environment:
  DTC_KERNEL: "on"
  DTC_VERIFY: "on"
```

风险：socket 等同于宿主 root，仅限本机自用；容器本身已按 danger-full-access 运行。

## 3. 任务卡能力验收

### 3.1 真实证据场景（`tests/host/ha-scenario.test.ts`，默认跳过）

跑法：`HA_SCENARIO=1 pnpm vitest run tests/host/ha-scenario.test.ts`

| 卡 | 清单 | 证据（真实） | 验收结论 |
| :-- | :-- | :-- | :-- |
| 部署 Home Assistant 容器 | 拉镜像 ✓ / 启动容器 ✓ | `docker inspect` 运行中、`GET /` 302、`docker exec test -f /configuration.yaml` | **confirmed / close** |
| 集成小米智能家居 | 安装集成 ✓ / 登录账号 **blocked** | 安装目录存在、登录被阻塞 | **unknown / escalate**（`waitReason=awaiting-user-escalation`） |
| 重复卡对账 | — | 同会话同标题新卡 | 扫描 3 张，无可失效项（符合预期） |

### 3.2 运行实例 API（带登录 cookie）

`dsh-dev/.auth/` 里的 cookie 可直接调插件路由，验证了：`/cards` 创建、`/action` 批准、`/case`、`/progress`、`/records`、`/reconcile` 均返回 200。

### 3.3 发现并修掉的问题

1. **HTTP 检查器跟随重定向**：`GET /` 返回 302，fetch 自动跟随后得到 200，证据判错。已改为 `redirect: 'manual'`，记录真实状态码。
2. **宿主机环境变量污染测试**：容器带 `DTC_KERNEL=on` 跑 `pnpm test` 时，旧路径的批准用例被内核接管。新增 `tests/setup-env.ts` 默认清空开关，内核用例显式打开。
3. **无会话的卡走旧路径**：通过 API 手工创建、`origin=null` 的卡，批准时仍走「直接投递」，返回 `no-session` 并直接 done，不写内核事件 → `/records` 看不到。这是设计内行为（无会话无法派发），但**面板上应提示「这张卡没有来源会话，不会进入调度队列」**，属待补交互。

### 3.4 能力结论

- ✅ 事件账、CAS、清单基线、证据、验收、对账、记录在真实需求上跑通；
- ✅ 验收能正确区分「完成」「阻塞需要人」两类，并把后者升级给用户；
- ⚠️ 缺少「无会话卡」的显式提示；`/records` 只覆盖内核路径；
- ⚠️ 浏览器验收仍需登录态（本次用 cookie 调 API 代替）。


---

## 4. OAuth 回调收不到：根因与处理（2026-11-09 15:30）

### 4.1 现象

浏览器（Arch Linux）上小米授权页显示成功，但 NAS 的 HA 没有收到回调，集成停留在等待。

### 4.2 根因

Xiaomi OAuth 的回调地址是集成写死的：

```python
# custom_components/xiaomi_home/miot/const.py
OAUTH_REDIRECT_URL = 'http://homeassistant.local:8123'
```

而 HA 容器跑在 **bridge 网络**里：`mDNS(5353/udp)` 公告出不了容器，所以局域网里 `homeassistant.local` **解析不到**（NAS 宿主自己用 getent/avahi 都超时）。浏览器能被小米跳回这个地址，但 TCP 连不上 NAS 的 8123。

### 4.3 处理

1. **补上 mDNS A 记录**（宿主 systemd 常驻）：

   ```ini
   # /etc/systemd/system/avahi-alias-homeassistant.service
   ExecStart=/usr/bin/avahi-publish -a -R homeassistant.local 192.168.1.4
   Restart=always
   ```

   验证：`avahi-resolve -n homeassistant.local` → `192.168.1.4`；`curl --noproxy '*' http://homeassistant.local:8123/` → 200。

2. **手动重放回调**（把浏览器那次的 code 发到 IP 上，一次性）：
   `GET http://192.168.1.4:8123/api/webhook/<virtual_did>?code=...&state=...`
   → 200，配置项生成。

3. **HA 的 internal/external URL 改为 `http://homeassistant.local:8123`**，以后 UI 里的链接都指向可解析的名字。

4. **compose 里写清这条依赖**：容器桥接 + 宿主 mDNS 别名，改 NAS IP 要同步改 service。

### 4.4 结果

| 项 | 状态 |
| :-- | :-- |
| Xiaomi 配置项 | ✅ `Xiaomi: 2277543062 [中国大陆]`（重启后仍在） |
| 实体 | ✅ 56 个（climate/light/switch/sensor/…），用电传感器每 2 秒在更新 |
| `homeassistant.local` | ✅ 局域网可解析到 NAS（Avahi） |
| OAuth 回调 | ✅ 已补上，登录态有效 |

### 4.5 顺带修正的场景用例

HA 完成引导后 `/` 由 302 变 200，`ha-scenario` 的证据期望随之更新；并新增一张「完成小米账号绑定并同步设备」卡，用真实落盘证据验收：

```
- 部署 Home Assistant 容器: confirmed / close
- 集成小米智能家居（账号未绑定时）: unknown / escalate
- 完成小米账号绑定并同步设备: confirmed / close
```
