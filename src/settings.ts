// OwikiSyncSettingTab —— 设置页（方案 B：分节 + 状态仪表卡）
// 结构：
//   1. 状态仪表卡（实时：连接状态 / vault / 服务器 / 版本摘要）
//   2. 连接（未授权：表单；已授权：收起为信息行 + 操作）
//   3. 本机设备（设备名可改 / 设备 ID 只读）
//   4. 同步（自动同步开关 / 立即同步 / 刷新授权）
//   5. 危险区（断开并取消授权，独立红边卡片）
//   6. 诊断（版本信息 + 日志：按 level 上色）
// 所有颜色一律用 Obsidian 主题变量，明暗主题自动适配。
import OwikiSyncPlugin from './main'
import { App, ButtonComponent, Modal, Notice, PluginSettingTab, Setting, setIcon } from 'obsidian'

/** 分节标题：Obsidian 设置页原生分节样式（大写小字 + 分隔线） */
function sectionHeading(containerEl: HTMLElement, text: string): void {
  const heading = containerEl.createDiv({ cls: 'owiki-section-heading' })
  heading.createSpan({ text })
}

export class OwikiSyncSettingTab extends PluginSettingTab {
  plugin: OwikiSyncPlugin
  /** 状态卡元素：连接状态变化时只局部重绘它，不整页重绘（避免打断表单输入） */
  private statusCardEl: HTMLElement | null = null

  constructor(app: App, plugin: OwikiSyncPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    this.statusCardEl = null

    // ---- 1. 状态仪表卡 ----
    this.renderStatusCard(containerEl)

    // ---- 2. 连接（仅未授权时展示配置表单；已授权时信息都在状态卡，不再重复） ----
    const vaultName = this.plugin.settings.authorizedVault
    if (!vaultName) {
      sectionHeading(containerEl, '连接')
      this.renderUnauthored(containerEl)
    }

    // ---- 3. 本机设备 ----
    sectionHeading(containerEl, '本机设备')
    this.renderLocalDevice(containerEl)

    // ---- 4. 同步 ----
    if (vaultName) {
      sectionHeading(containerEl, '同步')
      this.renderSyncControls(containerEl)
    }

    // ---- 5. 诊断 ----
    sectionHeading(containerEl, '诊断')
    this.renderVersionInfo(containerEl)
    this.renderLogSection(containerEl)

    // ---- 6. 危险操作（页面最底部：普通行 + 确认弹窗，贴 Obsidian 原生惯例） ----
    if (vaultName) {
      this.renderDangerZone(containerEl)
    }
  }

  /** 连接状态变化时只重绘状态卡（不整页重绘，避免打断连接表单/日志过滤的输入） */
  refreshStatusCard(): void {
    const card = this.statusCardEl
    if (!card || !card.isConnected) return
    // 渲染到临时容器再原位替换；renderStatusCard 内部会更新 statusCardEl 引用
    // createEl 是 Obsidian 给 HTMLElement 原型加的扩展（比 document.createElement 简洁）
    const holder = document.body.createEl('div')
    this.renderStatusCard(holder)
    const child = holder.firstElementChild
    holder.remove()
    if (child && card.parentElement) card.parentElement.replaceChild(child, card)
  }

  // ---------- 状态仪表卡 ----------

