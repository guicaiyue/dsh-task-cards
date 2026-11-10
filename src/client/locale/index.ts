// 词典按语言组织：宿主按当前语言挑一套，键不齐时退回中文。
//
// 分屏词典（failure / settings）在这里合并，避免多屏同时改一个文件。

import { en } from './en'
import { mergeDict } from './extras'
import { FAILURE_DICT } from './failure'
import { SETTINGS_DICT } from './settings'
import { WORKBENCH_DICT } from './workbench'
import { zh } from './zh'

const EXTRAS = [WORKBENCH_DICT, FAILURE_DICT, SETTINGS_DICT]

export const DICT: Record<string, Record<string, string>> = {
  zh: mergeDict(zh, EXTRAS, 'zh'),
  en: mergeDict(en, EXTRAS, 'en'),
}
