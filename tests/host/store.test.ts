import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { Store, StoreError } from '../../src/host/cards/store'

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
