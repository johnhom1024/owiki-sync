// Owiki 设备私有状态（deviceId / deviceName）的存取层。
//
// 关键设计：这些状态写在 app.loadLocalStorage/saveLocalStorage 里，
// 而非 this.saveData() —— 后者会落进 .obsidian/plugins/owiki-sync/data.json，
// 跟着 vault 被 iCloud / Dropbox / OneDrive / Syncthing 等同步，多设备会
// 共享同一个 deviceId，破坏服务端「按设备授权/区分」的语义。
//
// Obsidian 的 loadLocalStorage 存在应用自身数据目录（不在 vault 内），
// 每台设备各一份，是设备私有状态的正确归宿。
//
// 参考：haierkeys/obsidian-fast-note-sync 的 src/lib/storage/local_storage_manager.ts
//
// 额外注意：key 故意不带 vault 名后缀。iCloud 偶发会把 vault 目录改名
// （"My Vault" → "Vault 1"），若 key 拼上 vault 名，旧 key 读不到 → 值
// "看起来丢了" → 又被回写覆盖，配置永久丢失。这正是 fast-note-sync 踩过
// 的坑（见其 LocalStorageManager.getInternalKey 注释）。

import { App, Platform } from 'obsidian'

/** localStorage 键前缀：稳定、与 vault 名解耦。 */
const KEY_PREFIX = 'owiki-'

const KEY_DEVICE_ID = `${KEY_PREFIX}device-id`
const KEY_DEVICE_NAME = `${KEY_PREFIX}device-name`
/** 一次性迁移标记：完成旧 settings.deviceId 抽取后置 true，防止反复迁移。 */
const KEY_MIGRATED = `${KEY_PREFIX}device-identity-migrated-v1`

/** 设备私有状态：纯读。 */
export interface DeviceIdentity {
  deviceId: string
  deviceName: string
}

/**
 * 旧 settings.data.json 里可能残留 deviceId / deviceName 字段。
 * 用最小类型（只关心这俩字段），与新版 OwikiSettings 解耦——这样
 * 未来即便 settings 加新字段也不会污染迁移逻辑。
 */
type LegacySettings = { deviceId?: unknown; deviceName?: unknown }

/** 读：app.loadLocalStorage 不可序列化会返 null，按 string 处理。 */
function readLs(app: App, key: string): string | null {
  const v = app.loadLocalStorage(key)
  if (v == null) return null
  if (typeof v === 'string') return v
  // 防御：旧版本若误存了非 string（理论上不会发生），降级为字符串
  try {
    return JSON.stringify(v)
  } catch {
    return null
  }
}

function writeLs(app: App, key: string, value: string): void {
  app.saveLocalStorage(key, value)
}

/**
 * 推导本机平台后缀：与 fast-note-sync 思路一致，把不同形态设备的 clientName 区分开。
 * - Mac / Win / Linux：桌面
 * - iPad / iPhone：iOS 平板 vs 手机
 * - Android：统一（平板/手机合并；OWiki 当前未单独区分，后续若需要再加）
 */
function platformSuffix(): string {
  if (Platform.isDesktopApp && Platform.isMacOS) return 'Mac'
  if (Platform.isDesktopApp && Platform.isWin) return 'Win'
  if (Platform.isDesktopApp && Platform.isLinux) return 'Linux'
  if (Platform.isIosApp && Platform.isTablet) return 'iPad'
  if (Platform.isIosApp && Platform.isPhone) return 'iPhone'
  if (Platform.isAndroidApp) return 'Android'
  return ''
}

/**
 * 推导默认设备名：vault 显示名 + 平台后缀。
 * 注意只在「localStorage 里没有任何设备名」时调用——一旦本机设置过，就以本机的为准。
 */
function defaultDeviceName(vaultName: string): string {
  const platform = platformSuffix()
  // vault 名取不到时退到 host hint
  const seed = vaultName || 'Obsidian'
  return platform ? `${seed} ${platform}` : seed
}

