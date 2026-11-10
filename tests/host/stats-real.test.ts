// 真机数据校验（有 DSH_HOME 时跑）：真实回合数应从 session 日志数出来。

import { describe, expect, it } from 'vitest'

import { countSessionTurns } from '../../src/host/stats/turns'

const home = process.env.DTC_REAL_DSH_HOME

describe.skipIf(!home)('真实 DSH_HOME 回合统计', () => {
  it('排除内部会话并输出每个真实会话的回合数', () => {
    const out = countSessionTurns(home as string)
    console.log(JSON.stringify(out, null, 2))
    expect(out.turns).toBeGreaterThan(0)
    for (const session of out.sessions) expect(session.sessionId.startsWith('session-')).toBe(true)
  })
})