  /**
   * 状态仪表卡——设置页的视觉锚点：
   *  - 主行：状态图标 + 详细状态文案（按真实连接状态区分）
   *  - 次行：服务器地址 · 服务端/插件版本 · 同步进度
   * 授权状态变化时 rerenderSettings() 会整卡重绘；
   * 连接状态变化时 refreshStatusCard() 只局部重绘本卡（不打断表单输入）。
   */
  private renderStatusCard(containerEl: HTMLElement): void {
    const vaultName = this.plugin.settings.authorizedVault
    const card = containerEl.createDiv({
      cls: `owiki-card owiki-status-card${vaultName ? ' owiki-status-ok' : ' owiki-status-off'}`,
    })
    this.statusCardEl = card

    // 主行：状态图标 + 大字状态
    const main = card.createDiv({ cls: 'owiki-status-main' })
    const iconEl = main.createSpan({ cls: 'owiki-status-icon' })

    // 按真实连接状态给文案（比只看 authorizedVault 更细）
    const state = this.plugin.connState()
    let stateText: string
    let icon: string
    if (!vaultName) {
      if (this.plugin.settings.serverUrl) {
        stateText = '未授权 · 等待在 Web 端批准'
        icon = 'circle-dashed'
      } else {
        stateText = '未配置 · 在下方填写服务器信息'
        icon = 'circle-alert'
      }
    } else if (state === 'authed') {
      stateText = `已连接到远程 OWiki · ${vaultName}`
      icon = 'circle-check'
    } else if (state === 'observing') {
      // 单设备同步模式：连接正常但非选定同步设备
      stateText = `已连接，非同步设备 · ${vaultName}`
      icon = 'circle-alert'
    } else if (state === 'connecting') {
      stateText = `连接中 · ${vaultName}`
      icon = 'circle-dashed'
    } else if (state === 'connected') {
      stateText = `已连接，认证中 · ${vaultName}`
      icon = 'circle-dashed'
    } else {
      stateText = `未连接 · 自动重连中（vault ${vaultName}）`
      icon = 'circle-off'
    }
    setIcon(iconEl, icon)
    main.createSpan({ cls: 'owiki-status-title', text: stateText })

    // 观察态说明：连接保持但不同步，用户需要知道为什么 + 怎么恢复
    if (state === 'observing') {
      const hint = card.createDiv({ cls: 'owiki-callout owiki-callout-warning' })
      hint.createDiv({
        cls: 'owiki-callout-title',
        text: '本设备未被选为同步设备',
      })
      hint.createDiv({
        cls: 'owiki-callout-body',
        text: '该 vault 已开启「单设备同步」，当前只有被选定的设备会同步文件。本设备连接保持（随时可被切换为同步设备），但修改不会上传。如需本设备同步，请在 OWiki Web 管理端的 vault 设置页更换选定设备。',
      })
    }

    // 次行：服务器地址（等宽字体）+ 服务端版本
    const meta = card.createDiv({ cls: 'owiki-status-meta' })
    if (this.plugin.settings.serverUrl) {
      const server = meta.createSpan({ cls: 'owiki-status-server' })
      setIcon(server, 'server')
      server.createSpan({ text: this.plugin.settings.serverUrl })
    } else {
      // 未配置：不显示任何 URL，避免"从未填过的默认地址"冒充配置
      meta.createSpan({ cls: 'owiki-status-server owiki-muted', text: '未配置服务器地址' })
    }

    // 版本信息不在这里展示（诊断区已有版本表，避免重复）。
    // chips 容器只在同步进行中才创建——平时不渲染空节点。
    if (this.plugin.syncTotal > 0) {
      const chips = card.createDiv({ cls: 'owiki-status-chips' })
      chips.createSpan({
        cls: 'owiki-chip owiki-chip-accent',
        text: `同步中 ${this.plugin.syncDone}/${this.plugin.syncTotal}`,
      })
    }
  }

  // ---------- 连接 ----------

  private renderUnauthored(containerEl: HTMLElement): void {
    const banner = containerEl.createDiv({ cls: 'owiki-callout owiki-callout-info' })
    banner.createDiv({
      cls: 'owiki-callout-title',
      text: '如何获取授权信息',
    })
    banner.createDiv({
      cls: 'owiki-callout-body',
      text: '打开 owiki Web 端的 vault 设置页，复制 WebSocket 地址与同步令牌；或直接使用「一键授权」跳转 Obsidian。填写后点「连接」，确认同步信息后开始同步。',
    })

    // 本地暂存，点「连接」时才写入 settings（避免半截配置被持久化）
    let serverUrl = this.plugin.settings.serverUrl
    let token = this.plugin.settings.token
    let vaultHint = ''

    // 「连接」按钮：三个字段都填了才可点（避免半截配置连出去）
    // 用 setDisabled 而不是 display:none——Obsidian 原生禁用态有视觉反馈
    let connectBtn: ButtonComponent | null = null
    const syncConnectEnabled = () => {
      if (!connectBtn) return
      const ready = Boolean(serverUrl) && Boolean(token) && Boolean(vaultHint)
      connectBtn.setDisabled(!ready)
    }

    new Setting(containerEl)
      .setName('服务器地址')
      .setDesc('owiki 的 WebSocket 地址，如 ws://localhost:8787/ws')
      .addText((text) =>
        text
          .setPlaceholder('ws://localhost:8787/ws')
          .setValue(serverUrl)
          .onChange((v) => {
            serverUrl = v.trim()
            syncConnectEnabled()
          }),
      )

    new Setting(containerEl)
      .setName('Token')
      .setDesc('owiki Web 端 vault 设置页里的同步令牌')
      .addText((text) =>
        text
          .setPlaceholder('owk_...')
          .setValue(token)
          .onChange((v) => {
            token = v.trim()
            syncConnectEnabled()
          }),
      )

    new Setting(containerEl)
      .setName('远程 vault 名称')
      .setDesc('必填：Web 端创建 vault 时填写的名字。用于连接时核对——服务端返回的 vault 和这里不一致会弹窗提醒，避免把库同步错。')
      .addText((text) =>
        text
          .setPlaceholder('如：个人笔记')
          .onChange((v) => {
            vaultHint = v.trim()
            syncConnectEnabled()
          }),
      )

    new Setting(containerEl)
      .setName('连接')
      .setDesc('连接后会弹出确认框，确认同步信息后才开始同步')
      .addButton((btn) => {
        connectBtn = btn
          .setCta()
          .setButtonText('连接')
          .onClick(async () => {
            if (!serverUrl || !token) {
              new Notice('Owiki: 请先填写服务器地址和 Token')
              return
            }
            if (!vaultHint) {
              new Notice('Owiki: 请填写远程 vault 名称')
              return
            }
            this.plugin.settings.serverUrl = serverUrl
            this.plugin.settings.token = token
            await this.plugin.saveSettings()
            this.plugin.connectFromSettings(vaultHint)
          })
        syncConnectEnabled()
      })
  }