function generateDeviceId(): string {
  // crypto.randomUUID 在 Obsidian 的 Electron / Capacitor 运行时都可用
  return crypto.randomUUID()
}

/**
 * 一次性迁移：把旧 settings.deviceId / deviceName 从 data.json 搬到 localStorage。
 * 跑过一次后写迁移标记，不再重复（防 iCloud 反复推回旧值时重复覆盖新身份）。
 *
 * 调用语义：拿不到 settings 时（首次安装无 data.json）也安全，直接跳过。
 *
 * 接受 unknown 是为了和 main.ts 的强类型 OwikiSettings 解耦——后者现在已
 * 不含 deviceId/deviceName 字段，但历史上可能从 data.json 读出残值。
 */
function migrateFromLegacySettings(app: App, settings: unknown): void {
  // 迁移标记的类型兼容：历史版本写入的是字符串 'true'，saveLocalStorage
  // 经 JSON 序列化往返后读回来仍是字符串，严格 === true 永远不成立，
  // 导致迁移每次启动重跑、把 data.json 的旧设备名反复写回 localStorage
  // （用户改的设备名重启即被回滚的根因）。宽松判断两种形态都认。
  const flag = app.loadLocalStorage(KEY_MIGRATED)
  if (flag === true || flag === 'true') return
  const legacy = (settings ?? null) as LegacySettings | null
  const legacyId =
    legacy && typeof legacy.deviceId === 'string' ? legacy.deviceId.trim() : ''
  const legacyName =
    legacy && typeof legacy.deviceName === 'string' ? legacy.deviceName.trim() : ''

  if (legacyId) {
    writeLs(app, KEY_DEVICE_ID, legacyId)
  }
  if (legacyName) {
    writeLs(app, KEY_DEVICE_NAME, legacyName)
  }
  // 标记已迁移：写到 localStorage（iCloud 不会同步），保证本机只迁一次。
  // 写字符串 'true'：saveLocalStorage 的声明签名收 string，且 JSON 往返后
  // 读回来的就是字符串——与上方宽松判断配套，不会再类型漂移
  writeLs(app, KEY_MIGRATED, 'true')
}

/**
 * 初始化设备身份：保证返回一个稳定、可用于 hello 的 (deviceId, deviceName)。
 *
 * 行为：
 * 1. 若 settings 里残留旧 deviceId/deviceName，先搬到 localStorage（一次性）
 * 2. localStorage 已有 deviceId → 沿用
 * 3. localStorage 没有 → 生成新的 UUID 写入
 * 4. deviceName：localStorage 优先，否则按 vault 名 + 平台后缀生成
 *
 * 必须保证：本函数可重入（每次调用结果一致）、副作用最小（仅写 localStorage）。
 */
export function ensureDeviceIdentity(
  app: App,
  legacySettings: unknown,
  vaultName: string,
): DeviceIdentity {
  migrateFromLegacySettings(app, legacySettings)

  // deviceId
  let deviceId = readLs(app, KEY_DEVICE_ID)
  if (!deviceId) {
    deviceId = generateDeviceId()
    writeLs(app, KEY_DEVICE_ID, deviceId)
  }

  // deviceName
  let deviceName = readLs(app, KEY_DEVICE_NAME)
  if (!deviceName) {
    deviceName = defaultDeviceName(vaultName)
    writeLs(app, KEY_DEVICE_NAME, deviceName)
  }

  return { deviceId, deviceName }
}

/** 仅更新本机设备名（设置页输入框 onChange 用）。不触发连接变更。 */
export function setDeviceName(app: App, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  writeLs(app, KEY_DEVICE_NAME, trimmed)
}

/** 仅供测试 / 设置页展示当前本机 deviceId。 */
export function getDeviceId(app: App): string | null {
  return readLs(app, KEY_DEVICE_ID)
}
