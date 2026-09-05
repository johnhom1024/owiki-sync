// 全量对账决策：从 hashlist_response 算出该传 / 该拉 / 该清掉的本地孤儿。
// 抽成纯函数是为了单测覆盖「rename 留下的旧路径不要当新文件上传」。

import type { HashListDiff } from './protocol'

export type { HashListDiff }

export interface LocalSyncState {
  /** 当前本地内容哈希 */
  hash: string
  /** 上次与服务端达成共识的哈希；没有 = 从未成功同步过 */
  syncedHash?: string
}

export interface ReconcilePlan {
  uploads: string[]
  downloads: string[]
  /** 服务端已无此路径、本地也没改过 → 删本地，避免 rename 留下的旧文件被回传 */
  localDeletes: string[]
}

/**
 * 对账计划。
 *
 * 服务端对「客户端有、服务端没有」一律下发 upload。对 rename 留下的旧路径
 * 这是错的：旧文件内容没变，再传回去会把服务端刚完成的改名撤销。
 * 判定「本地孤儿」：曾经同步过（有 syncedHash）且内容没改（hash === syncedHash）。
 * 从未同步 / 本地改过的路径仍走 upload，避免误伤离线新建或未推送的编辑。
 */
export function planReconcile(
  diffs: HashListDiff[],
  local: Map<string, LocalSyncState>,
  conflicted: Set<string> = new Set(),
): ReconcilePlan {
  const uploads: string[] = []
  const downloads: string[] = []
  const localDeletes: string[] = []

  for (const d of diffs) {
    if (d.path.endsWith('.conflict.md')) continue
    if (d.action === 'download') {
      downloads.push(d.path)
      continue
    }
    if (conflicted.has(d.path)) continue
    const entry = local.get(d.path)
    if (entry && entry.syncedHash && entry.hash === entry.syncedHash) {
      localDeletes.push(d.path)
      continue
    }
    uploads.push(d.path)
  }

  return { uploads, downloads, localDeletes }
}
