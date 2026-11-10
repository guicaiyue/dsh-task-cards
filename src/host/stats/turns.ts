// 真实会话回合数：从 DSH 会话日志数 `turn/end`，排除插件内部会话（card-dec-*/card-obs-*）。
//
// 日志是 zstd 压缩的 v4 JSONL（Node 22.15+ 自带 zstd）；没有压缩的旧目录也兼容。

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import type { Log } from '../host-api'

export interface SessionTurns {
  sessionId: string
  turns: number
}

const INTERNAL = /^card-(dec|obs)-/

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * 会话日志是多帧 zstd（每行 append 一帧），Node 的 zstdDecompressSync 只解第一帧。
 * 按 magic 切帧逐帧解压后拼接；非压缩文件（旧格式 JSONL）原样返回。
 */
function readLog(file: string): string {
  const raw = readFileSync(file)
  const starts: number[] = []
  let at = raw.indexOf(ZSTD_MAGIC)
  if (at < 0) return raw.toString('utf8')
  while (at >= 0) {
    starts.push(at)
    at = raw.indexOf(ZSTD_MAGIC, at + 4)
  }
  const chunks: string[] = []
  for (let i = 0; i < starts.length; i += 1) {
    const slice = raw.subarray(starts[i], starts[i + 1] ?? raw.length)
    try {
      chunks.push(zstdDecompressSync(slice).toString('utf8'))
    } catch {
      /* 单帧坏掉就跳过，不影响其余行 */
    }
  }
  return chunks.join('')
}

/** 扫 sessions 目录下的 session-* 子目录，返回每个真实会话的回合数。 */
export function countSessionTurns(
  dshHome: string,
  log?: Log,
): { sessions: SessionTurns[]; turns: number } {
  const sessions: SessionTurns[] = []
  const root = path.join(dshHome, 'sessions')
  let projects: string[] = []
  try {
    projects = readdirSync(root)
  } catch {
    return { sessions: [], turns: 0 }
  }
  for (const project of projects) {
    const projectDir = path.join(root, project)
    let entries: string[] = []
    try {
      entries = readdirSync(projectDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.startsWith('session-') || INTERNAL.test(entry)) continue
      const dir = path.join(projectDir, entry)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }
      let text = ''
      try {
        text = readLog(path.join(dir, 'session.v4.jsonl.zstd'))
      } catch (err) {
        try {
          text = readLog(path.join(dir, 'session.v4.jsonl'))
        } catch {
          log?.(`会话日志读取失败：${entry}（${(err as Error)?.message || String(err)}）`)
          continue
        }
      }
      let turns = 0
      for (const line of text.split('\n')) if (line.includes('"turn/end"')) turns += 1
      sessions.push({ sessionId: entry, turns })
    }
  }
  return { sessions, turns: sessions.reduce((sum, item) => sum + item.turns, 0) }
}
