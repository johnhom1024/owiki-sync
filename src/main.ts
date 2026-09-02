// owiki-sync 主入口：
// vault 文件监听 → 哈希 → 上传；对账下载；changed 广播响应
import {
  Debouncer,
  Menu,
  Modal,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  debounce,
  setIcon,
} from 'obsidian'
import { OwikiSyncClient, ConnState } from './client'
import {
  Changed,
  Conflict,
  Deleted,
  FetchResponse,
  HashListResponse,
  OK,
  Renamed,
  ServerMessage,
} from './protocol'
import { OwikiSyncSettingTab } from './settings'
import { OwikiLogger } from './logger'
import { ensureDeviceIdentity, setDeviceName, getDeviceId } from './device-identity'

interface OwikiSettings {
  serverUrl: string
  token: string
  autoSync: boolean
  /** 授权状态：最近一次认证成功时服务端返回的 vault 名 */
  authorizedVault?: string
  /**
   * 最近一次认证成功时服务端返回的版本号（来自 welcome.serverVersion）。
   * 持久化是因为客户端未必每次都保持连接——重连前打开设置页也能看到。
   */
  serverVersion?: string
  // 注意：deviceId / deviceName 不再放在这里。
  // 它们是物理设备私有状态，写在 app.loadLocalStorage（见 device-identity.ts），
  // 否则跟着 .obsidian/plugins/owiki-sync/data.json 被 iCloud 同步，
  // 多设备会共用同一个 ID，破坏服务端「按设备区分」的语义。
}

const DEFAULT_SETTINGS: OwikiSettings = {
  // 默认留空：全新安装视为「未配置」，状态卡不再显示一个用户从未填过的
  // 开发地址（之前默认预填 ws://localhost:8787/ws 会误显示成"未授权+URL"）。
  // 服务器地址格式在连接表单的 placeholder 里提示。
  serverUrl: '',
  token: '',
  autoSync: true,
}

// 本地哈希缓存：path → {hash, mtime}（避免每次全量重算）
interface LocalEntry {
  hash: string
  mtime: number
  /** 上次与服务端达成共识的哈希，作乐观锁 baseHash */
  syncedHash?: string
}

// 按二进制附件处理的扩展名（与服务端 repository.IsAttachment 保持一致）
const ATTACHMENT_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'pdf',
])

function isAttachment(path: string): boolean {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return ATTACHMENT_EXTS.has(ext)
}

