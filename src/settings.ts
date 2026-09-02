// OwikiSyncSettingTab —— 设置页（1.13 声明式 API）
// 结构：
//   1. 状态仪表卡（实时：连接状态 / vault / 服务器 / 同步进度）
//   2. 连接（未授权：表单；已授权：整组隐藏）
//   3. 本机设备（设备名可改 / 设备 ID 只读）
//   4. 同步（自动同步开关 / 立即同步 / 刷新授权）
//   5. 诊断（版本信息 + 日志：按 level 上色）
//   6. 危险区（断开并取消授权）
// 所有颜色一律用 Obsidian 主题变量，明暗主题自动适配。
import OwikiSyncPlugin from './main'
import {
  App,
  ButtonComponent,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
  setIcon,
} from 'obsidian'

export class OwikiSyncSettingTab extends PluginSettingTab {
  plugin: OwikiSyncPlugin
  /** 状态卡元素：连接状态变化时只局部重绘它，不整页重绘（避免打断表单输入） */
  private statusCardEl: HTMLElement | null = null
  private renderLogBox: () => void = () => {}

  constructor(app: App, plugin: OwikiSyncPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  /**
   * 连接草稿：只在点「连接」时写入 settings，避免半截配置被持久化。
   * 远程 vault 名称只用于核对，不落盘。
   */
  private draftServerUrl = ''
  private draftToken = ''
  private draftVaultHint = ''

  private authorized(): boolean {
    return Boolean(this.plugin.settings.authorizedVault)
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: '连接状态',
        searchable: false,
        render: (setting) => {
          this.flattenSettingRow(setting)
          this.renderStatusCard(setting.settingEl)
        },
      },
      {
        type: 'group',
        heading: '连接',
        visible: () => !this.authorized(),
        items: [
          {
            name: '如何获取授权信息',
            searchable: true,
            aliases: ['一键授权', 'WebSocket', '同步令牌'],
            render: (setting) => {
              this.flattenSettingRow(setting)
              const banner = setting.settingEl.createDiv({ cls: 'owiki-callout owiki-callout-info' })
              banner.createDiv({ cls: 'owiki-callout-title', text: '如何获取授权信息' })
              banner.createDiv({
                cls: 'owiki-callout-body',
                text: '打开 owiki Web 端的 vault 设置页，复制 WebSocket 地址与同步令牌；或直接使用「一键授权」跳转 Obsidian。填写后点「连接」，确认同步信息后开始同步。',
              })
            },
          },
          {
            name: '服务器地址',
            desc: 'owiki 的 WebSocket 地址，如 ws://localhost:8787/ws',
            aliases: ['server', 'websocket', 'ws'],
            render: (setting) => {
              setting.addText((text) =>
                text
                  .setPlaceholder('ws://localhost:8787/ws')
                  .setValue(this.draftServerUrl || this.plugin.settings.serverUrl)
                  .onChange((v) => {
                    this.draftServerUrl = v.trim()
                  }),
              )
            },
          },
          {
            name: 'Token',
            desc: 'owiki Web 端 vault 设置页里的同步令牌',
            aliases: ['令牌', 'sync token'],
            render: (setting) => {
              setting.addText((text) =>
                text
                  .setPlaceholder('owk_...')
                  .setValue(this.draftToken || this.plugin.settings.token)
                  .onChange((v) => {
                    this.draftToken = v.trim()
                  }),
              )
            },
          },
          {
            name: '远程 vault 名称',
            desc: '必填：Web 端创建 vault 时填写的名字。用于连接时核对——服务端返回的 vault 和这里不一致会弹窗提醒，避免把库同步错。',
            aliases: ['vault'],
            render: (setting) => {
              setting.addText((text) =>
                text
                  .setPlaceholder('如：个人笔记')
                  .setValue(this.draftVaultHint)
                  .onChange((v) => {
                    this.draftVaultHint = v.trim()
                  }),
              )
            },
          },
          {
            name: '连接',
            desc: '连接后会弹出确认框，确认同步信息后才开始同步',
            render: (setting) => {
              setting.addButton((btn) =>
                btn
                  .setCta()
                  .setButtonText('连接')
                  .onClick(async () => {
                    const serverUrl = this.draftServerUrl || this.plugin.settings.serverUrl
                    const token = this.draftToken || this.plugin.settings.token
                    const vaultHint = this.draftVaultHint
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
                  }),
              )
            },
          },
        ],
      },
      {
        type: 'group',
        heading: '本机设备',
        items: [
          {
            name: '本机设备名',
            desc: '仅本机可见。修改后点「保存」，会重连一次把新名字推给服务端。',
            aliases: ['device name', '设备'],
            render: (setting) => {
              // 显式保存：输入只暂存本地变量，点「保存」才真正改名+重连。
              // 不能用 onChange 直连 updateDeviceName——每敲一个键就触发一次
              // forceReconnect → onAuthed → syncNow 全量对账。
              let pendingName = this.plugin.deviceName
              let saveBtn: ButtonComponent | null = null
              const syncSaveVisibility = () => {
                const changed =
                  pendingName.trim() !== '' && pendingName.trim() !== this.plugin.deviceName
                if (saveBtn) saveBtn.buttonEl.style.display = changed ? '' : 'none'
              }
              setting
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
                      this.update()
                    })
                  syncSaveVisibility()
                })
            },
          },
          {
            name: '本机设备 ID',
            desc: '前 8 位。完整 ID 在日志里（首次加载有打印）。',
            aliases: ['device id'],
            searchable: true,
            render: (setting) => {
              setting.addText((text) => text.setValue(this.plugin.shortDeviceId()).setDisabled(true))
            },
          },
        ],
      },
      {
        type: 'group',
        heading: '同步',
        visible: () => this.authorized(),
        items: [
          {
            name: '自动同步',
            desc: '开启后编辑文件自动推送（2 秒防抖）',
            aliases: ['auto sync'],
            control: {
              type: 'toggle',
              key: 'autoSync',
            },
          },
          {
            name: '立即同步',
            desc: '全量对账：上报本地清单，按差异上传/下载',
            aliases: ['sync now'],
            render: (setting) => {
              setting.addButton((btn) =>
                btn.setCta().setButtonText('立即同步').onClick(() => {
                  void this.plugin.syncNow()
                }),
              )
            },
          },
          {
            name: '刷新授权状态',
            desc: '重新连接服务器验证授权（token 是否仍有效）',
            aliases: ['refresh', '授权'],
            render: (setting) => {
              setting.addButton((btn) =>
                btn.setButtonText('刷新').onClick(() => {
                  this.plugin.refreshAuthStatus()
                }),
              )
            },
          },
        ],
      },
      {
        type: 'group',
        heading: '诊断',
        items: [
          {
            name: '版本信息',
            aliases: ['version', '插件版本', '服务端版本'],
            render: (setting) => {
              this.flattenSettingRow(setting)
              this.renderVersionInfo(setting.settingEl)
            },
          },
          {
            name: '运行日志',
            aliases: ['log', '日志'],
            render: (setting) => {
              this.flattenSettingRow(setting)
              this.renderLogSection(setting.settingEl)
            },
          },
        ],
      },
      {
        type: 'group',
        heading: '危险操作',
        visible: () => this.authorized(),
        items: [
          {
            name: '断开连接并取消授权',
            desc: '清除本地保存的服务器地址与 Token',
            aliases: ['disconnect', 'logout', '取消授权'],
            render: (setting) => {
              setting.addButton((btn) =>
                btn
                  .setDestructive()
                  .setButtonText('断开并取消授权')
                  .onClick(() => {
                    new ConfirmDisconnectModal(this.plugin.app, () => {
                      void this.plugin.disconnectFromSettings()
                    }).open()
                  }),
              )
            },
          },
        ],
      },
    ]
  }

  /** 连接状态变化时只重绘状态卡（不整页重绘，避免打断连接表单/日志过滤的输入） */
  refreshStatusCard(): void {
    const card = this.statusCardEl
    if (!card || !card.isConnected) return
    const holder = document.body.createEl('div')
    this.renderStatusCard(holder)
    const child = holder.firstElementChild
    holder.remove()
    if (child && card.parentElement) card.parentElement.replaceChild(child, card)
  }

  /**
   * 声明式 render 默认会画出 Setting 的 name/info 行。自定义块（状态卡、
   * 日志、callout）不需要那一行，把 settingEl 清成空容器再往里塞。
   */
  private flattenSettingRow(setting: Setting): void {
    setting.settingEl.empty()
    setting.settingEl.addClass('owiki-setting-custom')
  }

  // ---------- 状态仪表卡 ----------

  /**
   * 状态仪表卡——设置页的视觉锚点：
   *  - 主行：状态图标 + 详细状态文案（按真实连接状态区分）
   *  - 次行：服务器地址 · 同步进度
   * 授权状态变化时 update() 会整卡重绘；
   * 连接状态变化时 refreshStatusCard() 只局部重绘本卡（不打断表单输入）。
   */
  private renderStatusCard(containerEl: HTMLElement): void {
    const vaultName = this.plugin.settings.authorizedVault
    const card = containerEl.createDiv({
      cls: `owiki-card owiki-status-card${vaultName ? ' owiki-status-ok' : ' owiki-status-off'}`,
    })
    this.statusCardEl = card

    const main = card.createDiv({ cls: 'owiki-status-main' })
    const iconEl = main.createSpan({ cls: 'owiki-status-icon' })

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

    const meta = card.createDiv({ cls: 'owiki-status-meta' })
    if (this.plugin.settings.serverUrl) {
      const server = meta.createSpan({ cls: 'owiki-status-server' })
      setIcon(server, 'server')
      server.createSpan({ text: this.plugin.settings.serverUrl })
    } else {
      meta.createSpan({ cls: 'owiki-status-server owiki-muted', text: '未配置服务器地址' })
    }

    if (this.plugin.syncTotal > 0) {
      const chips = card.createDiv({ cls: 'owiki-status-chips' })
      chips.createSpan({
        cls: 'owiki-chip owiki-chip-accent',
        text: `同步中 ${this.plugin.syncDone}/${this.plugin.syncTotal}`,
      })
    }
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
