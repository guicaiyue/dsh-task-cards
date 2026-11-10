// 三个检查器：exit / file / http，以及证据账的读写。

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runCheck } from '../../src/host/evidence/checkers'
import { EvidenceStore } from '../../src/host/evidence/store'
import type { CheckSpec } from '../../src/shared/evidence'

let server: http.Server
let base = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200)
      res.end('ok')
      return
    }
    res.writeHead(500)
    res.end('boom')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('检查器', () => {
  it('exit：0 与期望一致，非 0 按期望判', async () => {
    const ok = await runCheck({ kind: 'exit', cmd: 'node -e "process.exit(0)"', expect: 0 })
    expect(ok.ok).toBe(true)
    expect(ok.detail).toContain('exit=0')

    const mismatch = await runCheck({
      kind: 'exit',
      cmd: 'node -e "process.exit(3)"',
      expect: 1,
    })
    expect(mismatch.ok).toBe(false)
    expect(mismatch.detail).toContain('exit=3')
  })

  it('file：存在、缺失、期望相反三种情况', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-ev-'))
    const file = path.join(dir, 'test.log')
    fs.writeFileSync(file, 'Tests 2 failed', 'utf8')

    const exists = await runCheck({ kind: 'file', path: file, expect: 'exists' })
    expect(exists.ok).toBe(true)
    expect(exists.sha256).toMatch(/^[a-f0-9]{64}$/)

    const absent = await runCheck({ kind: 'file', path: path.join(dir, 'nope'), expect: 'absent' })
    expect(absent.ok).toBe(true)

    const wrong = await runCheck({ kind: 'file', path: file, expect: 'absent' })
    expect(wrong.ok).toBe(false)
  })

  it('http：200 / 500 / 内网默认拒绝', async () => {
    const ok = await runCheck(
      { kind: 'http', url: `${base}/ok`, expect: 200 },
      { allowPrivate: true },
    )
    expect(ok.ok).toBe(true)
    expect(ok.detail).toContain('HTTP 200')

    const bad = await runCheck(
      { kind: 'http', url: `${base}/bad`, expect: 200 },
      { allowPrivate: true },
    )
    expect(bad.ok).toBe(false)

    const ssrf = await runCheck({ kind: 'http', url: `${base}/ok`, expect: 200 })
    expect(ssrf.ok).toBe(false)
    expect(ssrf.error).toContain('内网')
  })
})

describe('证据账', () => {
  it('落账后可读回，坏行跳过', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-evstore-'))
    const store = new EvidenceStore({ dir, now: () => 1_700_000_000_000 })
    const records = await store.check('c-1', [
      { kind: 'file', path: __filename, expect: 'exists' } as CheckSpec,
    ])
    expect(records).toHaveLength(1)
    expect(records[0]?.caseId).toBe('c-1')
    expect(records[0]?.ok).toBe(true)

    fs.appendFileSync(path.join(dir, 'c-1.jsonl'), 'not-json\n', 'utf8')
    const read = await store.read('c-1')
    expect(read.records).toHaveLength(1)
    expect(read.badLines).toBe(1)
  })
})