/** ArrayBuffer → base64（分块转换避免 String.fromCharCode 栈溢出） */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/** base64 → Uint8Array */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export default class OwikiSyncPlugin extends Plugin {
  settings: OwikiSettings = DEFAULT_SETTINGS

  private client!: OwikiSyncClient
  /**
   * 设备私有状态（来自 app.loadLocalStorage，与 vault 隔离，不被 iCloud 同步）。
   * 加载时由 ensureDeviceIdentity 一次性就位；设置页改名时只更新 deviceName。
   * 公开是因为设置页 / 日志 / 测试 eval 都要读，且没有可变接口暴露给外部。
   */
  deviceId = ''
  deviceName = ''
  /** 运行日志：连接/授权/同步/错误全记录，设置页可查看 */
  logger = new OwikiLogger()
  private localHashes = new Map<string, LocalEntry>() // path → 上次已知状态
  private statusBarItem: HTMLElement | null = null
  /** 设置页打开中的实例（授权状态变化时重绘用） */
  private settingTab: OwikiSyncSettingTab | null = null
  private pendingUploads = new Set<string>()
  private pendingForce = new Set<string>() // hashlist LWW 判定客户端赢 → 强制覆盖
  // 同步进度（状态栏展示）：本次对账的总任务数与已完成数。
  // public：设置页状态仪表卡要读（显示"同步中 m/n"chip）
  syncTotal = 0
  syncDone = 0
  private syncDownPaths = new Set<string>() // 本次对账待下载路径，用于精确计数
  private debouncedFlush!: Debouncer<[], void>
  // 下载写盘时忽略自己的 modify 事件，防回环
  private applyingRemote = new Set<string>()
  // 未解决冲突的路径：不自动重传，避免死循环
  private conflicted = new Set<string>()
  // 刚发生的本地 rename：随后的 modify/create 要丢掉
  private pendingRenames = new Set<string>()

  async onload(): Promise<void> {
    await this.loadSettings()
    // 设备身份从 localStorage 取：旧 settings 残留值会被一次性迁过去
    const identity = ensureDeviceIdentity(this.app, this.settings, this.app.vault.getName())
    this.deviceId = identity.deviceId
    this.deviceName = identity.deviceName
    this.logger.attach(this.app)
    this.logger.info('plugin', `插件加载：vault=${this.app.vault.getName()} deviceId=${this.deviceId?.slice(0, 8)}… deviceName=${this.deviceName} autoSync=${this.settings.autoSync}`)

    this.client = new OwikiSyncClient({
      onState: (s) => this.updateStatusBar(s),
      onMessage: (m) => {
        void this.handleMessage(m)
      },
      // 认证成功（首连+每次重连）→ 记录授权的 vault 名 + 自动补对账
      onAuthed: (vault, syncEnabled) => {
        this.logger.info(
          'auth',
          `认证成功${vault ? `，远程 vault=「${vault}」` : ''}${syncEnabled === false ? '（非同步设备，观察态）' : ''}`,
        )
        if (this.pendingConfirm) {
          // 设置页发起的连接：先弹确认框，确认后才开同步
          this.pendingConfirm = false
          this.showConfirmSyncModal(vault)
          return
        }
        let changed = false
        if (vault && vault !== this.settings.authorizedVault) {
          this.settings.authorizedVault = vault
          changed = true
        }
        // 记录服务端版本（来自 welcome.serverVersion），设置页展示用。
        // 老服务端未带该字段时为 undefined，自动兼容（不覆盖已有值）。
        const serverVersion = this.client.serverVersion
        if (serverVersion !== undefined && serverVersion !== this.settings.serverVersion) {
          this.settings.serverVersion = serverVersion
          changed = true
          this.logger.info('auth', `服务端版本：v${serverVersion}`)
        }
        if (changed) {
          void this.saveSettings()
          this.rerenderSettings()
        }
        // 观察态：单设备同步模式下本设备未被选中——不启动同步，
        // 状态卡/状态栏由 connState='observing' 驱动展示
        if (syncEnabled === false) {
          this.updateStatusBar('observing')
          return
        }
        // 改名触发的重连：内容没变，跳过这次自动对账
        if (this.skipNextSync) {
          this.skipNextSync = false
          this.logger.info('sync', '跳过自动对账（改名重连，内容未变）')
          return
        }
        void this.syncNow()
      },
      // 同步资格在线切换（服务端 sync_state 推送）：静默 ↔ 同步互转
      onSyncEnabledChanged: (enabled, message) => {
        this.logger.info('auth', message ?? (enabled ? '同步已恢复' : '本设备已被静默'))
        if (enabled) {
          new Notice(`Owiki: ${message ?? '本设备已恢复同步，开始对账'}`)
          // 静默期间收不到广播：恢复时必须补全量对账
          void this.syncNow()
        } else {
          // 被静默：清掉排队中的上传（否则恢复后会一股脑传出去）
          this.pendingUploads.clear()
          this.pendingForce.clear()
          this.syncTotal = 0
          this.syncDone = 0
          this.syncDownPaths.clear()
          new Notice(`Owiki: ${message ?? '本设备未被选为同步设备，文件变更不会同步'}`)
          this.updateStatusBar('observing')
        }
        this.rerenderSettings()
      },
      // 认证失败 → 按原因区分提示，并清除本地授权状态
      onAuthFailed: (message) => {
        this.logger.error('auth', `认证失败：${message ?? '未知原因'}`)
        // 认证被拒也算连接流程终结：复位待确认标记，避免超时兜底重复弹提示
        this.pendingConfirm = false
        if (this.settings.authorizedVault !== undefined) {
          this.settings.authorizedVault = undefined
          void this.saveSettings()
        }
        this.updateStatusBar('disconnected')
        // 设置页如果开着，重绘让「已授权」状态立即消失
        this.rerenderSettings()
        if (message === 'invalid token') {
          // token 对不上任何 vault（或 vault 已被删除）：两种可能都归到这条提示
          new Notice('Owiki: Token 或 vault 名称有误，请核对后重试')
        } else {
          new Notice(`Owiki: 认证失败${message ? `（${message}）` : ''}`)
        }
      },
    })
    this.client.configure(
      this.settings.serverUrl,
      this.settings.token,
      this.deviceId,
      this.deviceName,
      this.manifest.version,
    )

    // 状态栏指示器
    this.statusBarItem = this.addStatusBarItem()
    this.updateStatusBar('disconnected')

    // 左侧栏 ribbon 图标：点击弹菜单
    const ribbonIconEl = this.addRibbonIcon('refresh-cw', 'Owiki 同步', (evt) =>
      this.showRibbonMenu(evt),
    )
    ribbonIconEl.addClass('owiki-ribbon')

    // 命令：手动同步（命令 ID 无需插件前缀，Obsidian 会自动加 owiki-sync: 前缀）
    this.addCommand({
      id: 'sync-now',
      name: '立即同步',
      callback: () => this.syncNow(),
    })

    // 命令：打开插件设置
    this.addCommand({
      id: 'open-settings',
      name: '打开同步设置',
      callback: () => this.openPluginSettings(),
    })

    // vault 文件事件（只在自动同步开启时生效）
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!this.settings.autoSync) return
        if (file instanceof TFile) void this.onLocalChange(file)
      }),
    )
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (!this.settings.autoSync) return
        if (file instanceof TFile) void this.onLocalChange(file)
      }),
    )
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (!this.settings.autoSync) return
        if (file instanceof TFile) void this.onLocalDelete(file)
      }),
    )
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (!this.settings.autoSync) return
        if (file instanceof TFile) void this.onLocalRename(file, oldPath)
      }),
    )

    // 防抖：收集 2 秒内的变更一次性上传
    this.debouncedFlush = debounce(() => this.flushPendingUploads(), 2000, true)

    const tab = new OwikiSyncSettingTab(this.app, this)
    this.settingTab = tab
    this.addSettingTab(tab)

    // 一键授权：Web 端设置页点「授权连接 Obsidian」→ 浏览器跳转
    // obsidian://owiki-sync?action=authorize&server=ws://...&token=...
    // Obsidian 唤起本插件并带上 query 参数，这里自动写入配置并连接。
    this.registerObsidianProtocolHandler('owiki-sync', (params) => {
      void this.handleOAuth(params)
    })

    if (this.settings.serverUrl) {
      this.client.connect()
      // 注：不再需要延时 syncNow——client 的 onAuthed 回调会在认证成功后触发
    }
  }

  onunload(): void {
    this.logger.info('plugin', '插件卸载，断开连接')
    this.client.disconnect()
    this.debouncedFlush?.cancel()
    void this.logger.dispose()
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as OwikiSettings
    // 注意：deviceId / deviceName 的初始化已挪到 onload 里 ensureDeviceIdentity。
    // 旧 data.json 里残留的字段会被迁移到 localStorage，data.json 留它们也无所谓，
    // 但下次 saveData 时会被覆盖成 undefined（OwikiSettings 不再含这俩字段）。
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  /**
   * 设置页更新本机设备名：写 localStorage（不同步）+ 同步内存值 + 触发重连。
   * 不写 data.json：设备名是本机属性，跟 vault 走就被 iCloud 互相覆盖了。
   */
  async updateDeviceName(name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || trimmed === this.deviceName) return
    setDeviceName(this.app, trimmed)
    this.deviceName = trimmed
    this.logger.info('settings', `本机设备名已更新为「${trimmed}」`)
    // 名字变了通知服务端：重连时 hello 消息会带新 deviceName，
    // 触发服务端 deviceRepo.Authenticate 刷新 DeviceName 字段。
    // 改名重连内容没变，跳过随后的全量对账（否则 1269 文件白跑一遍）
    this.skipNextSync = true
    this.client.configure(
      this.settings.serverUrl,
      this.settings.token,
      this.deviceId,
      this.deviceName,
      this.manifest.version,
    )
    this.client.forceReconnect()
  }

  /** 改名等场景的重连：跳过 onAuthed 自动补的全量对账（内容未变） */
  private skipNextSync = false

  /** 设置页展示用：拿到本机 deviceId 前 8 位（与服务端日志格式一致）。 */
  shortDeviceId(): string {
    return this.deviceId ? this.deviceId.slice(0, 8) : '未生成'
  }

  /** 测试 / 调试用：完整 deviceId（不在 UI 默认展示，避免误读）。 */
  fullDeviceId(): string {
    return getDeviceId(this.app) ?? this.deviceId ?? ''
  }

  /** 设置页展示用：插件版本（来自 manifest.json） */
  clientVersion(): string {
    return this.manifest.version
  }

  /** 设置页展示用：Obsidian 最低支持版本（来自 manifest.json minAppVersion） */
  minObsidianVersion(): string {
    return this.manifest.minAppVersion
  }

  /** 设置页展示用：当前连接是否处于认证成功态 */
  isConnected(): boolean {
    return this.client.connected
  }

  /** 设置页展示用：当前连接状态原始值（区分连接中/已连接认证/断开重连中） */
  connState(): ConnState {
    return this.client.connState
  }

  /** 设置页展示用：最近一次认证成功时拿到服务端版本（持久化在 settings） */
  serverVersionCached(): string {
    return this.settings.serverVersion ?? ''
  }

  /** 设置页展示用：本次连接实时拿到服务端版本（认证未完成时为空） */
  serverVersionLive(): string {
    return this.client.serverVersion ?? ''
  }

  // ---------- 一键授权 ----------

  /**
   * 处理 obsidian://owiki-sync 深链。
   * params 的 key 全部小写（Obsidian 会把 query 参数名小写化）。
   */
  private async handleOAuth(params: Record<string, string>): Promise<void> {
    const server = params.server ?? ''
    const token = params.token ?? ''
    // vaultName 是我们自己的参数；老链接用 vault，但 Obsidian 会把它当内置
    // 路由参数消费掉，实际到不了这里，仅作兼容兜底
    const vault = params.vaultName ?? params.vault ?? ''

    // 注意：不校验 action--Obsidian 会把 URI 的 host 位（=owiki-sync）作为
    // action 塞进 params，覆盖 query 里的 action=authorize。handler 被调用
    // 本身就等于授权意图，无需再判断。
    if (!server || !token) {
      new Notice('Owiki: 授权链接无效')
      this.logger.warn('oauth', `深链参数无效：server=${server ? '有' : '无'} token=${token ? '有' : '无'}`)
      return
    }

    this.logger.info('oauth', `收到一键授权深链${vault ? `（vault=「${vault}」）` : ''}`)

    this.settings.serverUrl = server
    this.settings.token = token
    await this.saveSettings()

    // 授权也走确认流程：先打开本插件设置页（用户能看到上下文），
    // 认证成功后在设置页之上弹确认弹窗，用户确认了才开始同步
    this.openPluginSettings()
    this.hintFromUser = false
    this.beginPendingConnect(vault)

    this.updateStatusBar('connecting')
    new Notice(`Owiki: 正在连接${vault ? `「${vault}」` : ''}，请在弹窗中确认同步…`)
  }

  // ---------- 同步流程 ----------

  /** 全量对账：上报本地清单 → 按 diffs 上传/下载 */
  async syncNow(): Promise<void> {
    if (!this.client.connected) {
      new Notice('Owiki: 未连接服务器')
      return
    }
    if (this.client.connState === 'observing') {
      // 单设备同步模式：本设备未被选中，服务端会拒绝对账——不发起
      new Notice('Owiki: 本设备未被选为同步设备（单设备同步模式），修改不会同步')
      return
    }
    this.logger.info('sync', '开始全量对账')
    // md 笔记 + 二进制附件（图片等）
    const allFiles = this.app.vault.getFiles().filter(
      (f) =>
        (f.extension === 'md' || isAttachment(f.path)) &&
        !f.path.endsWith('.conflict.md') &&
        !f.path.startsWith(`${this.app.vault.configDir}/`),
    )
    const entries: { path: string; hash: string; mtime: number }[] = []

    for (const f of allFiles) {
      const cached = this.localHashes.get(f.path)
      // mtime 未变 → 用缓存哈希，不重读文件（增量同步的本地优化）
      if (cached && cached.mtime === f.stat.mtime) {
        entries.push({ path: f.path, hash: cached.hash, mtime: Math.floor(f.stat.mtime / 1000) })
        continue
      }
      const hash = await this.hashFile(f)
      this.localHashes.set(f.path, { hash, mtime: f.stat.mtime, syncedHash: cached?.syncedHash })
      entries.push({ path: f.path, hash, mtime: Math.floor(f.stat.mtime / 1000) })
    }

    this.client.send(JSON.stringify({ type: 'hashlist', entries }))
    this.logger.info('sync', `已上报清单（${entries.length} 个文件），等待差异结果`)
    new Notice(`Owiki: 对账中（${entries.length} 个文件）`)
  }

  /** 读文件并算哈希：文本走 read，附件走二进制 */
  private async hashFile(f: TFile): Promise<string> {
    if (isAttachment(f.path)) {
      const buf = await this.app.vault.readBinary(f)
      return this.sha256Bytes(new Uint8Array(buf))
    }
    const content = await this.app.vault.read(f)
    return this.sha256(content)
  }

  /** 本地文件变更（防抖收集） */
  private async onLocalChange(file: TFile): Promise<void> {
    if (this.applyingRemote.has(file.path)) return // 自己写盘触发的事件，跳过
    if (this.pendingRenames.has(file.path)) return // rename 连带的 modify/create
    if (file.extension !== 'md' && !isAttachment(file.path)) return
    if (file.path.endsWith('.conflict.md')) return // 冲突副本不同步，避免污染
    this.conflicted.delete(file.path) // 用户继续编辑 = 愿意再试一次同步
    this.pendingUploads.add(file.path)
    this.debouncedFlush()
  }

  private onLocalDelete(file: TFile): void {
    if (this.applyingRemote.has(file.path)) return
    if (file.extension !== 'md' && !isAttachment(file.path)) return
    if (file.path.endsWith('.conflict.md')) return
    this.localHashes.delete(file.path)
    this.pendingUploads.delete(file.path)
    this.conflicted.delete(file.path)
    this.client.send(JSON.stringify({ type: 'delete', path: file.path }))
  }

  private onLocalRename(file: TFile, oldPath: string): void {
    if (this.applyingRemote.has(file.path) || this.applyingRemote.has(oldPath)) return
    const wasMdOrAttach = oldPath.endsWith('.md') || isAttachment(oldPath)
    if (file.extension !== 'md' && !isAttachment(file.path) && !wasMdOrAttach) return
    if (file.path.endsWith('.conflict.md') || oldPath.endsWith('.conflict.md')) return

    this.pendingRenames.add(file.path)
    window.setTimeout(() => this.pendingRenames.delete(file.path), 1500)

    const prev = this.localHashes.get(oldPath)
    if (prev) {
      this.localHashes.delete(oldPath)
      this.localHashes.set(file.path, prev)
    }
    if (this.pendingUploads.has(oldPath)) {
      this.pendingUploads.delete(oldPath)
      this.pendingUploads.add(file.path)
    }
    this.conflicted.delete(oldPath)
    this.client.send(JSON.stringify({ type: 'rename', from: oldPath, to: file.path }))
  }

  private async flushPendingUploads(): Promise<void> {
    if (this.pendingUploads.size === 0) return
    // 断线中：保留 pending，10s 后重试（重连成功 onAuthed 也会触发 syncNow 兜底）
    if (!this.client.connected) {
      window.setTimeout(() => this.debouncedFlush(), 10_000)
      return
    }
    const paths = [...this.pendingUploads]
    this.pendingUploads.clear()

    for (const path of paths) {
      const f = this.app.vault.getAbstractFileByPath(path)
      if (!(f instanceof TFile)) continue
      try {
        if (this.conflicted.has(path)) continue
        const attach = isAttachment(path)
        // 附件读二进制 base64；文本走 read
        const content = attach
          ? arrayBufferToBase64(await this.app.vault.readBinary(f))
          : await this.app.vault.read(f)
        const hash = attach
          ? await this.sha256Bytes(base64ToBytes(content))
          : await this.sha256(content)
        const cached = this.localHashes.get(path)
        const baseHash = cached?.syncedHash ?? cached?.hash ?? hash
        const force = this.pendingForce.has(path)
        this.pendingForce.delete(path)
        this.localHashes.set(path, {
          hash,
          mtime: f.stat.mtime,
          syncedHash: cached?.syncedHash,
        })
        this.client.send(
          JSON.stringify({
            type: 'upload',
            path,
            hash,
            content,
            mtime: Math.floor(f.stat.mtime / 1000),
            baseHash,
            force,
          }),
        )
      } catch (e) {
        console.error('[owiki] upload failed:', path, e)
        this.logger.error('upload', `上传失败 ${path}：${String(e)}`)
      }
    }
  }

  // ---------- 服务端消息处理 ----------

  private async handleMessage(msg: ServerMessage): Promise<void> {
    switch (msg.type) {
      case 'hashlist_response':
        await this.handleDiffs(msg)
        break
      case 'changed':
        await this.handleChanged(msg)
        break
      case 'fetch_response':
        await this.applyRemoteContent(msg)
        break
      case 'ok':
        this.handleOk(msg)
        break
      case 'conflict':
        await this.handleConflict(msg)
        break
      case 'renamed':
        await this.handleRemoteRename(msg)
        break
      case 'deleted':
        await this.handleRemoteDelete(msg)
        break
      case 'error':
        console.error('[owiki] server error:', msg.message)
        this.logger.error('server', `服务端错误：${msg.message}`)
        new Notice(`Owiki: ${msg.message}`)
        break
      default:
        break // ok / pong 等无需处理
    }
  }

  /** 对账结果处理：该传的传、该拉的拉 */
  private async handleDiffs(resp: HashListResponse): Promise<void> {
    let ups = 0
    let downs = 0

    for (const d of resp.diffs) {
      if (d.action === 'upload') {
        // 服务端没有/更旧 → 上传
        const f = this.app.vault.getAbstractFileByPath(d.path)
        if (f instanceof TFile && !this.conflicted.has(d.path) && !d.path.endsWith('.conflict.md')) {
          this.pendingUploads.add(d.path)
          this.pendingForce.add(d.path) // 对账已判定本端更新，允许覆盖
          ups++
        }
      } else {
        // 服务端更新 → fetch
        this.client.send(JSON.stringify({ type: 'fetch', path: d.path }))
        this.syncDownPaths.add(d.path)
        downs++
      }
    }
    if (ups > 0) this.debouncedFlush()
    const diffPaths = new Set(resp.diffs.map((d) => d.path))
    for (const [path, e] of this.localHashes) {
      if (!diffPaths.has(path)) {
        e.syncedHash = e.hash
        this.localHashes.set(path, e)
      }
    }
    if (ups + downs > 0) {
      this.logger.info('sync', `对账：${ups} 上传 / ${downs} 下载`)
      // 启动进度跟踪：状态栏展示实时进度
      this.syncTotal = ups + downs
      this.syncDone = 0
      this.renderSyncProgress()
    } else {
      this.logger.info('sync', '对账完成：已是最新')
      new Notice('Owiki: 已是最新')
    }
  }

  /** 收到变更广播：哈希和本地不同才 fetch（防止无谓拉取） */
  private async handleChanged(msg: Changed): Promise<void> {
    const local = this.localHashes.get(msg.path)
    if (local && local.hash === msg.hash) return // 已经是最新
    this.client.send(JSON.stringify({ type: 'fetch', path: msg.path }))
  }

  private handleOk(msg: OK): void {
    if (msg.for !== 'upload' || !msg.path) return
    this.conflicted.delete(msg.path)
    if (msg.hash) {
      const prev = this.localHashes.get(msg.path)
      this.localHashes.set(msg.path, {
        hash: msg.hash,
        mtime: prev?.mtime ?? Date.now(),
        syncedHash: msg.hash,
      })
    }
    if (msg.merged && msg.hash) {
      // 服务端自动合并后的正文可能和本地不同，拉回来
      this.client.send(JSON.stringify({ type: 'fetch', path: msg.path }))
    }
    // 上传完成：推进进度
    this.syncDone++
    if (this.syncDone >= this.syncTotal) {
      this.finishSync()
    } else {
      this.renderSyncProgress()
    }
  }

  /**
   * 无法自动合并：当前文件保持本地版本，远程另存为 path.conflict.md
   * 这样 Obsidian 里能并排打开两份，用户自己挑。
   */
  private async handleConflict(msg: Conflict): Promise<void> {
    this.conflicted.add(msg.path)
    const conflictPath = this.conflictPath(msg.path)
    this.applyingRemote.add(conflictPath)
    try {
      const existing = this.app.vault.getAbstractFileByPath(conflictPath)
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, msg.serverContent)
      } else {
        const dir = conflictPath.split('/').slice(0, -1).join('/')
        if (dir && !(await this.app.vault.adapter.exists(dir))) {
          await this.app.vault.createFolder(dir)
        }
        await this.app.vault.create(conflictPath, msg.serverContent)
      }
      new Notice(`Owiki: 冲突 ${msg.path} → 远程副本已保存为 ${conflictPath}`)
    } catch (e) {
      console.error('[owiki] write conflict copy failed:', conflictPath, e)
      new Notice(`Owiki: 冲突无法落盘 ${msg.path}`)
    } finally {
      this.applyingRemote.delete(conflictPath)
    }
  }

  private conflictPath(path: string): string {
    return path.endsWith('.md') ? path.slice(0, -3) + '.conflict.md' : path + '.conflict'
  }

  /** 上次连接状态（日志去重用） */
  private lastConnState: ConnState | null = null
  /** 深链授权场景下 hint 来自服务端，没有用户期望语义；用于在弹窗里决定是否显示「你填写的名称」 */
  private hintFromUser = false

  private async handleRemoteRename(msg: Renamed): Promise<void> {
    if (msg.from === msg.to) return
    this.applyingRemote.add(msg.from)
    this.applyingRemote.add(msg.to)
    try {
      const src = this.app.vault.getAbstractFileByPath(msg.from)
      const dest = this.app.vault.getAbstractFileByPath(msg.to)
      if (src instanceof TFile && !dest) {
        const dir = msg.to.split('/').slice(0, -1).join('/')
        if (dir && !(await this.app.vault.adapter.exists(dir))) {
          await this.app.vault.createFolder(dir)
        }
        await this.app.fileManager.renameFile(src, msg.to)
      } else if (!src && !dest) {
        this.client.send(JSON.stringify({ type: 'fetch', path: msg.to }))
      }
      const prev = this.localHashes.get(msg.from)
      if (prev) {
        this.localHashes.delete(msg.from)
        this.localHashes.set(msg.to, prev)
      }
      this.pendingUploads.delete(msg.from)
      this.conflicted.delete(msg.from)
    } catch (e) {
      console.error('[owiki] remote rename failed:', msg.from, msg.to, e)
    } finally {
      this.applyingRemote.delete(msg.from)
      this.applyingRemote.delete(msg.to)
    }
  }

  private async handleRemoteDelete(msg: Deleted): Promise<void> {
    this.applyingRemote.add(msg.path)
    try {
      const f = this.app.vault.getAbstractFileByPath(msg.path)
      if (f instanceof TFile) {
        // 走回收站（尊重用户「删除至系统回收站/-trash 文件夹」的偏好设置），
        // 误删可找回；.trash 内文件已被上面的 configDir 过滤排除，不会回传
        await this.app.fileManager.trashFile(f)
      }
      this.localHashes.delete(msg.path)
      this.pendingUploads.delete(msg.path)
      this.conflicted.delete(msg.path)
    } catch (e) {
      console.error('[owiki] remote delete failed:', msg.path, e)
    } finally {
      this.applyingRemote.delete(msg.path)
    }
  }

  /** 远程内容落盘：附件走二进制 */
  private async applyRemoteContent(msg: FetchResponse): Promise<void> {
    this.applyingRemote.add(msg.path)
    try {
      let file = this.app.vault.getAbstractFileByPath(msg.path)
      // 新文件：确保目录存在
      if (!(file instanceof TFile)) {
        const dir = msg.path.split('/').slice(0, -1).join('/')
        if (dir && !(await this.app.vault.adapter.exists(dir))) {
          await this.app.vault.createFolder(dir)
        }
      }
      if (isAttachment(msg.path)) {
        const data = base64ToBytes(msg.content)
        file = await this.writeRemote(file, msg.path, data.buffer as ArrayBuffer, true)
      } else {
        file = await this.writeRemote(file, msg.path, msg.content, false)
      }
      if (file instanceof TFile) {
        this.localHashes.set(msg.path, { hash: msg.hash, mtime: file.stat.mtime, syncedHash: msg.hash })
      }
    } catch (e) {
      console.error('[owiki] apply remote failed:', msg.path, e)
      this.logger.error('download', `远程内容落盘失败 ${msg.path}：${String(e)}`)
    } finally {
      this.applyingRemote.delete(msg.path)
    }
    // 对账下载完成：推进进度（仅当该路径属于本次对账，避免增量下载污染计数）
    if (this.syncDownPaths.delete(msg.path)) {
      this.syncDone++
      if (this.syncDone >= this.syncTotal) {
        this.finishSync()
      } else {
        this.renderSyncProgress()
      }
    }
  }

  /**
   * 远程内容写入（文本或二进制）。
   * create 与 modify 之间存在竞态：判断"文件不存在"到 vault.create 落盘之间，
   * iCloud 物化 / 另一客户端可能已创建同名文件，Obsidian 会自动改名生成 "xxx 2.md"
   * 副本并被同步循环放大。因此 create 前后都做兜底：
   *  - create 前再查一次（adapter.exists 覆盖 iCloud 未物化的索引盲区）
   *  - create 后若目标路径拿不到 TFile，说明被 Obsidian 改名，找到实际产物并删除
   */
  private async writeRemote(
    file: TAbstractFile | null,
    path: string,
    content: string | ArrayBuffer,
    binary: boolean,
  ): Promise<TFile | null> {
    if (file instanceof TFile) {
      if (binary) await this.app.vault.modifyBinary(file, content as ArrayBuffer)
      else await this.app.vault.modify(file, content as string)
      return file
    }
    // 二次确认：iCloud 物化延迟下 getAbstractFileByPath 可能为 null 但磁盘已有文件
    if (await this.app.vault.adapter.exists(path)) {
      await this.writeAdapter(path, content)
      return this.app.vault.getAbstractFileByPath(path) as TFile | null
    }
    const before = new Set(this.app.vault.getMarkdownFiles().map((f) => f.path))
    if (binary) await this.app.vault.createBinary(path, content as ArrayBuffer)
    else await this.app.vault.create(path, content as string)
    const created = this.app.vault.getAbstractFileByPath(path)
    if (created instanceof TFile) return created
    // create 被 Obsidian 改名了：找出新增的那个副本并删除，保留目标路径语义
    const dup = this.app.vault.getMarkdownFiles().find((f) => !before.has(f.path))
    if (dup) {
      console.warn('[owiki] create renamed to', dup.path, '- removing duplicate')
      this.applyingRemote.add(dup.path)
      try {
        // 同步链路内部的重复文件清理（瞬时垃圾），直接删不走回收站；
        // 目标路径的正确内容随后由 writeAdapter 写入
        await this.app.vault.delete(dup)
      } finally {
        this.applyingRemote.delete(dup.path)
      }
    }
    // 重试一次直写，确保目标路径有正确内容
    await this.writeAdapter(path, content)
    return this.app.vault.getAbstractFileByPath(path) as TFile | null
  }

  /** 绕过 vault 索引的底层直写（文本/二进制自适应），用于竞态兜底 */
  private async writeAdapter(path: string, content: string | ArrayBuffer): Promise<void> {
    if (typeof content === 'string') await this.app.vault.adapter.write(path, content)
    else await this.app.vault.adapter.writeBinary(path, content)
  }

  // ---------- 工具 ----------

  private async sha256(text: string): Promise<string> {
    const data = new TextEncoder().encode(text)
    return this.sha256Bytes(data)
  }

  private async sha256Bytes(data: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', data as BufferSource)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private updateStatusBar(state: ConnState): void {
    if (this.lastConnState !== state) {
      this.lastConnState = state
      this.logger.info('conn', `连接状态 -> ${state}`)
    }
    // 设置页开着时：连接状态变化只局部重绘状态卡（不整页重绘，不打断表单输入）
    this.settingTab?.refreshStatusCard()
    // ribbon 图标：默认不设色（继承主题 --icon-color 与原生一致）；
    // 连接成功点亮；同步进行中加旋转动画（见 styles.css）
    document.querySelectorAll('.owiki-ribbon').forEach((el) => {
      el.classList.toggle('owiki-connected', state === 'authed')
      el.classList.toggle('owiki-observing', state === 'observing')
      el.classList.toggle('owiki-syncing', this.syncTotal > 0)
    })
    if (!this.statusBarItem) return
    // 同步进行中：状态栏优先显示进度，连接状态变化不覆盖
    if (this.syncTotal > 0) {
      this.renderSyncProgress()
      return
    }
    const vaultName = this.settings.authorizedVault
    // 状态点 + 文案（颜色见 styles.css：绿=已连接，灰=断开，黄=连接中，紫=观察态）
    this.statusBarItem.empty()
    this.statusBarItem.addClass('owiki-status')
    this.statusBarItem.createSpan({ cls: `owiki-dot owiki-dot-${state}` })
    this.statusBarItem.createSpan({ text: 'Owiki' })
    if (state === 'authed') {
      this.statusBarItem.createSpan({
        text: vaultName ? ` · ${vaultName}` : ' · 已授权',
        cls: 'owiki-status-vault',
      })
    } else if (state === 'observing') {
      this.statusBarItem.createSpan({
        text: vaultName ? ` · 已连接 ${vaultName}（非同步设备）` : ' · 非同步设备',
        cls: 'owiki-status-vault',
      })
    }
  }

  /** 状态栏显示同步进度：文字 + 内联进度条 */
  private renderSyncProgress(): void {
    // 状态卡上的「同步中 m/n」chip 也跟着更新
    this.settingTab?.refreshStatusCard()
    if (!this.statusBarItem || this.syncTotal <= 0) return
    const pct = Math.min(100, Math.floor((this.syncDone / this.syncTotal) * 100))
    this.statusBarItem.empty()
    this.statusBarItem.addClass('owiki-status')
    this.statusBarItem.createSpan({ cls: 'owiki-dot owiki-dot-syncing' })
    this.statusBarItem.createSpan({ text: `同步中 ${this.syncDone}/${this.syncTotal}` })
    const bar = this.statusBarItem.createSpan({ cls: 'owiki-progress' })
    bar.createSpan({ cls: 'owiki-progress-fill' }).style.width = `${pct}%`
  }

  /** 同步完成：清零进度并恢复状态栏 */
  private finishSync(): void {
    const total = this.syncTotal
    this.syncTotal = 0
    this.syncDone = 0
    this.syncDownPaths.clear()
    this.updateStatusBar(this.lastConnState ?? 'authed')
    if (total > 0) {
      this.logger.info('sync', `同步完成（${total} 项）`)
      new Notice(`Owiki: 同步完成（${total} 项）`)
    }
  }

  /** ribbon 图标点击菜单 */
  private showRibbonMenu(evt: MouseEvent): void {
    const menu = new Menu()

    // 状态行（不可点击）：连接状态 + 已授权的 vault 名
    const vaultName = this.settings.authorizedVault
    const observing = this.client.connState === 'observing'
    const stateText = observing
      ? `已连接${vaultName ? `，「${vaultName}」` : ''}非同步设备（单设备同步模式）`
      : this.client.connected
        ? `已连接${vaultName ? `，「${vaultName}」同步正常` : '，同步正常'}`
        : vaultName
          ? `未连接服务器（已授权「${vaultName}」）`
          : '未连接服务器'
    menu.addItem((item) =>
      item
        .setTitle(`● ${stateText}`)
        .setIcon(observing ? 'circle-alert' : this.client.connected ? 'circle-check' : 'circle-off')
        .onClick(() => {
          /* 状态项不可点 */
        }),
    )
    menu.addSeparator()

    menu.addItem((item) =>
      item
        .setTitle('立即同步')
        .setIcon('refresh-cw')
        .onClick(() => void this.syncNow()),
    )

    menu.addItem((item) =>
      item
        .setTitle('同步设置...')
        .setIcon('settings')
        .onClick(() => this.openPluginSettings()),
    )

    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle(this.settings.autoSync ? '关闭自动同步' : '开启自动同步')
        .setIcon(this.settings.autoSync ? 'pause' : 'play')
        .onClick(async () => {
          this.settings.autoSync = !this.settings.autoSync
          await this.saveSettings()
          new Notice(
            this.settings.autoSync ? 'Owiki: 自动同步已开启' : 'Owiki: 自动同步已关闭',
          )
        }),
    )

    menu.showAtMouseEvent(evt)
  }

  // ---------- 设置页动作 ----------

  /** 设置页「连接」按钮：认证成功后先弹确认框再同步 */
  connectFromSettings(vaultHint: string): void {
    this.logger.info('connect', `设置页发起连接${vaultHint ? `（期望 vault=「${vaultHint.trim()}」）` : ''}`)
    this.hintFromUser = true
    this.beginPendingConnect(vaultHint.trim())
    new Notice('Owiki: 正在连接服务器…')
  }

  /**
   * 发起一次「待确认」连接：认证成功后弹确认弹窗，确认了才同步。
   * settingsPage=true 时不重开设置页（本来就是从那儿点的）。
   * 总是强制重连：即使 url/token 没变（用户已连着再点连接、deep link 复用旧配置），
   * 也要断开旧会话建立新的认证回合（不然 onAuthed 不会再次触发）。
   */
  private beginPendingConnect(vaultHint: string): void {
    this.pendingConfirm = true
    this.pendingVaultHint = vaultHint
    this.client.configure(
      this.settings.serverUrl,
      this.settings.token,
      this.deviceId,
      this.deviceName,
      this.manifest.version,
    )
    this.client.forceReconnect()
  }

  /** 设置页「断开并取消授权」：通知服务端解绑设备 + 断开 + 清除全部本地凭据 */
  async disconnectFromSettings(): Promise<void> {
    this.logger.info('connect', '设置页断开连接，通知服务端解绑并清除本地凭据')
    await this.client.disconnectWithBye()
    this.client.disconnect()
    this.settings.authorizedVault = undefined
    // 连 serverUrl/token 一起清：否则插件重载/刷新授权时会拿旧凭据自动重连，
    // 「取消授权」就名存实亡了
    this.settings.serverUrl = ''
    this.settings.token = ''
    await this.saveSettings()
    this.updateStatusBar('disconnected')
    this.rerenderSettings()
    new Notice('Owiki: 已断开连接并清除本地授权')
  }

  /**
   * 设置页「刷新授权状态」：强制重连做一次认证，验证当前 token 是否仍被
   * 服务端承认。认证成功/失败都会经由 onAuthed/onAuthFailed 自动更新
   * 状态栏与设置页；此处只负责触发与过程反馈。
   */
  refreshAuthStatus(): void {
    if (!this.settings.serverUrl || !this.settings.token) {
      new Notice('Owiki: 请先填写服务器地址和 Token')
      return
    }
    this.logger.info('connect', '刷新授权状态：强制重连认证')
    new Notice('Owiki: 正在刷新授权状态…')
    // configure 里 token/url 没变不会断开重连，这里显式断开再连，
    // 确保走一次完整认证（同时立刻校正服务端的 last_seen_at）
    this.client.disconnect()
    this.client.connect()
  }

  /** 连接成功后的同步信息确认弹窗 */
  private showConfirmSyncModal(vault?: string): void {
    if (!vault) {
      // 服务端没返回 vault 名（旧版服务端）：直接按旧流程同步
      this.settings.authorizedVault = undefined
      void this.syncNow()
      return
    }
    const hint = this.pendingVaultHint
    const mismatch = hint !== '' && hint !== vault
    // 推一帧再开 modal：深链授权流里刚 openPluginSettings 切到设置页，
    // 同帧 new Modal 会被 Obsidian 静默吞掉；nextTick 后正常挂载
    window.setTimeout(() => {
      new ConfirmSyncModal(
        this,
        {
          serverUrl: this.settings.serverUrl,
          vault,
          // 只有设置页「连接」填的 hint 才是用户期望的名字，弹窗展示有意义；
          // 深链授权的 hint 就是服务端回传的 vault，再展示一次纯重复
          vaultHint: this.hintFromUser ? hint : '',
          token: this.settings.token ?? '',
          mismatch,
        },
        async () => {
          // 确认同步：记录授权 vault 并开始全量对账
          this.logger.info('connect', `用户确认同步到「${vault}」${mismatch ? '（名称不匹配仍确认）' : ''}`)
          this.settings.authorizedVault = vault
          await this.saveSettings()
          this.updateStatusBar('authed')
          this.rerenderSettings()
          void this.syncNow()
        },
        () => {
          // 取消：断开连接，不记录授权
          this.logger.info('connect', `用户取消同步（远程 vault=「${vault}」）`)
          this.client.disconnect()
          this.updateStatusBar('disconnected')
          this.rerenderSettings()
          new Notice('Owiki: 已取消，未开始同步')
        },
      ).open()
    }, 0)
  }

  /** 设置页「连接」时填写的期望 vault 名（核对用） */
  private pendingVaultHint = ''
  /**
   * 待确认连接：从设置页发起的连接先认证拿 vault 名，
   * 用户在确认弹窗里点「确认同步」之前不启动同步。
   */
  private pendingConfirm = false

  /** 直接打开设置面板并定位到本插件 */
  private openPluginSettings(): void {
    const setting = (this.app as unknown as {
      setting: { open(): void; openTabById(id: string): unknown }
    }).setting
    setting.open()
    setting.openTabById('owiki-sync') // manifest.json 的 id
  }

  /** 设置页开着的时候重绘它（授权状态变化时立即反映） */
  private rerenderSettings(): void {
    // 打开中的本插件设置 tab 会挂在自己的 containerEl 上；
    // display() 重新渲染整个面板内容
    if (this.settingTab && this.settingTab.containerEl?.isShown()) {
      this.settingTab.display()
    }
  }
}

