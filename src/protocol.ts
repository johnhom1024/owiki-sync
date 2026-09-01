// owiki-sync 协议消息定义（与 owiki internal/proto/messages.go 一一对应）

export interface Hello {
  type: 'hello'
  token: string
  deviceId?: string
  deviceName?: string
  /** 插件版本（来自 manifest.json），服务端做兼容性记录用 */
  clientVersion?: string
}

export interface HashListEntry {
  path: string
  hash: string
  mtime: number
}

export interface HashList {
  type: 'hashlist'
  entries: HashListEntry[]
}

export interface Upload {
  type: 'upload'
  path: string
  hash: string
  content: string
  mtime: number
  baseHash?: string
  force?: boolean
}

export interface Fetch {
  type: 'fetch'
  path: string
}

export interface Rename {
  type: 'rename'
  from: string
  to: string
}

export interface DeleteMsg {
  type: 'delete'
  path: string
}

// ---------- 服务端 → 客户端 ----------

export interface Welcome {
  type: 'welcome'
  ok: boolean
  message?: string
  /** 认证成功的 vault 名称（服务端返回，展示用） */
  vault?: string
  serverAt: string
  /** owiki 服务端版本（编译时通过 -ldflags 注入），客户端设置页展示 */
  serverVersion?: string
  /**
   * 本连接是否具备文件同步资格（单设备同步模式下非 pin 设备为 false）。
   * false 时连接保持（授权/心跳/解绑正常），但文件同步消息会被服务端拒绝、
   * 也收不到变更广播。老服务端不带该字段 → 按具备同步资格处理（兼容）。
   */
  syncEnabled?: boolean
}

/**
 * 服务端主动推送：单设备同步开关或 pin 设备变化，本连接同步资格
 * 在线切换。enabled=true 时应补一次全量对账（静默期间没有广播可收）。
 */
export interface SyncState {
  type: 'sync_state'
  syncEnabled: boolean
  message?: string
}

export type DiffAction = 'upload' | 'download'

export interface HashListDiff {
  path: string
  action: DiffAction
}

export interface HashListResponse {
  type: 'hashlist_response'
  diffs: HashListDiff[]
}

export interface OK {
  type: 'ok'
  for: string
  path?: string
  from?: string
  to?: string
  hash?: string
  merged?: boolean
}

export interface ErrMsg {
  type: 'error'
  message: string
}

export interface Changed {
  type: 'changed'
  path: string
  hash: string
}

export interface FetchResponse {
  type: 'fetch_response'
  path: string
  hash: string
  content: string
  mtime: number
}

export interface Ping {
  type: 'ping'
}

export interface Conflict {
  type: 'conflict'
  path: string
  serverHash: string
  serverContent: string
  serverMtime: number
  mergedHint?: string
}

export interface Renamed {
  type: 'renamed'
  from: string
  to: string
}

export interface Deleted {
  type: 'deleted'
  path: string
}

export type ServerMessage =
  | Welcome
  | SyncState
  | HashListResponse
  | OK
  | ErrMsg
  | Changed
  | FetchResponse
  | Ping
  | Conflict
  | Renamed
  | Deleted
