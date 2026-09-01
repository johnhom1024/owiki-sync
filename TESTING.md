# owiki-sync 插件 CLI 验证流程

> 前提：Obsidian 已安装并启用 [Obsidian CLI](https://help.obsidian.md/cli) 支持的版本（1.13+），`obsidian` 命令可用，且目标 vault（本文记为「笔记」）处于打开状态。
>
> 本流程是 2026-08-22 实战沉淀，专门验证「授权/连接/同步」链路。所有命令都实测通过。

## 0. 环境速查

```bash
# 本机 vault 路径（iCloud）：插件部署目标
DEST="/Users/johnhom/Library/Mobile Documents/iCloud~md~obsidian/Documents/笔记/.obsidian/plugins/owiki-sync"

# 插件仓库构建产物
PLUGIN_DIST="/Users/johnhom/backup/project/owiki/owiki-plugin/dist"

# owiki 服务端（默认 :8787）
curl -s http://localhost:8787/api/health   # -> {"clients":N,"status":"ok"}
```

## 1. 构建 + 部署 + 重载

```bash
cd /Users/johnhom/backup/project/owiki/owiki-plugin

# 构建（esbuild 打包 + tsc 类型检查，两步都要过）
node esbuild.config.mjs && npx tsc --noEmit

# 部署到 vault（main.js 必须有；styles.css 改动时一并复制）
cp dist/main.js styles.css "$DEST/"

# 重载插件（不需要手动开关 Obsidian 设置里的插件）
obsidian plugin:reload id=owiki-sync
```

## 2. 基础状态检查

```bash
# 连接状态 / 授权 vault / 设备 ID（json 汇总）
obsidian eval code="(() => {
  const p = app.plugins.plugins['owiki-sync'];
  return JSON.stringify({
    connected: p.client.connected,
    vault: p.settings.authorizedVault ?? null,
    // deviceId 走 app.loadLocalStorage（不同步 vault），不再在 settings 里
    deviceId: p.shortDeviceId(),
    deviceName: p.deviceName,
    serverUrl: p.settings.serverUrl,
  });
})()"

# 服务端视角：在线连接数
curl -s http://localhost:8787/api/health

# 插件报错（重载后必看）
obsidian dev:errors
```

预期：`connected: true`，两侧 clients 数一致，无 error。

> 设备 ID / 设备名存在 `app.loadLocalStorage`（Obsidian 应用数据目录，**不在 vault 内**），
> 不会被 iCloud / Dropbox / OneDrive 同步覆盖。详见 `plugin/src/device-identity.ts` 头部注释。

## 3. 读插件运行日志

插件内置环形日志（内存 500 条 + 落盘 `$DEST/log.txt`，2s 批量写）：

```bash
# 最近 N 条（认证/对账/深链/断开全记录）
obsidian eval code="app.plugins.plugins['owiki-sync'].logger.recentText(20)"

# 也可直接看落盘文件
tail -30 "$DEST/log.txt"
```

正常一次「重载 -> 自动重连」的日志长这样：

```
[INFO ] [plugin] 插件加载：vault=笔记 deviceId=4260381a… deviceName=笔记 Mac autoSync=true
[INFO ] [conn] 连接状态 -> connecting
[INFO ] [conn] 连接状态 -> authed
[INFO ] [auth] 认证成功，远程 vault=「default」
[INFO ] [sync] 开始全量对账
[INFO ] [sync] 已上报清单（464 个文件），等待差异结果
[INFO ] [sync] 对账完成：已是最新
```

## 4. 授权流程验证

### 4.1 一键授权深链（模拟 Web 端点击）

```bash
# 从服务端取当前有效深链（含 token）
URL=$(curl -s http://localhost:8787/api/vaults/1/token \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['obsidianOAuth'])")
echo "$URL"
# obsidian://owiki-sync?action=authorize&server=ws%3A%2F%2F...&token=owk_...&vaultName=default

# 用系统 open 走真实 URI 路由（与浏览器 window.location.href 同路径）
open "$URL"

# 等 2~4 秒后看日志：应有「收到一键授权深链」+ 认证成功
sleep 4
obsidian eval code="app.plugins.plugins['owiki-sync'].logger.recentText(8)"
```

### 4.2 服务端授权状态联动

```bash
# vault 列表：authorized 应为 true
curl -s http://localhost:8787/api/vaults \
  | python3 -c "import json,sys; v=json.load(sys.stdin)['data'][0]; print(v['authorized'], v['clients'])"

# 已授权设备列表（deviceId 即 hello 时上报的那个，存于本机 app.loadLocalStorage）
curl -s http://localhost:8787/api/vaults/1/devices | python3 -m json.tool
```

## 5. 断开 / 取消授权 / 解禁场景

### 5.0 单设备同步（Web 设置页开关）

```bash
# 开启：只允许指定 deviceId 的设备同步文件（须为已登记设备，否则 400）
# 本机 deviceId 全量：obsidian eval code="app.plugins.plugins['owiki-sync'].fullDeviceId()"
# （前 8 位用 shortDeviceId() 即可）
curl -s -X PUT http://localhost:8787/api/vaults/1/single-device \
  -H 'Content-Type: application/json' -b "$COOKIE" \
  -d '{"singleDevice": true, "pinnedDeviceId": "<从 fullDeviceId() 拷贝>"}'

# 预期（2026-09-01 语义改版：授权与同步解耦）：
# - 其他设备 WS 认证照常成功（welcome.ok=true, syncEnabled=false），设备照常登记
# - 非同步设备的 hashlist/upload/fetch/rename/delete 被服务端拒绝
#   （error 消息带「单设备同步模式」），插件状态栏/状态卡显示「非同步设备」（紫色状态点）
# - 非同步设备收不到任何变更广播（完全静默）
# - pin 切换/开关切换不再断线：在线连接收到 sync_state 推送原地升降级，
#   被恢复的设备自动补一次全量对账
# - 旧版客户端（hello 不带 deviceId）在单设备模式下会因 deviceId 匹配不上而静默（连接仍保持）
# - pin 的设备发 bye 解绑、或 Web 端「取消授权」都会自动清掉 pin
# 关闭传 {"singleDevice": false} 即恢复所有设备。
```

E2E 脚本（18 项断言覆盖上述全部场景）：`/tmp/owiki-e2e/e2e_single_device.py`，
配套起服务方式：独立 DB + `OWIKI_TOKEN=e2e-token` + 8788 端口，见脚本头部注释。

### 5.1 插件端「断开并取消授权」（发 bye 解绑）

```bash
obsidian eval code="(async () => {
  await app.plugins.plugins['owiki-sync'].disconnectFromSettings();
  return 'done';
})()"

sleep 3
# 预期：authorized=false、clients=0、设备列表空
curl -s http://localhost:8787/api/vaults \
  | python3 -c "import json,sys; v=json.load(sys.stdin)['data'][0]; print('authorized:', v['authorized'])"
curl -s http://localhost:8787/api/vaults/1/devices
```

### 5.2 Web 端取消授权后重新授权

Web 端「取消授权」会作废令牌、删除设备记录并断开全部连接。之后设备
不能凭旧 token 重连，必须走 Web 端一键授权深链恢复。用 4.1 的流程即可。

## 6. 同步验证（可选）

```bash
# 触发全量对账
obsidian eval code="app.plugins.plugins['owiki-sync'].syncNow()"

# 服务端看文件数
curl -s http://localhost:8787/api/vaults/1/stats
```

## 7. 多设备设备 ID 隔离验证（iCloud 同步 vault 的关键场景）

升级到本版本后，每台设备应各自有独立 deviceId（落在 `app.loadLocalStorage`，不被 iCloud
推回）。在 Mac + iPhone 两台设备各装一次插件后：

```bash
# Mac 端
obsidian eval code="app.plugins.plugins['owiki-sync'].fullDeviceId()"
# 例: "a1b2c3d4-..."

# iPhone 端（通过 Obsidian CLI 在 iOS 端执行，或在手机插件设置页看「本机设备 ID」）
# 例: "f9e8d7c6-..."

# 服务端：两条设备记录，deviceId 各不相同
curl -s http://localhost:8787/api/vaults/1/devices \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['data']), 'devices'); [print(x['deviceId'][:8], x['deviceName']) for x in d['data']]"
```

预期：每台设备一条记录，deviceId 全不同。若仍共用同一个 → 旧 settings 残留
deviceId 已被迁出 data.json 但 localStorage 未生效，重启 Obsidian 再试。

## 8. 踩坑记录（重要）

1. **深链参数名别用 `vault`**：Obsidian 内置 URI 参数（`obsidian://open?vault=X`），
   用它会被 Obsidian 抢去路由，报 "Unable to find a vault for the URL"。用 `vaultName`。
2. **深链不要校验 `action` 参数**：Obsidian 会把 URI host 位（handler 名 `owiki-sync`）
   塞进 `params.action`，覆盖 query 里的 `action=authorize`。handler 被调用即授权意图。
3. **`connectFromSettings` 要走完整认证**：client 复用旧连接时 `connect()` 直接 return，
   不会触发 onAuthed。`configure()` 检测 url/token 变化会强制重连（修复过）。
4. **eval 里的 Promise 不会等待**：`(async () => {...})()` 立即返回，需要验证结果的
   场景要 `sleep` 后再查状态。
5. **Notice 5 秒自动消失**：验证提示文案时抓不到 DOM，看 console（`obsidian dev:console`）
   或插件日志更可靠。
6. **console 日志带时间戳但 eval 输出不带**：对照排查时以插件 logger 的时间为准。
7. **设备 ID 不能存 `saveData()`**：落进 `.obsidian/plugins/owiki-sync/data.json`
   就被 iCloud 同步了，多设备会共用一个 ID。OWiki 现在的做法：
   `app.loadLocalStorage('owiki-device-id')`，key 故意不带 vault 名后缀（iCloud 偶发
   改名 vault 目录会污染带后缀的 key）。参见 `plugin/src/device-identity.ts`。

## 9. 版本展示验证（v0.2.0 起）

**协议变化**：
- 客户端 → 服务端 `hello` 携带 `clientVersion`（来自 `manifest.json`）
- 服务端 → 客户端 `welcome` 携带 `serverVersion`（来自编译时 `-ldflags -X main.version=...`）

**插件设置页验证**（设置 → Owiki Sync → 滚动到底部「版本信息」块）：

```bash
# 客户端版本应是当前部署的 plugin/manifest.json 里的 version
obsidian eval code="(() => {
  const p = app.plugins.plugins['owiki-sync'];
  return JSON.stringify({
    clientVersion: p.clientVersion(),         // 来自 manifest.json
    minObsidian:   p.minObsidianVersion(),    // 来自 manifest.json
    serverLive:    p.serverVersionLive(),     // 本次连接实时值（认证后才有）
    serverCached:  p.serverVersionCached(),   // settings 持久化的最近值
  });
})()"
```

**Web 端设备列表验证**：vault 设置页 → 已授权设备，每台设备旁应显示
`v0.2.0` 这类版本徽标（来自 `vault_devices.client_version`，老客户端未上报时
不显示）。

**服务端日志回归点**：每次 hello 都会打 `clientVersion=...`：

```bash
grep '\[ws\] hello' /path/to/owiki.log | tail -5
# 期望类似：[ws] hello vault="..." device=xxxxx… name="..." clientVersion=0.2.0 from ...
```

**端到端**：跑 `go run ./cmd/testclient` 应看到 `welcome.serverVersion = 0.x.x`，与
服务端 `-ldflags` 注入的 `main.version` 一致。

**版本号注入**：
- 本地：`make build` 默认从 `git describe` 取（无 tag 时 `dev`），可 `make build VERSION=0.3.0` 覆盖
- 镜像：`.cnb.yml` 自动传 `--build-arg VERSION=$(git describe --tags --always --dirty)`，
  写入 `org.opencontainers.image.version` 标签

**兼容性**：
- 老客户端（v0.1.x）发的 hello 没 `clientVersion`，服务端反序列化为空串，
  vault_device 该列记为空字符串，Web 设备列表不显示徽标（不报错）
- 老服务端（v0.x 之前）回的 welcome 没 `serverVersion`，客户端忽略字段，
  设置页「服务端版本」回退到「未连接或服务端版本过旧」
