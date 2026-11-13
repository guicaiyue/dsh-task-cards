// 账本脱敏：卡会随面板/备份/导出流动，凭据不许原样落盘。
//
// 真实事故（2026-11-11 c-mwbvil7x）：卡片正文引用了带生产库口令的连接串，
// 口令被原样写进 cards.json 与会话投影缓存。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { redactCardFields, redactSecrets } from '../../src/host/cards/redact'
import { Store } from '../../src/host/cards/store'

describe('redactSecrets', () => {
  it('连接串只打码口令，保留用户名与主机', () => {
    const out = redactSecrets('postgresql://postgres:qq823214522@postgres:5432/story_test')
    expect(out).toBe('postgresql://postgres:***@postgres:5432/story_test')
  })

  it('KEY=VALUE 形式的口令（含 POSTGRES_ 前缀）', () => {
    expect(redactSecrets('POSTGRES_PASSWORD=qq823214522')).toBe('POSTGRES_PASSWORD=***')
    expect(redactSecrets('JWT_SECRET: "abc123def456ghi"')).toBe('JWT_SECRET: "***"')
  })

  it('占位符不动：文档里写 change-me 是正常内容', () => {
    expect(redactSecrets('JWT_SECRET=change-me-to-a-long-random-string')).toBe(
      'JWT_SECRET=change-me-to-a-long-random-string',
    )
    expect(redactSecrets('password: CHANGE_ME')).toBe('password: CHANGE_ME')
  })

  it('常见密钥前缀与私钥块', () => {
    expect(redactSecrets('key is sk-abcdefghijklmnop1234 ok')).not.toContain('abcdefghijkl')
    expect(redactSecrets('ghp_abcdefghijklmnopqrstuvwxyz0123')).toBe('***')
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nAAAABBBB\n-----END RSA PRIVATE KEY-----'
    expect(redactSecrets(pem)).toBe('[已打码的私钥]')
  })

  it('普通文字不受影响，且重复调用结果不变', () => {
    const text = '把 apps/server 的测试改到 story_test，再跑一次 pnpm test'
    expect(redactSecrets(text)).toBe(text)
    const once = redactSecrets('postgresql://u:pw123456@h:5432/db')
    expect(redactSecrets(once)).toBe(once)
  })
})

describe('卡片落盘脱敏', () => {
  it('标题/详情/逐题问题里的凭据都不进 cards.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-redact-'))
    const store = new Store(path.join(dir, 'cards.json'))
    return store
      .create('改测试库连接串 postgresql://postgres:qq823214522@postgres:5432/story_test', {
        detail: 'POSTGRES_PASSWORD=qq823214522',
        interaction: 'question',
        question: {
          sessionId: 's-1',
          items: [
            {
              id: 'secret_fix',
              question: '口令是 qq823214522，怎么处理？',
              options: ['改为占位符', '照原样'],
            },
          ],
        },
      })
      .then(() => {
        const raw = fs.readFileSync(path.join(dir, 'cards.json'), 'utf8')
        expect(raw).not.toContain('qq823214522')
        const card = store.list()[0]
        expect(card?.title).toContain('postgres:***@')
        expect(card?.detail).toBe('POSTGRES_PASSWORD=***')
        expect(JSON.stringify(card?.question)).not.toContain('qq823214522')
      })
  })

  it('redactCardFields 保留题目 id 与选项顺序', () => {
    const out = redactCardFields({
      title: 't',
      question: {
        items: [
          { id: 'a', question: '口令 qq823214522?', options: ['是', '否'], multiSelect: false },
        ],
      },
    })
    const item = (out.question as { items: Array<Record<string, unknown>> }).items[0]
    expect(item?.id).toBe('a')
    expect(item?.options).toEqual(['是', '否'])
    expect(String(item?.question)).not.toContain('qq823214522')
  })
})
