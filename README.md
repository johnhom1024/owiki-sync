# owiki-sync

[English](#english) · 中文

Obsidian 笔记同步插件——配合自部署的 [OWiki](https://cnb.cool/johnhom1024/owiki-monorepo) 服务端，实现 vault 的多端实时同步。

数据只经过你自己的服务器，不经过任何第三方云。

## 功能

- **增量同步**：哈希清单对账，只传有变化的文件；双端一致时零传输
- **实时推送**：文件保存后自动上传（2 秒防抖），其他设备秒级收到变更
- **冲突处理**：baseHash 乐观锁 + 行级三方合并；无法合并时远程内容另存为 `xxx.conflict.md`，本地文件不丢
- **可靠连接**：断线指数退避自动重连，断线期间的变更暂存补发
- **结构同步**：rename / delete 原生支持，服务端原地改路径并广播
- **设备级授权**：每台设备独立身份，新设备凭 PIN 授权接入，可随时解绑
- 桌面端与移动端均可用

## 前置要求

本插件不含服务端，需要先部署 [OWiki](https://cnb.cool/johnhom1024/owiki-monorepo)（Go + WebSocket + SQLite，单容器或单二进制）：

```bash
docker run -d --name owiki \
  -p 8787:8787 \
  -e OWIKI_TOKEN=<同步令牌> \
  -e OWIKI_ADMIN_USER=admin \
  -e OWIKI_ADMIN_PASSWORD=<强密码> \
  -v ./owiki-data:/data \
  docker.cnb.cool/johnhom1024/owiki:latest
```

浏览器打开 `http://<服务器>:8787`，登录后在 Web 管理端创建 vault 并获取同步令牌。

## 安装

**从社区市场**（上架后可用）：Obsidian → 设置 → 第三方插件 → 浏览 → 搜索 `owiki-sync`

**手动安装**：从 [Releases](https://github.com/johnhom1024/owiki-sync/releases) 下载 `main.js`、`manifest.json`、`styles.css`，放入：

```
<你的库>/.obsidian/plugins/owiki-sync/
```

**测试版**：可用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 添加 `johnhom1024/owiki-sync` 安装。

## 使用

1. 启用插件后打开设置页，填入服务器地址与同步令牌
2. 首次连接自动对账：远端有的拉下来，本地有的传上去
3. 之后保持后台运行即可，编辑、重命名、删除都会自动同步

状态栏实时显示连接状态与同步进度；设置页可查看设备列表与同步日志。

## 工作原理

```
启动 → 上报 {path, hash, mtime} 清单 → 服务端比对 → 只传差异
编辑  → 防抖 2s → 上传 → 服务端广播 → 其他设备按需拉取
```

每文件 SHA-256 内容哈希做对账依据，写入带乐观锁；30s 心跳保活。

## 开发

```bash
pnpm install
pnpm build       # 生产构建（minify）
pnpm typecheck   # 类型检查
```

手动部署到本机 vault：见 [TESTING.md](TESTING.md)。

## License

[MIT](LICENSE)

---

## English

Obsidian plugin that syncs your vault across devices through a self-hosted [OWiki](https://cnb.cool/johnhom1024/owiki-monorepo) server (Go + WebSocket + SQLite). Your notes never touch a third-party cloud.

**Features**: hash-based incremental sync (only changed files transfer), real-time push with 2s debounce, three-way merge with conflict files (`xxx.conflict.md`), automatic reconnect with exponential backoff, first-class rename/delete, per-device PIN authorization. Works on desktop and mobile.

**Requires** a self-hosted OWiki server — one `docker run` (see above) or a single binary. Create a vault in the web console and grab its sync token.

**Install**: search `owiki-sync` in Community plugins (once listed), or grab `main.js` / `manifest.json` / `styles.css` from [Releases](https://github.com/johnhom1024/owiki-sync/releases) and drop them into `<your-vault>/.obsidian/plugins/owiki-sync/`.

**Usage**: enable the plugin, enter the server URL and sync token. The first reconciliation pulls everything down; afterwards edits sync automatically.

MIT License.