/** 连接成功后的同步确认弹窗：展示服务器 + Token + 实际 vault，名称不匹配时高亮警告 */
class ConfirmSyncModal extends Modal {
  private info: {
    serverUrl: string
    vault: string
    vaultHint: string
    token: string
    mismatch: boolean
  }
  private onConfirm: () => void | Promise<void>
  private onCancel: () => void
  private decided = false

  constructor(
    plugin: OwikiSyncPlugin,
    info: ConfirmSyncModal['info'],
    onConfirm: ConfirmSyncModal['onConfirm'],
    onCancel: ConfirmSyncModal['onCancel'],
  ) {
    super(plugin.app)
    this.info = info
    this.onConfirm = onConfirm
    this.onCancel = onCancel
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h3', { text: '确认同步信息' })

    const list = contentEl.createEl('dl', { cls: 'owiki-confirm-list' })
    this.addRow(list, '服务器', this.info.serverUrl)
    this.addRow(list, '远程 vault', this.info.vault)
    if (this.info.vaultHint) {
      this.addRow(list, '你填写的名称', this.info.vaultHint)
    }
    if (this.info.token) {
      this.addSecretRow(list, 'Token', this.info.token)
    }

    if (this.info.mismatch) {
      const warn = contentEl.createDiv({ cls: 'owiki-callout owiki-callout-warning' })
      warn.createDiv({
        cls: 'owiki-callout-title',
        text: 'vault 名称不匹配',
      })
      warn.createDiv({
        cls: 'owiki-callout-body',
        text: `你填写的名称是「${this.info.vaultHint}」，但这个 Token 实际对应「${this.info.vault}」。请核对是否连对了库，确认后将同步到「${this.info.vault}」。`,
      })
    } else {
      contentEl.createEl('p', {
        cls: 'owiki-confirm-hint',
        text: `确认后将把当前 vault 与远程「${this.info.vault}」进行全量对账同步（双向）。`,
      })
    }

    const btns = contentEl.createDiv({ cls: 'owiki-confirm-buttons' })
    const cancelBtn = btns.createEl('button', { text: '取消' })
    cancelBtn.addEventListener('click', () => {
      this.decided = true
      this.close()
      this.onCancel()
    })
    const okBtn = btns.createEl('button', {
      text: '确认同步',
      cls: 'mod-cta',
    })
    okBtn.addEventListener('click', () => {
      this.decided = true
      this.close()
      void this.onConfirm()
    })
  }

  private addRow(list: HTMLElement, k: string, v: string): void {
    list.createEl('dt', { text: k })
    list.createEl('dd', { text: v })
  }

  /** Token 行：默认打码，点按切换明文（防止截图/演示时泄露） */
  private addSecretRow(list: HTMLElement, k: string, token: string): void {
    list.createEl('dt', { text: k })
    const dd = list.createEl('dd', { cls: 'owiki-confirm-secret' })
    let revealed = false
    const render = () => {
      dd.empty()
      dd.createSpan({ text: revealed ? token : `${token.slice(0, 7)}••••••` })
      const eye = dd.createEl('button', { cls: 'owiki-eye-btn' })
      setIcon(eye, revealed ? 'eye-off' : 'eye')
      eye.addEventListener('click', () => {
        revealed = !revealed
        render()
      })
    }
    render()
  }

  onClose(): void {
    // ESC / 点遮罩关闭 = 取消（没做选择就关掉，视为不同步）
    if (!this.decided) {
      this.onCancel()
    }
    this.contentEl.empty()
  }
}
