// i18n helpers：语言跟随 Obsidian 界面语言（getLanguage），缺键回退英文。
// 结构与 obsidian-spaced-repetition / obsidian-kanban 同构：
//   locale/en.ts 为基准（全量），其他语言 Partial 回退。
import { getLanguage } from 'obsidian'
import en, { type Lang } from './locale/en'
import zh from './locale/zh'

const localeMap: Record<string, Partial<Lang>> = {
  en,
  zh,
}

/** 解析当前应使用的字典：zh* → zh，其余 → en（基准回退） */
function currentDict(): Partial<Lang> {
  const lang = getLanguage() // ISO code，如 'zh' / 'zh-TW' / 'en'
  if (lang && lang.toLowerCase().startsWith('zh')) return localeMap['zh']
  return localeMap['en']
}

/**
 * 取文案。params 里的 {name} 占位符会被替换。
 * 用法：t('statusConnectedVault', { vault: '个人笔记' })
 */
export function t(key: keyof Lang, params?: Record<string, string | number | boolean>): string {
  const dict = currentDict()
  let s = dict[key] ?? en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v))
    }
  }
  return s
}

export type { Lang }
