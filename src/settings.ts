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
import { t } from './lang/helpers'
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
        name: t('statusTitle'),
        searchable: false,
        render: (setting) => {
          this.flattenSettingRow(setting)
          this.renderStatusCard(setting.settingEl)
        },
      },
      {
        type: 'group',
        heading: t('groupConnection'),
        visible: () => !this.authorized(),
        items: [
          {
            name: t('howToAuthName'),
            searchable: true,
            aliases: ['一键授权', 'One-click authorize', 'WebSocket', '同步令牌', 'token'],
            render: (setting) => {
              this.flattenSettingRow(setting)
              const banner = setting.settingEl.createDiv({ cls: 'owiki-callout owiki-callout-info' })
              banner.createDiv({ cls: 'owiki-callout-title', text: t('howToAuthName') })
              banner.createDiv({
                cls: 'owiki-callout-body',
                text: t('howToAuthBody'),
              })
            },
          },
          {
            name: t('serverUrlName'),
            desc: t('serverUrlDesc'),
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
            name: t('tokenName'),
            desc: t('tokenDesc'),
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
            name: t('vaultNameName'),
            desc: t('vaultNameDesc'),
            aliases: ['vault'],
            render: (setting) => {
              setting.addText((text) =>
                text
                  .setPlaceholder(t('vaultNamePlaceholder'))
                  .setValue(this.draftVaultHint)
                  .onChange((v) => {
                    this.draftVaultHint = v.trim()
                  }),
              )
            },
          },
          {
            name: t('connectName'),
            desc: t('connectDesc'),
            render: (setting) => {
              setting.addButton((btn) =>
                btn
                  .setCta()
                  .setButtonText(t('connectButton'))
                  .onClick(async () => {
                    const serverUrl = this.draftServerUrl || this.plugin.settings.serverUrl
                    const token = this.draftToken || this.plugin.settings.token
                    const vaultHint = this.draftVaultHint
                    if (!serverUrl || !token) {
                      new Notice(`Owiki: ${t('noticeNeedServerAndToken')}`)
                      return
                    }
                    if (!vaultHint) {
                      new Notice(`Owiki: ${t('noticeNeedVaultName')}`)
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
        heading: t('groupDevice'),
        items: [
          {
            name: t('deviceNameName'),
            desc: t('deviceNameDesc'),
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
                    .setPlaceholder(t('deviceNamePlaceholder'))
                    .setValue(this.plugin.deviceName)
                    .onChange((v) => {
                      pendingName = v
                      syncSaveVisibility()
                    }),
                )
                .addButton((btn) => {
                  saveBtn = btn
                    .setButtonText(t('saveButton'))
                    .setCta()
                    .onClick(async () => {
                      const name = pendingName.trim()
                      if (!name || name === this.plugin.deviceName) {
                        new Notice(`Owiki: ${t('noticeDeviceNameUnchanged')}`)
                        return
                      }
                      btn.setDisabled(true).setButtonText(t('savingButton'))
                      await this.plugin.updateDeviceName(name)
                      new Notice(`Owiki: ${t('noticeDeviceNameUpdated', { name })}`)
                      this.update()
                    })
                  syncSaveVisibility()
                })
            },
          },
          {
            name: t('deviceIdName'),
            desc: t('deviceIdDesc'),
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
        heading: t('groupSync'),
        visible: () => this.authorized(),
        items: [
          {
            name: t('autoSyncName'),
            desc: t('autoSyncDesc'),
            aliases: ['auto sync'],
            control: {
              type: 'toggle',
              key: 'autoSync',
            },
          },
          {
            name: t('syncNowName'),
            desc: t('syncNowDesc'),
            aliases: ['sync now'],
            render: (setting) => {
              setting.addButton((btn) =>
                btn.setCta().setButtonText(t('syncNowButton')).onClick(() => {
                  void this.plugin.syncNow()
                }),
              )
            },
          },
          {
            name: t('refreshAuthName'),
            desc: t('refreshAuthDesc'),
            aliases: ['refresh', '授权'],
            render: (setting) => {
              setting.addButton((btn) =>
                btn.setButtonText(t('refreshAuthButton')).onClick(() => {
                  this.plugin.refreshAuthStatus()
                }),
              )
            },
          },
        ],
      },
      {
        type: 'group',
        heading: t('groupDiagnostics'),
        items: [
          {
            name: t('versionInfoName'),
            aliases: ['version', '插件版本', '服务端版本', 'plugin version', 'server version'],
            render: (setting) => {
              this.flattenSettingRow(setting)
              this.renderVersionInfo(setting.settingEl)
            },
          },
          {
            name: t('logSectionName'),
            aliases: ['log', '日志', 'logs'],
            render: (setting) => {
              this.flattenSettingRow(setting)
              this.renderLogSection(setting.settingEl)
            },
          },
        ],
      },
      {
        type: 'group',
        heading: t('groupDanger'),
        visible: () => this.authorized(),
        items: [
          {
            name: t('dangerName'),
            desc: t('dangerDesc'),
            aliases: ['disconnect', 'logout', '取消授权'],
            render: (setting) => {
              setting.addButton((btn) =>
                btn
                  .setDestructive()
                  .setButtonText(t('dangerButton'))
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
        stateText = t('statusUnauthWaiting')
        icon = 'circle-dashed'
      } else {
        stateText = t('statusUnconfigured')
        icon = 'circle-alert'
      }
    } else if (state === 'authed') {
      stateText = t('statusConnectedVault', { vault: vaultName })
      icon = 'circle-check'
    } else if (state === 'observing') {
      stateText = t('statusObservingVault', { vault: vaultName })
      icon = 'circle-alert'
    } else if (state === 'connecting') {
      stateText = t('statusConnectingVault', { vault: vaultName })
      icon = 'circle-dashed'
    } else if (state === 'connected') {
      stateText = t('statusAuthenticatingVault', { vault: vaultName })
      icon = 'circle-dashed'
    } else {
      stateText = t('statusDisconnectedVault', { vault: vaultName })
      icon = 'circle-off'
    }
    setIcon(iconEl, icon)
    main.createSpan({ cls: 'owiki-status-title', text: stateText })

    if (state === 'observing') {
      const hint = card.createDiv({ cls: 'owiki-callout owiki-callout-warning' })
      hint.createDiv({
        cls: 'owiki-callout-title',
        text: t('observingTitle'),
      })
      hint.createDiv({
        cls: 'owiki-callout-body',
        text: t('observingBody'),
      })
    }

    const meta = card.createDiv({ cls: 'owiki-status-meta' })
    if (this.plugin.settings.serverUrl) {
      const server = meta.createSpan({ cls: 'owiki-status-server' })
      setIcon(server, 'server')
      server.createSpan({ text: this.plugin.settings.serverUrl })
    } else {
      meta.createSpan({ cls: 'owiki-status-server owiki-muted', text: t('statusNoServer') })
    }

    if (this.plugin.syncTotal > 0) {
      const chips = card.createDiv({ cls: 'owiki-status-chips' })
      chips.createSpan({
        cls: 'owiki-chip owiki-chip-accent',
        text: t('syncProgress', { done: this.plugin.syncDone, total: this.plugin.syncTotal }),
      })
    }
  }

  // ---------- 诊断：版本 ----------

  private renderVersionInfo(containerEl: HTMLElement): void {
    const wrap = containerEl.createDiv({ cls: 'owiki-subsection' })
    const header = wrap.createDiv({ cls: 'owiki-subsection-head' })
    header.createSpan({ text: t('versionInfoHead') })

    const rows: Array<[string, string]> = [
      [t('versionPlugin'), `v${this.plugin.clientVersion()}`],
      [t('versionMinObsidian'), `v${this.plugin.minObsidianVersion()}`],
    ]
    const liveServer = this.plugin.serverVersionLive()
    const cachedServer = this.plugin.serverVersionCached()
    if (liveServer) {
      rows.push([t('versionServerLive'), `v${liveServer}`])
    } else if (cachedServer) {
      rows.push([t('versionServerCached'), `v${cachedServer}`])
    } else {
      rows.push([t('versionServer'), t('versionServerUnknown')])
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
    head.createSpan({ text: t('logSectionHead') })

    const logBox = wrap.createEl('pre', { cls: 'owiki-log-box' })
    this.renderLogBox = () => {
      const entries = this.plugin.logger.recent(80)
      logBox.empty()
      if (entries.length === 0) {
        logBox.createSpan({ cls: 'owiki-log-empty', text: t('logEmpty') })
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
      .setName(t('logActionsName'))
      .setDesc(t('logActionsDesc'))
      .addButton((btn) =>
        btn.setButtonText(t('logCopyButton')).onClick(async () => {
          await navigator.clipboard.writeText(this.plugin.logger.recentText())
          new Notice(`Owiki: ${t('noticeLogCopied')}`)
        }),
      )
      .addButton((btn) =>
        btn.setButtonText(t('logClearButton')).onClick(async () => {
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
    contentEl.createEl('h3', { text: t('disconnectModalTitle') })

    const list = contentEl.createEl('ul', { cls: 'owiki-disconnect-list' })
    for (const item of [
      t('disconnectModalItem1'),
      t('disconnectModalItem2'),
      t('disconnectModalItem3'),
    ]) {
      list.createEl('li', { text: item })
    }

    const btns = contentEl.createDiv({ cls: 'owiki-confirm-buttons' })
    const cancelBtn = btns.createEl('button', { text: t('cancelButton') })
    cancelBtn.addEventListener('click', () => this.close())
    const okBtn = btns.createEl('button', {
      text: t('disconnectConfirmButton'),
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
