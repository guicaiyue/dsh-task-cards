// 面板 CSS 的唯一出口：顺序有意义（变量与基础类在前，各屏覆盖在后）。

import { BASE_CSS } from './base'
import { CASE_CSS } from './case'
import { DETAIL_CSS } from './detail'
import { FAILURE_CSS } from './failure'
import { RECORDS_CSS } from './records'
import { SETTINGS_CSS } from './settings'
import { WORKBENCH_CSS } from './workbench'

export const PANEL_CSS = [
  BASE_CSS,
  WORKBENCH_CSS,
  DETAIL_CSS,
  CASE_CSS,
  RECORDS_CSS,
  FAILURE_CSS,
  SETTINGS_CSS,
].join('\n')
