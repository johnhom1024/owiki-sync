// OwikiSyncClient —— WebSocket 连接管理：认证、心跳、指数退避重连、消息收发
//
// 重连设计（v2 修复版）：
// - 任何非主动断开（onclose/onerror/认证失败除外）都走 scheduleReconnect
// - 单一 connect() 入口：清理旧实例再建新连接，防重复连接
// - 认证成功（welcome.ok）回调 onAuthed，上层据此触发补对账
// - 单设备同步：welcome.syncEnabled=false 或收到 sync_state(enabled=false)
//   时进入「观察态」——连接保持（心跳/授权正常），但不发送任何同步消息
import { ServerMessage } from './protocol'

export type ConnState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authed'
  | 'observing' // 已认证，但非单设备同步的选定设备：连接正常，文件同步被服务端拒绝

interface Handlers {
  onState: (state: ConnState) => void
  onMessage: (msg: ServerMessage) => void
  /** 认证成功（含重连后）触发——上层应做补对账；vault 为服务端返回的 vault 名 */
  onAuthed: (vault?: string, syncEnabled?: boolean) => void
  /** 认证失败（token 无效，如被服务端取消授权）触发 */
  onAuthFailed?: (message?: string) => void
  /** 同步资格变化（服务端 sync_state 推送）：在线静默 ↔ 在线同步切换 */
  onSyncEnabledChanged?: (enabled: boolean, message?: string) => void
}

const PONG_TIMEOUT_MS = 45_000 // 超过此时长没收到任何服务端消息，判定连接已死

export class OwikiSyncClient {
  private ws: WebSocket | null = null
  private url = ''
  private token = ''
  private deviceId = ''
  private deviceName = ''
  private clientVersion = ''
  private handlers: Handlers
  private state: ConnState = 'disconnected'
  private retry = 0
  private closedByUs = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private lastRecvAt = 0
  private deadCheckTimer: ReturnType<typeof setInterval> | null = null
  private pending: string[] = []
  /** 认证成功后服务端告知的 vault 名称 */
  private authedVault?: string
  /** 认证成功后服务端告知的服务端版本（来自 welcome.serverVersion），设置页展示用 */
  private authedServerVersion?: string
  /** 当前连接的文件同步资格（单设备同步模式下非 pin 设备为 false）；undefined=老服务端未告知，视为 true */
  private syncEnabledFlag: boolean | undefined

  constructor(handlers: Handlers) {
    this.handlers = handlers
  }

  configure(
    url: string,
    token: string,
    deviceId = '',
    deviceName = '',
    clientVersion = '',
  ): void {
    // 配置变化时强制重连：断开旧连接让 connect() 建立新认证会话
    const changed = url !== this.url || token !== this.token
    this.url = url
    this.token = token
    this.deviceId = deviceId
    this.deviceName = deviceName
    this.clientVersion = clientVersion
    if (changed && this.ws) {
      this.disconnect()
      this.closedByUs = false // 配置变更不算主动关闭，允许随后 connect()
    }
  }

  /**
   * 强制重新建立连接（即便 url/token 没变）：用于「点连接 / 一键授权」等需要
   * 重新走一次认证回合的场景，配置变化时 configure 会自动断，但 url/token
   * 重复时（已连着再点连接、深链复用旧配置）要靠这个主动断。
   */
  forceReconnect(): void {
    if (this.ws) {
      this.disconnect()
      this.closedByUs = false
    }
    this.connect()
  }

  connect(): void {
    if (!this.url) return
    // 已在连接/认证/观察态就不重复连
    if (this.ws && (this.state === 'connected' || this.state === 'authed' || this.state === 'observing')) return

    this.cleanupTimers()
    this.teardownWs() // 清掉可能残留的半开连接
    this.closedByUs = false
    this.setState('connecting')

    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch (e) {
      console.error('[owiki] ws construct failed:', e)
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    this.lastRecvAt = Date.now()

    ws.onopen = () => {
      if (this.ws !== ws) return // 已被替换的旧实例
      this.setState('connected')
      this.retry = 0
      this.rawSend(
        JSON.stringify({
          type: 'hello',
          token: this.token,
          deviceId: this.deviceId,
          deviceName: this.deviceName,
          clientVersion: this.clientVersion,
        }),
      )
      for (const m of this.pending.splice(0)) this.rawSend(m)
      this.startDeadCheck()
    }

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      this.lastRecvAt = Date.now()
      let msg: ServerMessage
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage
      } catch {
        console.error('[owiki] invalid json:', ev.data)
        return
      }
      if (msg.type === 'welcome') {
        if (msg.ok) {
          this.authedVault = msg.vault
          this.authedServerVersion = msg.serverVersion
          this.syncEnabledFlag = msg.syncEnabled
          // 观察态：已认证但非同步设备。仍算「已连接」（心跳/授权正常），
          // 但状态机进入 observing，UI 与发送侧据此静默
          this.setState(msg.syncEnabled === false ? 'observing' : 'authed')
          this.handlers.onAuthed(msg.vault, msg.syncEnabled)
        } else {
          console.error('[owiki] auth failed:', msg.message)
          this.authedVault = undefined
          this.authedServerVersion = undefined
          this.syncEnabledFlag = undefined
          this.handlers.onAuthFailed?.(msg.message)
          // token 错误：重连也没用，停下等用户改配置
          this.disconnect()
        }
        return
      }
      if (msg.type === 'sync_state') {
        // 单设备同步开关/pin 切换：在线切换同步资格，连接不断
        this.syncEnabledFlag = msg.syncEnabled
        this.setState(msg.syncEnabled ? 'authed' : 'observing')
        this.handlers.onSyncEnabledChanged?.(msg.syncEnabled, msg.message)
        return
      }
      if (msg.type === 'ping') {
        this.rawSend(JSON.stringify({ type: 'pong' }))
        return
      }
      this.handlers.onMessage(msg)
    }