  // ---------- 本机设备 ----------

  private renderLocalDevice(containerEl: HTMLElement): void {
    // 显式保存：输入只暂存本地变量，点「保存」才真正改名+重连。
    // 不能用 onChange 直连 updateDeviceName——每敲一个键就触发一次
    // forceReconnect → onAuthed → syncNow 全量对账（1269 文件的风暴）。
    let pendingName = this.plugin.deviceName
    // 保存按钮只在输入偏离当前设备名（非空且不同）时出现，
    // 避免常驻按钮的视觉噪音；保存完成或清空输入后自动隐藏。
    // 用 display:none 而非 toggleVisibility（后者是 visibility:hidden，仍占位）。
    let saveBtn: ButtonComponent | null = null
    const syncSaveVisibility = () => {
      const changed = pendingName.trim() !== '' && pendingName.trim() !== this.plugin.deviceName
      if (saveBtn) saveBtn.buttonEl.style.display = changed ? '' : 'none'
    }
    new Setting(containerEl)
      .setName('本机设备名')
      .setDesc('仅本机可见。修改后点「保存」，会重连一次把新名字推给服务端。')
      .addText((text) =>
        text
          .setPlaceholder('如：Mac Studio')
          .setValue(this.plugin.deviceName)
          .onChange((v) => {
            pendingName = v
            syncSaveVisibility()
          }),
      )
      .addButton((btn) => {
        saveBtn = btn
          .setButtonText('保存')
          .setCta()
          .onClick(async () => {
            const name = pendingName.trim()
            if (!name || name === this.plugin.deviceName) {
              new Notice('Owiki: 设备名未变化')
              return
            }
            btn.setDisabled(true).setButtonText('保存中…')
            await this.plugin.updateDeviceName(name)
            new Notice(`Owiki: 设备名已更新为「${name}」`)
            this.display()
          })
        syncSaveVisibility()
      })


    new Setting(containerEl)
      .setName('本机设备 ID')
      .setDesc('前 8 位。完整 ID 在日志里（首次加载有打印）。')
      .addText((text) => text.setValue(this.plugin.shortDeviceId()).setDisabled(true))
  }

  // ---------- 同步 ----------

