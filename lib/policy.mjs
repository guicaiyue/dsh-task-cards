// 工具 / 技能的统一白名单：一份 policy.json 管所有角色，改文件即生效。
//
// 角色（role）目前三个：
//   observer —— 观察者会话：默认不给任何工具、任何技能（只读别人的回复写卡）。
//   worker   —— 卡片派发出去的会话（还没实现，先占位）。
//   default  —— 其它会话：不干预，全部放行。
//
// 白名单里写工具名（如 "read_file"），写 "*" 表示全放行。

import fs from 'node:fs'
import path from 'node:path'

export const POLICY_FILE = path.join(
  process.env.DSH_HOME || path.join(process.env.HOME || '.', '.dsh'),
  'dsh-task-cards',
  'policy.json',
)

export const DEFAULT_POLICY = {
  version: 1,
  roles: {
    observer: { tools: [], skills: [] },
    worker: { tools: ['*'], skills: ['*'] },
    default: { tools: ['*'], skills: ['*'] },
  },
}

export function readPolicy(file = POLICY_FILE) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const roles = { ...DEFAULT_POLICY.roles, ...(raw && raw.roles ? raw.roles : {}) }
    for (const [name, rule] of Object.entries(roles)) {
      roles[name] = {
        tools: Array.isArray(rule && rule.tools) ? rule.tools.map(String) : [],
        skills: Array.isArray(rule && rule.skills) ? rule.skills.map(String) : [],
      }
    }
    return { version: raw.version || 1, roles }
  } catch (err) {
    return { ...DEFAULT_POLICY, roles: { ...DEFAULT_POLICY.roles } }
  }
}

export function writePolicy(policy, file = POLICY_FILE) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(policy, null, 2))
  fs.renameSync(tmp, file)
  return readPolicy(file)
}

/** 某个角色该放行的工具名；`*` 表示全放行（返回 null）。 */
export function allowedTools(policy, role) {
  const rule = (policy.roles && policy.roles[role]) || { tools: [], skills: [] }
  if (!rule.tools.length || rule.tools.includes('*')) return rule.tools.includes('*') ? null : []
  return rule.tools
}

/** 某个角色该放行的技能名；`*` 表示全放行（返回 null）。 */
export function allowedSkills(policy, role) {
  const rule = (policy.roles && policy.roles[role]) || { tools: [], skills: [] }
  if (!rule.skills.length || rule.skills.includes('*')) return rule.skills.includes('*') ? null : []
  return rule.skills
}
