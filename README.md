# owiki-sync

Obsidian 笔记同步插件——配合自部署的 [OWiki](https://cnb.cool/johnhom1024/owiki-monorepo)（Go + WebSocket）实现 vault 的多端实时同步。

- 哈希清单对账增量同步（只传有变化的文件）
- 文件保存自动推送（2 秒防抖）
- 多端变更实时下发（changed 广播 → 自动拉取落盘）
- 断线指数退避重连 + 消息暂存补发
- 乐观锁 + 行级三方合并；合不了时远程另存为 `xxx.conflict.md`
- 监听 vault rename/delete，服务端原地改 path / 删除记录并广播

## ✅ 已修复（2026-08-22）

两个问题同根同源，已在 `ff8b94c` 修复并实测验证：

1. **编辑自动同步**：`flushPendingUploads` 在断线时直接 return 丢掉了防抖链路 →
   改为保留 pendingUploads + 10s 重试；`onAuthed` 回调（每次连接/重连成功都触发）
   自动 syncNow 补对账，断线期间的变更随对账补传。
2. **服务端重启不重连**：`onclose` 作为唯一重连入口（网络断/服务端重启/握手失败
   全走它）；`teardownWs` 摘除旧实例事件防回调污染；45s 无流量看门狗强断死连接。

实测：编辑笔记 2s 内入库；重启服务端后自动重连+补对账（463 → 464 文件）。

## 开发验证

改完代码后的构建/部署/重载与授权链路验证，用 Obsidian CLI 全程命令行完成，
具体流程见 [TESTING.md](TESTING.md)（含深链授权、断开解绑、取消授权后解禁的
完整场景与踩坑记录）。

## 项目结构

```
owiki-plugin/
├── manifest.json          # 插件身份证：id/版本/最低 Obsidian 版本（Obsidian 靠它识别插件）
├── src/
│   ├── main.ts            # 插件主类 OwikiSyncPlugin（继承 obsidian.Plugin）
│   ├── client.ts          # WebSocket 客户端封装（连接/认证/心跳/重连）
│   ├── protocol.ts        # 消息类型定义（与服务端 internal/proto 一一对应）
│   └── settings.ts        # 设置页（PluginSettingTab：服务器地址/Token/开关）
├── esbuild.config.mjs     # 打包配置：TS → 单文件 CJS bundle
├── tsconfig.json
└── dist/main.js           # 编译产物（部署到 vault 的就是它）
```

### 四个源码文件的职责

**`main.ts` —— 插件生命周期与同步编排**

```typescript
export default class OwikiSyncPlugin extends Plugin {
  async onload(): Promise<void> {   // 插件启用时调用
    // 1. 加载设置  2. 初始化 WS 客户端  3. 注册命令/事件/状态栏  4. 连接+首次对账
  }
  onunload(): void {                // 插件禁用/卸载时调用（必须清理！）
    // 断开连接、取消防抖定时器
  }
}
```

核心数据结构：`localHashes: Map<path, {hash, mtime}>` 本地哈希缓存——对账时
mtime 未变的文件直接用缓存，不重读内容（463 个文件的二次对账秒级完成）。

同步流程：

```
启动 → syncNow()
  ├─ 扫描 vault.getMarkdownFiles() → 生成 [{path, hash, mtime}] 清单
  ├─ 发送 hashlist → 服务端对账
  └─ 收到 hashlist_response
       ├─ action=upload   → 读文件内容 → upload 消息（防抖批量）
       └─ action=download → 发 fetch → 收 fetch_response → vault.modify/create 落盘

编辑文件 → vault.on('modify') → 防抖 2s → 算哈希 → upload
他端变更 → 服务端广播 changed → 哈希不同才 fetch → 落盘（applyingRemote 防回环）
```

**`client.ts` —— 连接管理（与 Obsidian 无关的纯 TS 类）**

状态机 `disconnected → connecting → connected → authed`；断线后指数退避
（1s/2s/4s…上限 30s）；未连接时的出站消息进 `pending` 队列，重连后补发。

**`protocol.ts` —— 单一事实源**

所有消息的 TypeScript interface，和 owiki 的 `internal/proto/messages.go`
字段一一对应。改协议时两边同步改，类型即文档。

**`settings.ts` —— 设置页**

继承 `PluginSettingTab`，用 `new Setting(containerEl)` 声明式拼 UI；
`this.plugin.settings.xxx` 读写配置，`saveData/loadData`（Plugin 基类内置）
持久化到插件目录的 `data.json`。

## 开发工作流

```bash
pnpm install
node esbuild.config.mjs          # 开发构建（inline sourcemap）
node esbuild.config.mjs production  # 生产构建（minify）

# 部署到 vault
cp dist/main.js manifest.json "<vault>/.obsidian/plugins/owiki-sync/"
# Obsidian 内：禁用→启用插件（或 Ctrl/Cmd+P → "Reload app without saving"）
```

调试：Obsidian 内 `Cmd+Option+I` 打开 DevTools（Electron 的 Chrome DevTools），
console 里过滤 `[owiki]` 前缀看插件日志。

---

## Obsidian 插件开发技巧（踩坑总结）

### 1. 插件的本质：一个 JS 文件 + 一份清单

Obsidian 插件只需要两样东西：`main.js`（入口 bundle）和 `manifest.json`。
没有 main.js 时 Obsidian 也能加载（有些纯 CSS 插件）。manifest 关键字段：

```json
{
  "id": "owiki-sync",              // 全局唯一，目录名必须与它一致
  "minAppVersion": "1.0.0",        // 低于此版本的 Obsidian 拒绝加载
  "isDesktopOnly": false           // true 则移动端不可装（用了 Node API 时）
}
```

### 2. 生命周期：onload/onunload 必须对称

- `onload()` 里注册的一切（命令、事件、状态栏、定时器）尽量用
  `this.registerEvent()` / `this.registerInterval()` / `this.registerDomEvent()`
  ——插件禁用时**自动清理**，不用手动卸
- 自己创建的资源（如 WS 连接）必须在 `onunload()` 手动释放
- 忘记清理的后果：禁用再启用后出现双份监听器、重复连接

### 3. Vault API：一切文件的入口是 app.vault

```typescript
this.app.vault.getMarkdownFiles()            // 所有 md 文件（TFile[]）
this.app.vault.read(file)                    // 读文本（异步）
this.app.vault.modify(file, content)         // 写文本（触发 modify 事件！）
this.app.vault.create(path, content)         // 新建（父目录必须已存在）
this.app.vault.createFolder(dir)             // 建目录（已存在会抛错，先 adapter.exists 判断）
this.app.vault.adapter.exists(path)          // 任意路径存在性（含非 md）
file.stat.mtime                              // 文件修改时间（ms）——哈希缓存的关键
```

注意：**`vault.modify/create 自己也会触发 modify 事件**——下载落盘时必须用
标志位（本插件的 `applyingRemote` 集合）过滤，否则"下载→触发上传→再广播"
死循环。

### 4. 事件监听：registerEvent + instanceof 过滤

```typescript
this.registerEvent(
  this.app.vault.on('modify', (file) => {
    if (!(file instanceof TFile)) return   // 事件参数可能是 TFolder，必须过滤
    // ...
  })
)
```

### 5. 防抖：官方自带的 debounce

Obsidian API 内置 `debounce`（不用引 lodash）：

```typescript
private debouncedFlush = debounce(() => this.flushPendingUploads(), 2000, true)
// 第三参 resetTimer=true：连续编辑会不断推迟执行（适合"编辑停了再传"）
```

用完记得 `this.debouncedFlush.cancel()`（onunload 里）。

### 6. 设置持久化：loadData/saveData 白送

Plugin 基类的 `loadData()/saveData(obj)` 自动读写插件目录的 `data.json`，
不用自己碰文件系统。惯例写法：

```typescript
async loadSettings() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
}
```

`Object.assign` 兜底：旧版本用户缺新字段时用默认值补齐。

### 7. 打包：esbuild 单文件 bundle

Obsidian 只加载一个 main.js，所以必须 bundle（把 obsidian 以外的依赖全打进去），
`external` 里排除 `obsidian` 本身——它是宿主运行时提供的，打进去了反而冲突。
社区模板统一用 esbuild（比 webpack 快一个量级），输出 CJS 格式。

### 8. 部署调试循环

热重载没有（改代码必须禁用→启用），但可以缩短循环：
- DevTools（`Cmd+Option+I`）的 console 看日志、Sources 面板断点（sourcemap 已 inline）
- `Cmd+P → Reload app without saving` 一键重载
- 语法检查用 `npx tsc --noEmit`（比构建更快发现类型错）

### 9. 发布（将来）

- 上架官方社区市场：GitHub 公开仓库 + `manifest.json` 的 id 与仓库一致 +
  release 附 main.js/manifest.json/styles.css → 提 PR 到 obsidianmd/obsidian-releases
- 自用/内测：手动装或走 [BRAT](https://github.com/TfTHacker/obsidian42-brat)
  插件从任意 GitHub 仓库安装

### 10. 常见坑速查

| 坑 | 解法 |
|---|---|
| 插件列表里不显示 | 目录名 ≠ manifest id；或没开安全模式 |
| 改了代码没生效 | 忘了禁用→启用；或复制的是旧 dist |
| 下载文件报错 not found | create 前父目录不存在，先 createFolder |
| 双份事件/重复连接 | registerEvent 没用；onunload 没清理 |
| 移动端闪退 | 用了 Node-only API（fs/path），isDesktopOnly 设 true 或改用 vault.adapter |
| iCloud vault 路径怪 | 用 `this.app.vault.adapter.basePath` 取真实路径，别硬编码 |

## 相关

- 服务端：[owiki-monorepo](https://cnb.cool/johnhom1024/owiki-monorepo)（Go + Gin + gorilla/websocket + SQLite）
- 协议文档：[owiki-monorepo/README.md](https://cnb.cool/johnhom1024/owiki-monorepo/-/blob/main/README.md) 的消息协议表
- 同步原理：Obsidian 笔记《owiki/哈希增量同步机制》