  private renderSyncControls(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('自动同步')
      .setDesc('开启后编辑文件自动推送（2 秒防抖）')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSync)
          .onChange(async (value) => {
            this.plugin.settings.autoSync = value
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName('立即同步')
      .setDesc('全量对账：上报本地清单，按差异上传/下载')
      .addButton((btn) =>
        btn.setCta().setButtonText('立即同步').onClick(() => {
          void this.plugin.syncNow()
        }),
      )

    new Setting(containerEl)
      .setName('刷新授权状态')
      .setDesc('重新连接服务器验证授权（token 是否仍有效）')
      .addButton((btn) =>
        btn.setButtonText('刷新').onClick(() => {
          this.plugin.refreshAuthStatus()
        }),
      )
  }

  // ---------- 危险操作 ----------

  /**
   * 断开连接并取消授权——普通设置行 + 确认弹窗：
   * 红色按钮标识危险，详细后果在弹窗里列明（贴 Obsidian 核心设置的原生做法，
   * 不用 Web 端的红框卡片，避免常驻页面的视觉噪音）。
   */
  private renderDangerZone(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('断开连接并取消授权')
      .setDesc('清除本地保存的服务器地址与 Token')
      .addButton((btn) =>
        btn
          .setDestructive()
          .setButtonText('断开并取消授权')
          .onClick(() => {
            new ConfirmDisconnectModal(this.plugin.app, () => {
              void this.plugin.disconnectFromSettings()
            }).open()
          }),
      )
  }

  // ---------- 诊断：版本 ----------

  private renderVersionInfo(containerEl: HTMLElement): void {
    const wrap = containerEl.createDiv({ cls: 'owiki-subsection' })
    const header = wrap.createDiv({ cls: 'owiki-subsection-head' })
    header.createSpan({ text: '版本信息' })

    const rows: Array<[string, string]> = [
      ['插件版本', `v${this.plugin.clientVersion()}`],
      ['最低 Obsidian', `v${this.plugin.minObsidianVersion()}`],
    ]
    const liveServer = this.plugin.serverVersionLive()
    const cachedServer = this.plugin.serverVersionCached()
    if (liveServer) {
      rows.push(['服务端（当前连接）', `v${liveServer}`])
    } else if (cachedServer) {
      rows.push(['服务端（最近一次认证）', `v${cachedServer}`])
    } else {
      rows.push(['服务端', '未连接或服务端版本过旧'])
    }
    const table = wrap.createEl('table', { cls: 'owiki-version-table' })
    const tbody = table.createEl('tbody')
    for (const [k, v] of rows) {
      const tr = tbody.createEl('tr')
      tr.createEl('th', { text: k })
      tr.createEl('td', { text: v })
    }
  }

  // ---------- 诊断：日志 ----------

  private renderLogSection(containerEl: HTMLElement): void {
    const wrap = containerEl.createDiv({ cls: 'owiki-subsection' })
    const head = wrap.createDiv({ cls: 'owiki-subsection-head' })
    head.createSpan({ text: '运行日志' })

    // 日志框：全部 level 混排，按 level 上色区分（warn 黄 / error 红）
    const logBox = wrap.createEl('pre', { cls: 'owiki-log-box' })
    this.renderLogBox = () => {
      const entries = this.plugin.logger.recent(80)
      logBox.empty()
      if (entries.length === 0) {
        logBox.createSpan({ cls: 'owiki-log-empty', text: '（暂无日志）' })
        return
      }
      for (const e of entries) {
        const line = logBox.createSpan({ cls: `owiki-log-line owiki-log-${e.level}` })
        line.createSpan({ cls: 'owiki-log-time', text: e.time })
        line.createSpan({ cls: 'owiki-log-level', text: `[${e.level.toUpperCase()}]` })
        line.createSpan({ cls: 'owiki-log-scope', text: `[${e.scope}]` })
        line.createSpan({ cls: 'owiki-log-msg', text: e.message })
        line.createEl('br')
      }
      logBox.scrollTop = logBox.scrollHeight
    }
    this.renderLogBox()

    // 操作行
    new Setting(wrap)
      .setName('日志操作')
      .setDesc('完整日志在 <配置目录>/plugins/owiki-sync/log.txt')
      .addButton((btn) =>
        btn.setButtonText('复制').onClick(async () => {
          await navigator.clipboard.writeText(this.plugin.logger.recentText())
          new Notice('Owiki: 日志已复制')
        }),
      )
      .addButton((btn) =>
        btn.setButtonText('清空').onClick(async () => {
          await this.plugin.logger.clear()
          this.renderLogBox()
        }),
      )
  }

  private renderLogBox: () => void = () => {}
}

/** 断开连接的确认弹窗：列明后果，红「断开」/「取消」；ESC 或点遮罩 = 取消 */
class ConfirmDisconnectModal extends Modal {
  private onConfirm: () => void

  constructor(app: App, onConfirm: () => void) {
    super(app)
    this.onConfirm = onConfirm
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h3', { text: '断开连接并取消授权？' })

    const list = contentEl.createEl('ul', { cls: 'owiki-disconnect-list' })
    for (const item of [
      '清除本地保存的服务器地址与同步令牌',
      '通知服务端解绑本设备（服务端 vault 与已同步数据不受影响）',
      '如需彻底作废令牌，请在 owiki Web 端点「取消授权」',
    ]) {
      list.createEl('li', { text: item })
    }

    const btns = contentEl.createDiv({ cls: 'owiki-confirm-buttons' })
    const cancelBtn = btns.createEl('button', { text: '取消' })
    cancelBtn.addEventListener('click', () => this.close())
    const okBtn = btns.createEl('button', {
      text: '断开并取消授权',
      cls: 'mod-warning',
    })
    okBtn.addEventListener('click', () => {
      this.close()
      this.onConfirm()
    })
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
