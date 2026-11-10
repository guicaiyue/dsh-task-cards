// 内核启动：迁移 → 生命周期纠正 → 调度循环 / 执行回执。
//
// 从 index.ts 抽出来，让入口只做装配；测试里由 kernel.test 直接调用迁移，
// 不走这里（避免测试清理临时目录与后台写盘互相踩）。

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { Store } from '../cards/store'
import type { Log } from '../host-api'
import type { PluginRoot } from '../observer/trigger'
import { repairLifecycleDrift } from './drift'
import { kernelEnabled } from './flags'
import { migrateCards, migrateDecisions } from './migrate'
import type { KernelRuntime } from './runtime'

export interface BootOptions {
  root: PluginRoot
  cards: Store
  kernel: KernelRuntime
  log: Log
  /** 测试用：强制跑迁移/归一化（默认在 VITEST 下跳过，避免踩真实数据目录）。 */
  migrate?: boolean
}

/**
 * 启动自检：把关键子系统的**实际状态**摊开成一行日志。
 *
 * 「函数写了但没接线」会直接表现为 plans=0 / approvalTiers=auto:0——不用等审计 grep。
 * 与闸门自检同思路：把「装配成功」变成可观测事实。
 */
function bootSelfCheck({
  cards,
  kernel,
  log,
}: Pick<BootOptions, 'cards' | 'kernel' | 'log'>): void {
  const list = cards.list()
  const decision = list.filter((card) => card.decision).length
  const tiers = kernel.approvalPolicy.read().tiers
  let migrated = 0
  const journalDir = kernel.journal.dir
  if (existsSync(journalDir)) {
    for (const entry of readdirSync(journalDir)) {
      if (!entry.endsWith('.jsonl')) continue
      const raw = readFileSync(path.join(journalDir, entry), 'utf8')
      for (const line of raw.split('\n')) {
        if (line.includes('"migration":true')) migrated += 1
      }
    }
  }
  log(
    `启动自检：cards=${list.length} decision=${decision}/${list.length} plans=${kernel.plans.list().length} ` +
      `approvalTiers=auto:${tiers.auto.length}/delegated:${tiers.delegated.length}/user:${tiers.user.length} ` +
      `traceId补=${migrated}`,
  )
}

/** 幂等启动：真实宿主进程里跑一次。 */
export function bootKernel({ root, cards, kernel, log, migrate }: BootOptions): void {
  if (migrate === true || !process.env.VITEST) {
    // 账本初始化：ensureFile 之后必须真的调 normalize()（否则空档旧文件永远不纠正）。
    Promise.all([
      kernel.plans.ensureFile(),
      kernel.approvalPolicy.ensureFile().then(() => kernel.approvalPolicy.normalize()),
    ])
      .then(([, normalized]) => {
        if (normalized) log('审批策略归一化：approval-policy.json 三档为空，已写回默认规则')
        return kernel.plans.normalize().then((fixed) => {
          if (fixed) log('计划账本归一化：补齐 verdicts/attempts 段')
        })
      })
      .catch((err: unknown) => log(`账本初始化失败：${(err as Error)?.message || String(err)}`))
    // 决定状态迁移与卡字段迁移无耦合：真实数据早就迁过 traceId，不能挂在 migrated.length 门槛里。
    void migrateDecisions({ cards })
      .then((decisions) => {
        if (decisions.filled) log(`决定状态迁移：${decisions.filled} 张旧卡补齐 decision`)
      })
      .catch((err: unknown) => log(`决定状态迁移失败：${(err as Error)?.message || String(err)}`))
    migrateCards({ cards, journal: kernel.journal })
      .then((result) => {
        if (result.migrated.length) {
          log(`内核迁移：${result.migrated.length} 张卡补齐字段（备份 ${result.backup ?? '无'}）`)
        }
      })
      .then(() => repairLifecycleDrift({ cards, log }))
      .then((fixed) => {
        if (fixed.length) log(`生命周期纠正：${fixed.length} 张卡的 status 已对齐投递状态`)
      })
      .then(() => bootSelfCheck({ cards, kernel, log }))
      .catch((err: unknown) => log(`内核迁移失败：${(err as Error)?.message || String(err)}`))
  }
  if (!kernelEnabled()) return
  const timer = setInterval(() => {
    kernel.scheduler
      .tick()
      .catch((err: unknown) => log(`调度 tick 失败：${(err as Error)?.message || String(err)}`))
  }, 2000)
  timer.unref?.()
  root.effect(() => () => clearInterval(timer), 'dsh-task-cards: scheduler')
  // 回执：派发之后等 origin 会话下一次 idle，才落 executed（并触发验收）。
  kernel.receipt
    .attach(root)
    .then((restored) => {
      if (restored) log(`执行回执：恢复 ${restored} 张在飞卡的等待`)
    })
    .catch((err: unknown) => log(`执行回执接线失败：${(err as Error)?.message || String(err)}`))
  root.effect(() => () => kernel.receipt.stop(), 'dsh-task-cards: receipt')
  log('内核调度已启用（DTC_KERNEL=on）')
}
