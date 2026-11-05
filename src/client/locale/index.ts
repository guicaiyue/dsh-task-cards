// 词典按语言组织：宿主按当前语言挑一套，键不齐时退回中文。

import { en } from './en'
import { zh } from './zh'

export const DICT: Record<string, Record<string, string>> = { zh, en }
