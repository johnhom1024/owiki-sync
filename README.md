<div align="center">

# OWiki Sync

Obsidian 笔记多端同步插件

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/johnhom1024/owiki-sync?sort=semver)](https://github.com/johnhom1024/owiki-sync/releases)

多端同步你的笔记 · 数据只走你自己的服务器 · 断线不丢改动 · 桌面手机都能用

**[OWiki 服务端](https://github.com/johnhom1024/owiki)** ·
**[快速开始](#-快速开始)**

中文 · [English](README.en.md)

</div>

---

> [!WARNING]
> **试验性阶段提醒**：本插件与 OWiki 服务端目前均处于早期试验性阶段，同步逻辑尚未经过大规模验证，异常场景下**可能导致笔记数据丢失或损坏**。请在接入前为你的 Obsidian 仓库做好**额外备份**（建议保留一份独立于同步链路的完整拷贝）。**因使用本插件造成的任何数据丢失，概不负责**（详见 [MIT LICENSE](LICENSE)）。

## ✨ 特性

- **多端实时同步** —— 一台设备上保存，其他设备 2 秒内收到，编辑、重命名、删除都会跟着同步
- **只传变化的文件** —— 没改过的笔记一个字节都不走；设备间一致时零流量
- **冲突不丢内容** —— 两台设备同时改一篇笔记，能自动合并的就自动合并，合不了的另存 `xxx.conflict.md` 副本，本地文件永不被静默覆盖
- **断线不丢改动** —— 网络断了先存在本地，连上自动补传
- **每台设备独立身份** —— 新设备凭 PIN 授权接入，不想要了随时解绑
- **单设备模式** —— 只允许一台设备写入时，其他设备进入观察态：连着看、不能改，切回来即刻恢复
- **附件一起同步** —— 图片等附件随笔记同步
- **桌面手机都能用** —— 状态栏实时显示连接状态，左侧栏图标点击即可手动同步

## 🚀 快速开始

三步跑起来：部署服务端 → 安装插件 → 填地址连接。

### 1. 部署 OWiki 服务端

本插件不含服务端，需要先部署 [OWiki](https://github.com/johnhom1024/owiki)（单容器或单二进制）：

```bash
docker run -d --name owiki \
  -p 8787:8787 \
  -e OWIKI_TOKEN=<同步令牌> \
  -e OWIKI_ADMIN_USER=admin \
  -e OWIKI_ADMIN_PASSWORD=<强密码> \
  -v ./owiki-data:/data \
  johnhom1024/owiki:latest
```

浏览器打开 `http://<服务器>:8787`，登录后在 Web 管理端创建 vault 并获取同步令牌。

### 2. 安装插件

**从社区市场**（上架后可用）：Obsidian → 设置 → 第三方插件 → 浏览 → 搜索 `owiki-sync`

**手动安装**：从 [Releases](https://github.com/johnhom1024/owiki-sync/releases) 下载 `main.js`、`manifest.json`、`styles.css`，放入：

```
<你的库>/.obsidian/plugins/owiki-sync/
```

<details>
<summary>上架前尝鲜（BRAT）</summary>

安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件，在其设置里 Add Beta plugin 填入 `johnhom1024/owiki-sync`，即可在官方市场上架前安装本插件，并随 GitHub Release 自动更新。

</details>

### 3. 连接服务器

1. 启用插件后打开设置页，填入服务器地址与同步令牌
2. 首次连接自动对账：远端有的拉下来，本地有的传上去
3. 之后保持后台运行即可，编辑、重命名、删除都会自动同步

状态栏实时显示连接状态与同步进度；设置页可查看设备列表与同步日志。

## 📖 更多

- [OWiki 服务端](https://github.com/johnhom1024/owiki) —— 部署文档、Web 管理端、AI 开放接口
- [官网](https://johnhom1024.github.io/owiki/) —— 同步原理与功能总览

## 🤝 参与贡献

```bash
pnpm install
pnpm build       # 生产构建（minify）
pnpm typecheck   # 类型检查
```

手动部署到本机 vault：见 [TESTING.md](TESTING.md)。

## 📄 License

[MIT](LICENSE)
