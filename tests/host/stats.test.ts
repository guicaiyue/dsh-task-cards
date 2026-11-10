// /stats：真实回合分母（session 日志 turn/end）+ 六项 KPI 两组 + 合成标记。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { countSessionTurns } from '../../src/host/stats/turns'

function writeSession(root: string, project: string, id: string, turns: number): void {
  const dir = path.join(root, 'sessions', project, id)
  fs.mkdirSync(dir, { recursive: true })
  const lines = ['{"type":"session"}']
  for (let i = 0; i < turns; i += 1) lines.push(`{"type":"turn/end","seq":${i}}`)
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), `${lines.join('\n')}\n`, 'utf8')
}

describe('真实回合数', () => {
  it('只数 session-*，排除 card-dec-*/card-obs-*，兼容未压缩日志', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-stats-'))
    writeSession(home, '--w1--', 'session-a', 2)
    writeSession(home, '--w1--', 'session-b', 3)
    writeSession(home, '--w2--', 'session-c', 1)
    writeSession(home, '--w1--', 'card-dec-x', 9)
    writeSession(home, '--w1--', 'card-obs-y', 9)
    const out = countSessionTurns(home)
    expect(out.turns).toBe(6)
    expect(out.sessions.map((item) => item.sessionId).sort()).toEqual([
      'session-a',
      'session-b',
      'session-c',
    ])
  })
})
