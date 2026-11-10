import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { PRECEDENTS_FILE, PrecedentStore } from '../../src/host/cards/store'

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-precedent-'))
  return path.join(dir, 'precedents.json')
}

describe('判例存储', () => {
  it('默认落点在 $DSH_HOME/dsh-task-cards/precedents.json', () => {
    expect(PRECEDENTS_FILE.endsWith(path.join('dsh-task-cards', 'precedents.json'))).toBe(true)
  })

  it('新建 → 落盘 → 新实例还能读到，且默认字段齐全', async () => {
    const file = tempFile()
    const store = new PrecedentStore(file)
    const entry = await store.add({
      cardId: 'c-1',
      title: '要不要把登录页重做',
      question: '现状能跑但结构乱',
      choice: '先跑通最小验证',
      keywords: ['登录', '重做'],
    })

    expect(entry.id.startsWith('P-')).toBe(true)
    expect(entry.outcome).toBe('unknown')
    expect(entry.note).toBe('')
    expect(entry.at).toBeTypeOf('number')

    const reopened = new PrecedentStore(file)
    expect(reopened.list()).toHaveLength(1)
    expect(reopened.list()[0]?.choice).toBe('先跑通最小验证')
  })

  it('列表倒序（最新在前），limit 生效', async () => {
    const store = new PrecedentStore(tempFile())
    await store.add({ title: '第一条', choice: '批了' })
    await store.add({ title: '第二条', choice: '不批，忽略' })
    await store.add({ title: '第三条', choice: '先跑通' })

    const all = store.list()
    expect(all.map((row) => row.title)).toEqual(['第三条', '第二条', '第一条'])
    expect(store.list(2).map((row) => row.title)).toEqual(['第三条', '第二条'])
    expect(store.list(0)).toEqual([])
  })

  it('latestForCard 取该卡最近一条', async () => {
    const store = new PrecedentStore(tempFile())
    const first = await store.add({ cardId: 'c-9', choice: '先跑通' })
    await store.add({ cardId: 'c-9', choice: '后来改成直接做' })
    await store.add({ cardId: 'c-other', choice: '别的卡' })

    const latest = store.latestForCard('c-9')
    expect(latest?.choice).toBe('后来改成直接做')
    expect(latest?.id).not.toBe(first.id)
    expect(store.latestForCard('c-none')).toBeUndefined()
  })

  it('返工标记改 outcome 与 note，未知 id 报 NOT_FOUND', async () => {
    const store = new PrecedentStore(tempFile())
    const entry = await store.add({ cardId: 'c-1', choice: '先跑通', outcome: 'valid' })

    const updated = await store.update(entry.id, { outcome: 'reworked', note: '选错了方向' })
    expect(updated.outcome).toBe('reworked')
    expect(updated.note).toBe('选错了方向')
    expect(store.list()[0]?.outcome).toBe('reworked')

    await expect(store.update('P-nope', { outcome: 'valid' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('双实例交错写：旧实例 add 不会吃掉新实例刚写的判例（热重载回归）', async () => {
    const file = tempFile()
    const old = new PrecedentStore(file)
    await old.add({ title: '热重载前', choice: '批了' })
    const fresh = new PrecedentStore(file)
    await fresh.add({ title: '热重载后', choice: '不批' })
    // 旧实例的缓存只有第一条；写入必须基于磁盘最新内容
    await old.add({ title: '旧实例再加一条', choice: '先跑通' })
    const titles = new PrecedentStore(file).list().map((row) => row.title)
    expect(titles).toContain('热重载后')
    expect(titles).toContain('旧实例再加一条')
    expect(titles).toHaveLength(3)
  })

  it('上限 500 条，超出丢最旧的', async () => {
    const store = new PrecedentStore(tempFile())
    for (let i = 0; i < 505; i += 1) {
      await store.add({ title: `判例 ${i}`, choice: '批了' })
    }
    const rows = store.list()
    expect(rows).toHaveLength(500)
    expect(rows[0]?.title).toBe('判例 504')
    expect(rows.some((row) => row.title === '判例 4')).toBe(false)
  })

  it('非法 outcome 落成 unknown，keywords 去重前先截到 12 条', async () => {
    const store = new PrecedentStore(tempFile())
    const entry = await store.add({
      outcome: 'weird' as never,
      keywords: Array.from({ length: 20 }, (_, i) => `k${i}`),
    })
    expect(entry.outcome).toBe('unknown')
    expect(entry.keywords).toHaveLength(12)
  })
})
