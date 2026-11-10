import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { RecordStore, Store, StoreError } from '../../src/host/cards/store'

function tempFile(name = 'cards.json'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-store-'))
  return path.join(dir, name)
}

describe('卡片存储', () => {
  it('新建 → 落盘 → 新实例还能读到', async () => {
    const file = tempFile()
    const store = new Store(file)
    const card = await store.create('  登录页空态要补  ')

    expect(card.title).toBe('登录页空态要补')
    expect(card.status).toBe('open')
    expect(card.kind).toBe('info')
    expect(card.events.map((e) => e.type)).toEqual(['created'])

    const reopened = new Store(file)
    expect(reopened.list()).toHaveLength(1)
    expect(reopened.list()[0]?.id).toBe(card.id)
  })

  it('免打扰卡落盘即已读，并留一条 silent 事件', async () => {
    const store = new Store(tempFile())
    const card = await store.create('已经看过的结果', { kind: 'info', silent: true })

    expect(card.status).toBe('acknowledged')
    expect(card.silent).toBe(true)
    expect(card.events.map((e) => `${e.type}/${e.via ?? ''}`)).toEqual([
      'created/human',
      'acknowledged/silent',
    ])
  })

  it('带 action 的卡不会被 silent 改成已读：它到点还要执行', async () => {
    const store = new Store(tempFile())
    const card = await store.create('限流重试', {
      kind: 'auto',
      silent: true,
      action: { type: 'retry', delayMs: 1000, input: '继续' },
    })

    expect(card.status).toBe('scheduled')
    expect(card.silent).toBe(false)
  })

  it('完成与恢复都会追加事件', async () => {
    const store = new Store(tempFile())
    const card = await store.create('跑一次测试')

    const done = await store.setState(card.id, 'done')
    expect(done.status).toBe('done')
    expect(done.events.map((e) => e.type)).toEqual(['created', 'completed'])

    const back = await store.setState(card.id, 'todo')
    expect(back.status).toBe('open')
    expect(back.events.map((e) => e.type)).toEqual(['created', 'completed', 'reopened'])
  })

  it('删除后不再出现在列表里', async () => {
    const store = new Store(tempFile())
    const card = await store.create('临时的一件事')
    await store.remove(card.id)
    expect(store.list()).toHaveLength(0)
  })

  it('空标题与超长标题被拒', async () => {
    const store = new Store(tempFile())
    await expect(store.create('   ')).rejects.toMatchObject({ code: 'EMPTY_TITLE' })
    await expect(store.create('a'.repeat(201))).rejects.toMatchObject({ code: 'TITLE_TOO_LONG' })
    await expect(async () => {
      await store.create('   ')
    }).rejects.toBeInstanceOf(StoreError)
  })

  it('不存在的 id 与未知状态被拒', async () => {
    const store = new Store(tempFile())
    await expect(store.setState('nope', 'done')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(store.setState('nope', 'weird')).rejects.toMatchObject({ code: 'BAD_STATE' })
  })

  it('坏文件被挪走，不阻塞开工，且留下 warning', () => {
    const file = tempFile()
    fs.writeFileSync(file, '{ 这不是 json', 'utf8')
    const store = new Store(file)
    expect(store.list()).toEqual([])
    expect(store.warning).toBeTruthy()
    expect(store.warning).toContain('无法解析')
    expect(
      fs.readdirSync(path.dirname(file)).some((name) => name.startsWith('cards.json.bad-')),
    ).toBe(true)
  })

  it('双实例交错写：旧实例 patch 不会吃掉新实例刚建的卡（热重载回归）', async () => {
    const file = tempFile()
    const old = new Store(file)
    const first = await old.create('热重载前建的卡')
    const fresh = new Store(file)
    const second = await fresh.create('热重载后建的卡')
    // 旧实例还持有热重载前的缓存；它的 patch 必须基于磁盘最新内容
    await old.patch(first.id, { status: 'done' }, 'completed')
    const ids = new Store(file).list().map((card) => card.id)
    expect(ids).toContain(first.id)
    expect(ids).toContain(second.id)
    expect(ids).toHaveLength(2)
  })

  it('双实例同时并发创建：15 + 15 条全部落盘（同进程 per-file 锁）', async () => {
    const file = tempFile()
    const a = new Store(file)
    const b = new Store(file)
    await Promise.all([
      ...Array.from({ length: 15 }, (_, i) => a.create(`A-${i}`)),
      ...Array.from({ length: 15 }, (_, i) => b.create(`B-${i}`)),
    ])
    expect(new Store(file).list()).toHaveLength(30)
  })

  it('双实例并发 patch 同一条卡：不丢卡、不丢条目', async () => {
    const file = tempFile()
    const a = new Store(file)
    const card = await a.create('并发改的卡')
    const b = new Store(file)
    await Promise.all([
      ...Array.from({ length: 25 }, (_, i) =>
        a.patch(card.id, { severity: i % 2 ? 'high' : 'low' }, `a-${i}`),
      ),
      ...Array.from({ length: 25 }, (_, i) =>
        b.patch(card.id, { severity: i % 2 ? 'low' : 'high' }, `b-${i}`),
      ),
    ])
    const list = new Store(file).list()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(card.id)
  })

  it('并发 50 次 patch 后条目数不变', async () => {
    const file = tempFile()
    const store = new Store(file)
    const card = await store.create('会被并发改的卡')
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        store.patch(card.id, { severity: i % 2 ? 'high' : 'low' }, `tick-${i}`),
      ),
    )
    expect(new Store(file).list()).toHaveLength(1)
  })

  it('并发写入不丢卡', async () => {
    const store = new Store(tempFile())
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.create(`卡 ${i}`)))
    expect(new Store(store.file).list()).toHaveLength(20)
  })

  it('auto 卡带动作时状态是 scheduled，并按 delayMs 排期', async () => {
    const store = new Store(tempFile())
    const card = await store.create('限流重试', {
      kind: 'auto',
      action: { type: 'prompt', delayMs: 600000, input: '继续' },
      origin: { sessionId: 'session-a' },
    })
    expect(card.status).toBe('scheduled')
    expect(card.dueAt).toBeTypeOf('number')
    expect(card.action?.input).toBe('继续')
  })
})

describe('记录存储', () => {
  it('追加前重读磁盘：别的实例刚写的条目不会被整份覆盖', async () => {
    const file = tempFile('records.json')
    const records = new RecordStore(file)
    await records.add({ phase: 'observer', status: 'ok' } as never)

    // 模拟热重载后另一个实例写入的新条目
    fs.writeFileSync(
      file,
      JSON.stringify([
        { id: 'r-external', at: 1, phase: 'observer', status: 'ok', external: true },
      ]),
      'utf8',
    )

    await records.add({ phase: 'observer', status: 'ok' } as never)
    const list = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<Record<string, unknown>>
    expect(list.some((item) => item.external === true)).toBe(true)
    expect(list).toHaveLength(2)
  })
})
