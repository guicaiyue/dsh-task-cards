// 分屏词典：每屏一个模块，中英各一份，合并进主词典。
//
// 这样每屏的文案和它自己的组件放在一起改，不用抢同一个 locale 文件。

export interface ExtraEntry {
  zh: string
  en: string
}

export type ExtraDict = Record<string, ExtraEntry>

/** 把若干分屏词典合并进主词典；同键以分屏模块为准。 */
export function mergeDict(
  base: Record<string, string>,
  extras: ExtraDict[],
  lang: 'zh' | 'en',
): Record<string, string> {
  const out = { ...base }
  for (const extra of extras) {
    for (const [key, entry] of Object.entries(extra)) out[key] = entry[lang]
  }
  return out
}