    // 关键修复：onclose 统一兜底——无论是网络断、服务端重启、握手失败，
    // 浏览器最终都会触发 onclose，在这里统一调度重连
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.stopDeadCheck()
      if (this.closedByUs) {
        this.setState('disconnected')
        return
      }
      this.setState('disconnected')
      this.scheduleReconnect()
    }

    ws.onerror = () => {
      // 不在这里重连：onerror 后必然跟随 onclose，统一走 onclose 兜底
    }
  }

  disconnect(): void {
    this.closedByUs = true
    this.cleanupTimers()
    this.teardownWs()
    this.setState('disconnected')
  }

  /**
   * 主动断开并解绑设备：先发 bye 让服务端删除设备记录（Web 端变未授权），
   * 收到 ok 或超时后断开。bye 只应在「断开并取消授权」时用。
   */
  async disconnectWithBye(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.deviceId) {
      this.rawSend(JSON.stringify({ type: 'bye', deviceId: this.deviceId }))
      // 等 ok（或 1s 超时）再断，尽量让 bye 到达服务端
      await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    }
    this.disconnect()
  }

  send(msg: string): void {
    // 观察态拦截：单设备同步模式下本设备未被选中，同步消息会被服务端
    // 拒绝——直接不发（省流量，也避免服务端日志被无谓的 BLOCKED 刷屏）
    if (this.state === 'observing') {
      const type = this.msgType(msg)
      if (type === 'hashlist' || type === 'upload' || type === 'fetch' || type === 'rename' || type === 'delete') {
        console.debug('[owiki] observing mode, skip', type)
        return
      }
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.rawSend(msg)
    } else if (this.pending.length < 256) {
      this.pending.push(msg)
    }
  }

  /** 快速取 JSON 消息的 type 字段（观察态拦截用；解析失败返回空串） */
  private msgType(msg: string): string {
    const i = msg.indexOf('"type":"')
    if (i === -1) return ''
    const start = i + 8
    const end = msg.indexOf('"', start)
    return end === -1 ? '' : msg.slice(start, end)
  }

  get connected(): boolean {
    // 观察态连接是活的（心跳/授权正常），只是不同步文件——
    // 对上层「是否已连接服务器」的语义应返回 true
    return this.state === 'authed' || this.state === 'observing'
  }

  /** 当前连接状态原始值（设置页状态卡展示用：区分连接中/已连接/认证/观察中等） */
  get connState(): ConnState {
    return this.state
  }

  /** 当前连接的文件同步资格（老服务端未告知时为 true：老服务端没有单设备拦截） */
  get syncEnabled(): boolean {
    return this.syncEnabledFlag !== false
  }

  /** 认证成功后服务端告知的 vault 名（未认证为 undefined） */
  get vaultName(): string | undefined {
    return this.authedVault
  }

  /** 认证成功后服务端告知的服务端版本（未认证或老服务端未带 serverVersion 时为 undefined） */
  get serverVersion(): string | undefined {
    return this.authedServerVersion
  }

  // ---------- 内部 ----------

  /** 死连接检测：PONG_TIMEOUT 内没收到任何消息（含 ping）就强断重建 */
  private startDeadCheck(): void {
    this.stopDeadCheck()
    this.deadCheckTimer = setInterval(() => {
      if (Date.now() - this.lastRecvAt > PONG_TIMEOUT_MS) {
        console.warn('[owiki] connection dead (no traffic), forcing reconnect')
        // 不等 onclose 了，直接重置：teardown 会触发 onclose → scheduleReconnect
        this.closedByUs = false
        this.teardownWs()
        this.setState('disconnected')
        this.scheduleReconnect()
      }
    }, 10_000)
  }

  private stopDeadCheck(): void {
    if (this.deadCheckTimer) {
      clearInterval(this.deadCheckTimer)
      this.deadCheckTimer = null
    }
  }

  private rawSend(data: string): void {
    try {
      this.ws?.send(data)
    } catch (e) {
      console.error('[owiki] send failed:', e)
    }
  }

  private setState(s: ConnState): void {
    if (this.state === s) return
    this.state = s
    this.handlers.onState(s)
  }

  private scheduleReconnect(): void {
    if (this.closedByUs || !this.url) return
    if (this.reconnectTimer) return // 已有重连在排队
    const delay = Math.min(1000 * 2 ** this.retry, 30_000)
    this.retry++
    console.log(`[owiki] reconnect in ${delay}ms (retry #${this.retry})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private cleanupTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopDeadCheck()
  }

  /** 摘除当前 ws 的事件并关闭（防旧实例回调污染新连接） */
  private teardownWs(): void {
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onclose = null
      ws.onerror = null
      try {
        ws.close()
      } catch {
        // already closed
      }
    }
  }
}
