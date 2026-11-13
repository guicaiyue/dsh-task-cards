#!/usr/bin/env node
/**
 * 度量快照：把当前账本里的「省不省力 / 漏没漏 / 人出手几次」定格成一份 JSON + 一行历史。
 *
 *   node scripts/snapshot-metrics.mjs                  # 读 $DSH_HOME/dsh-task-cards（默认 /data/dsh）
 *   DTC_DATA=/tmp/dtc node scripts/snapshot-metrics.mjs
 *   node scripts/snapshot-metrics.mjs --print-only     # 只打印，不写文件
 *
 * 为什么要有它：口径散在 /stats、cards.json、asks.json 三处，跨版本比较时容易各说各话。
 * 这里固定一份可 diff 的快照，改完插件前后各拍一张就能看出是变好还是变坏。
 */
import fs from 'node:fs'
import path from 'node:path'

const DATA =
  process.env.DTC_DATA ?? path.join(process.env.DSH_HOME ?? '/data/dsh', 'dsh-task-cards')
const printOnly = process.argv.includes('--print-only')
const HUMAN = new Set(['answered', 'approved', 'denied', 'dismissed'])

const readJson = (name, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'))
  } catch {
    return fallback
  }
}

const cardsRaw = readJson('cards.json', [])
const cards = Array.isArray(cardsRaw) ? cardsRaw : (cardsRaw.cards ?? [])
const asks = readJson('asks.json', {}).asks ?? []
const gate = readJson('gate-stats.json', {})
const plans = readJson('plans.json', {}).plans ?? []

const answered = asks.filter((ask) => ask.answeredAt !== undefined)
const auto = answered.filter((ask) => ask.autoContinued).length
const humanAsks = answered.length - auto
const humanActions = cards.reduce(
  (sum, card) => sum + (card.events ?? []).filter((e) => HUMAN.has(e.type)).length,
  0,
)
const closed = cards.filter((card) => card.status !== 'open')
const zeroAction = closed.filter(
  (card) => !(card.events ?? []).some((e) => HUMAN.has(e.type)),
).length

const ratio = (part, total) => (total > 0 ? Number((part / total).toFixed(3)) : null)

const snapshot = {
  at: new Date().toISOString(),
  dataDir: DATA,
  cards: {
    total: cards.length,
    open: cards.filter((card) => card.status === 'open').length,
    byKind: cards.reduce((acc, card) => {
      acc[card.kind] = (acc[card.kind] ?? 0) + 1
      return acc
    }, {}),
    humanActions,
    /** 收尾了却没人动过：只是记录，不是「事情」。 */
    zeroAction,
    zeroActionRate: ratio(zeroAction, cards.length),
    /** 真正把会话卡住的提问。 */
    blockingQuestions: cards.filter((card) => card.interaction === 'question').length,
  },
  asks: {
    total: asks.length,
    human: humanAsks,
    auto,
    open: asks.length - answered.length,
    /** 越高说明这些提问越没必要。 */
    autoRate: ratio(auto, asks.length),
  },
  silence: {
    denied: gate.denied ?? 0,
    askCreated: gate.askCreated ?? 0,
    askDeduped: gate.askDeduped ?? 0,
    askFailed: gate.askFailed ?? 0,
    unaccounted: Math.max(
      0,
      (gate.denied ?? 0) -
        ((gate.askCreated ?? 0) + (gate.askDeduped ?? 0) + (gate.askFailed ?? 0)),
    ),
  },
  plans: {
    total: plans.length,
    open: plans.filter((p) => !p.cancelled && p.state !== 'done').length,
  },
}

const line = [
  snapshot.at.slice(0, 10),
  `卡 ${snapshot.cards.total}（open ${snapshot.cards.open}）`,
  `人出手 ${humanActions}`,
  `zeroAction ${snapshot.cards.zeroActionRate ?? '—'}`,
  `ask ${snapshot.asks.total}（人 ${humanAsks} / 默认 ${auto}，autoRate ${snapshot.asks.autoRate ?? '—'}）`,
  `静默 ${snapshot.silence.unaccounted}`,
].join(' ｜ ')

console.log(JSON.stringify(snapshot, null, 2))
console.log(`\n${line}`)

if (printOnly) process.exit(0)

const dir = path.join(process.cwd(), 'docs/metrics')
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(
  path.join(dir, `${snapshot.at.slice(0, 10)}.json`),
  `${JSON.stringify(snapshot, null, 2)}\n`,
)

// 一天一条：同一天重跑就替换当天那行，历史才读得下去。
const history = path.join(dir, 'history.md')
const HEAD =
  '# 度量快照历史\n\n每行由 `node scripts/snapshot-metrics.mjs` 生成；同一天重跑替换当天那行。\n\n'
const today = snapshot.at.slice(0, 10)
const kept = fs.existsSync(history)
  ? fs
      .readFileSync(history, 'utf8')
      .split('\n')
      .filter((row) => row.startsWith('- ') && !row.startsWith(`- ${today} `))
  : []
fs.writeFileSync(history, `${HEAD}${[...kept, `- ${line}`].join('\n')}\n`)
console.log(`已写入 docs/metrics/${snapshot.at.slice(0, 10)}.json 与 history.md`)
