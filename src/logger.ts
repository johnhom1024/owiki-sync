// OwikiLogger —— 插件运行日志：内存环形缓冲 + 落盘
// 记录连接、授权、同步操作与错误；设置页可查看最近日志、复制、清理。
import { App } from 'obsidian'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const MAX_BUFFER = 500 // 内存里最多保留 500 条（查看用）
const FLUSH_INTERVAL = 2_000 // 落盘间隔：批量写，减少 IO
const LOG_FILE = '.obsidian/plugins/owiki-sync/log.txt'

interface LogEntry {
  time: string
  level: LogLevel
  scope: string
  message: string
}

/** 展示用条目（设置页渲染）：time 已格式化，方便按 level 过滤/上色 */
export interface LogRow {
  time: string
  level: LogLevel
  scope: string
  message: string
}

export function fmtEntry(e: { time: string; level: string; scope: string; message: string }): string {
  return `${e.time} [${e.level.toUpperCase().padStart(5)}] [${e.scope}] ${e.message}`
}

function ts(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

export class OwikiLogger {
  private buffer: LogEntry[] = []
  private dirty = false
  private timer: ReturnType<typeof setInterval> | null = null
  private app: App | null = null

  /** 插件 onload 时绑定 app（写文件需要） */
  attach(app: App): void {
    this.app = app
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL)
    }
  }

  /** 插件 onunload 时调用：立刻落盘并停定时器 */
  async dispose(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.flush()
  }

  debug(scope: string, message: string): void {
    this.log('debug', scope, message)
  }

  info(scope: string, message: string): void {
    this.log('info', scope, message)
  }

  warn(scope: string, message: string): void {
    this.log('warn', scope, message)
  }

  error(scope: string, message: string): void {
    this.log('error', scope, message)
  }

  log(level: LogLevel, scope: string, message: string): void {
    const entry: LogEntry = { time: ts(), level, scope, message }
    this.buffer.push(entry)
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER)
    }
    this.dirty = true
    // error 同时打到开发者控制台，方便现场排查
    if (level === 'error') {
      console.error(`[owiki][${scope}] ${message}`)
    }
  }

  /** 最近 n 条日志文本（查看/复制用） */
  recentText(n = MAX_BUFFER): string {
    return this.buffer.slice(-n).map(fmtEntry).join('\n')
  }

  /** 最近 n 条结构化条目（设置页按 level 上色渲染用） */
  recent(n = MAX_BUFFER): LogRow[] {
    return this.buffer.slice(-n).map((e) => ({ ...e }))
  }

  /** 环形缓冲被截断的提示 */
  get truncated(): boolean {
    return false // 内存截断不影响落盘文件；文件本身的轮转在 writeLog 里做
  }

  private async flush(): Promise<void> {
    if (!this.dirty || !this.app) return
    this.dirty = false
    try {
      const adapter = this.app.vault.adapter
      const existing = (await adapter.exists(LOG_FILE))
        ? await adapter.read(LOG_FILE)
        : ''
      // 简单轮转：文件超过 ~256KB 只留后半
      let keep = existing
      if (keep.length > 256 * 1024) {
        keep = keep.slice(keep.indexOf('\n', keep.length - 256 * 1024) + 1)
      }
      // 增量：落盘后清缓冲的方式会丢并发日志，这里简单重写全量
      // （缓冲上限 500 条，全量重写开销可接受）
      await adapter.write(LOG_FILE, (keep ? keep + '\n' : '') + this.buffer.map(fmtEntry).join('\n') + '\n')
    } catch (e) {
      // 落盘失败别影响主流程
      console.error('[owiki][logger] flush failed:', e)
    }
  }

  /** 手动清空日志（文件+内存） */
  async clear(): Promise<void> {
    this.buffer = []
    this.dirty = false
    if (this.app) {
      try {
        await this.app.vault.adapter.write(LOG_FILE, '')
      } catch {
        // ignore
      }
    }
  }
}

// fmtEntry 见文件顶部导出（LogRow 与 LogEntry 结构兼容，两者共用）

