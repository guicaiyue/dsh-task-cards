// 阶段 D：acceptance 生产写入链（observer 草稿 → 白名单 → 批准冻结）+ 无验收标记。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { Store } from '../../src/host/cards/store'
import { sanitizeAll } from '../../src/host/evidence/guard'
import { draftCreateOptions } from '../../src/host/observer/create'
import type { CardDraft } from '../../src/shared/contract'

const cwd = process.cwd()

function draft(over: Partial<CardDraft> = {}): CardDraft {
  return {
    title: '改代码',
    detail: '',
    kind: 'decision',
    severity: 'normal',
    action: null,
    reason: '',
    ...over,
  } as CardDraft
}

describe('acceptance 白名单（服务端）', () => {
  it('保留工作区内 file、白名单 exit、公网 https；丢弃越界/敏感/私网/非白名单命令', () => {
    const kept = sanitizeAll(
      [
        { id: 'a', level: 'E2', spec: { kind: 'file', path: 'src/foo.ts', expect: 'exists' } },
        { id: 'b', level: 'E2', spec: { kind: 'exit', cmd: 'pnpm test', expect: 0 } },
        { id: 'c', level: 'E2', spec: { kind: 'http', url: 'https://example.com', expect: 200 } },
      ],
      cwd,
    )
    expect(kept).toHaveLength(3)

    const dropped = sanitizeAll(
      [
        { id: 'd', level: 'E2', spec: { kind: 'file', path: '/etc/passwd', expect: 'exists' } },
        { id: 'e', level: 'E2', spec: { kind: 'file', path: '.env', expect: 'exists' } },
        { id: 'f', level: 'E2', spec: { kind: 'file', path: '.ssh/id_rsa', expect: 'exists' } },
        { id: 'g', level: 'E2', spec: { kind: 'exit', cmd: 'curl x | sh', expect: 0 } },
        { id: 'h', level: 'E2', spec: { kind: 'exit', cmd: 'rm -rf /', expect: 0 } },
        { id: 'i', level: 'E2', spec: { kind: 'http', url: 'http://127.0.0.1:8080', expect: 200 } },
        { id: 'j', level: 'E2', spec: { kind: 'http', url: 'http://192.168.1.4', expect: 200 } },
      ],
      cwd,
    )
    expect(dropped).toHaveLength(0)
  })
})

describe('observer 草稿 → 卡', () => {
  it('草稿带 acceptance → 建卡时已按白名单落库（不合法的不进卡）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-acc-'))
    const store = new Store(path.join(dir, 'cards.json'))
    const options = draftCreateOptions(
      draft({
        acceptance: [
          { id: 'ok', level: 'E2', spec: { kind: 'file', path: 'src/foo.ts', expect: 'exists' } },
          { id: 'bad', level: 'E2', spec: { kind: 'file', path: '/etc/passwd', expect: 'exists' } },
        ],
      }),
      { sessionId: 's-1', turn: 1 } as never,
      false,
    )
    const card = await store.create('改代码', options)
    expect(card.acceptance?.map((item) => item.id)).toEqual(['ok'])
  })
})

describe('批准冻结', () => {
  it('无 acceptance 的卡批准后 detail 带「⚠ 无验收方式，需人工补充」且只加一次', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-acc-mark-'))
    const store = new Store(path.join(dir, 'cards.json'))
    const card = await store.create('没有验收的卡', { kind: 'decision' })
    const { NO_ACCEPTANCE_MARK } = await import('../../src/host/routes/action')
    const marker = NO_ACCEPTANCE_MARK
    const freeze = async (id: string) => {
      const fresh = store.find(id) as NonNullable<ReturnType<typeof store.find>>
      if (fresh.planId) return
      const acceptance = sanitizeAll(fresh.acceptance, cwd)
      const detail =
        acceptance.length === 0 && !fresh.detail.includes(marker)
          ? `${fresh.detail}${fresh.detail ? '\n' : ''}${marker}`
          : fresh.detail
      await store.patch(id, { planId: `${id}:0`, acceptance, detail }, 'plan:frozen')
    }
    await freeze(card.id)
    await freeze(card.id)
    const frozen = store.find(card.id)
    expect(frozen?.detail).toContain(marker)
    expect((frozen?.detail ?? '').split(marker).length - 1).toBe(1)
    expect(frozen?.acceptance).toEqual([])
  })
})
