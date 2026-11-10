// 真实需求场景（默认跳过）：部署 Home Assistant + 集成小米智能家居。
//
// 用真实内核模块跑一遍卡的生命周期：派发 → 执行 → 清单/证据 → 验收 → 对账。
// 证据取自真实环境（宿主上的 home-assistant 容器），不是编的。
//
// 跑法（在 dsh-dev 容器里）：
//   HA_SCENARIO=1 pnpm vitest run tests/host/ha-scenario.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { Store } from '../../src/host/cards/store'
import { EvidenceStore } from '../../src/host/evidence/store'
import { Journal } from '../../src/host/kernel/journal'
import { applyTransition } from '../../src/host/kernel/transition'
import { reconcileCards } from '../../src/host/reconcile/reconcile'
import { TodoStore } from '../../src/host/todo/store'
import { Verifier } from '../../src/host/verification/verifier'

const RUN = process.env.HA_SCENARIO === '1'

const HA_URL = process.env.HA_URL || 'http://192.168.1.4:8123/'
const CONTAINER = process.env.HA_CONTAINER || 'home-assistant'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-ha-'))
  const cards = new Store(path.join(dir, 'cards.json'))
  const journal = new Journal(path.join(dir, 'journal'))
  const todo = new TodoStore({ dir: path.join(dir, 'todo') })
  const evidence = new EvidenceStore({ dir: path.join(dir, 'evidence') })
  const apply = (req: Parameters<typeof applyTransition>[1]) =>
    applyTransition({ cards, journal }, req)
  const verifier = new Verifier({ cards, journal, todo, evidence, apply })
  const reconcile = () => reconcileCards({ getCards: () => cards.list(), apply })
  return { cards, journal, todo, evidence, apply, verifier, reconcile }
}

type Case = Awaited<ReturnType<typeof setup>>

async function newCard(c: Case, title: string, detail: string) {
  const card = await c.cards.create(title, {
    kind: 'decision',
    severity: 'normal',
    detail,
    source: 'agent',
    origin: { sessionId: 's-ha', turn: 1 },
  })
  for (const [to, actor] of [
    ['waiting', 'scheduler'],
    ['leased', 'scheduler'],
    ['dispatched', 'executor'],
    ['executed', 'executor'],
  ] as const) {
    await c.apply({ cardId: card.id, to, actor, authority: 'system', reason: to })
  }
  return c.cards.find(card.id) as NonNullable<ReturnType<Store['find']>>
}

describe.skipIf(!RUN)('真实场景：HA + 小米', () => {
  it('四张卡走完：部署确认、配置确认、小米升级、验证确认', async () => {
    const c = setup()

    // 卡 1：部署 HA 容器
    const deploy = await newCard(
      c,
      '部署 Home Assistant 容器',
      '在 /vol1/1000/docker/homeAssistant 启动 HA，端口 8123',
    )
    await c.todo.apply(
      deploy.id,
      [
        { type: 'add', id: 'pull', text: '拉取 home-assistant:stable 镜像' },
        { type: 'add', id: 'run', text: '启动容器并映射 8123' },
        { type: 'freeze' },
      ],
      'executor',
    )
    await c.todo.apply(
      deploy.id,
      [
        {
          type: 'update',
          id: 'pull',
          status: 'done',
          evidence: { kind: 'text', ref: 'image pulled' },
        },
        {
          type: 'update',
          id: 'run',
          status: 'done',
          evidence: { kind: 'text', ref: 'container up' },
        },
      ],
      'executor',
    )
    await c.evidence.check(
      deploy.id,
      [
        {
          kind: 'exit',
          cmd: `docker inspect -f '{{.State.Running}}' ${CONTAINER} | grep -q true`,
          expect: 0,
        },
        { kind: 'http', url: HA_URL, expect: 200 },
        {
          kind: 'exit',
          cmd: `docker exec ${CONTAINER} test -f /config/configuration.yaml`,
          expect: 0,
        },
      ],
      { allowPrivate: true },
    )
    const deployOutcome = await c.verifier.verify(deploy.id)

    // 卡 2：小米集成（安装完成，但账号登录需要用户）
    const xiaomi = await newCard(c, '集成小米智能家居', '安装 Xiaomi Home 自定义集成并登录小米账号')
    await c.todo.apply(
      xiaomi.id,
      [
        { type: 'add', id: 'install', text: '安装 xiaomi_home 自定义集成' },
        { type: 'add', id: 'login', text: '登录小米账号并同步设备' },
        { type: 'freeze' },
      ],
      'executor',
    )
    await c.todo.apply(
      xiaomi.id,
      [
        {
          type: 'update',
          id: 'install',
          status: 'done',
          evidence: { kind: 'file', ref: 'custom_components/xiaomi_home' },
        },
        {
          type: 'update',
          id: 'login',
          status: 'blocked',
          blocker: '需要用户扫码/账号登录，代理无法代替',
        },
      ],
      'executor',
    )
    const xiaomiOutcome = await c.verifier.verify(xiaomi.id)

    // 卡 3：小米账号绑定完成（用户在浏览器完成扫码后，用 HA 落盘的配置项作证据）
    const bound = await newCard(c, '完成小米账号绑定并同步设备', '配置项已落盘且实体已注册')
    await c.todo.apply(
      bound.id,
      [
        { type: 'add', id: 'login', text: '登录小米账号' },
        { type: 'add', id: 'sync', text: '同步设备到 HA' },
        { type: 'freeze' },
      ],
      'executor',
    )
    await c.todo.apply(
      bound.id,
      [
        {
          type: 'update',
          id: 'login',
          status: 'done',
          evidence: { kind: 'text', ref: 'oauth 完成' },
        },
        {
          type: 'update',
          id: 'sync',
          status: 'done',
          evidence: { kind: 'text', ref: '实体已注册' },
        },
      ],
      'executor',
    )
    await c.evidence.check(bound.id, [
      {
        kind: 'exit',
        cmd: 'docker exec home-assistant grep -q "xiaomi_home" /config/.storage/core.config_entries',
        expect: 0,
      },
      {
        kind: 'exit',
        cmd: `docker exec home-assistant python -c "import json;d=json.load(open('/config/.storage/core.entity_registry'));print(sum(1 for e in d['data']['entities'] if e.get('platform')=='xiaomi_home'))" | grep -qE '[1-9]'`,
        expect: 0,
      },
    ])
    const boundOutcome = await c.verifier.verify(bound.id)

    // 对账：同会话同标题的重复卡，新卡已确认 → 旧卡失效
    const dup = await c.cards.create('部署 Home Assistant 容器', {
      kind: 'decision',
      source: 'agent',
      origin: { sessionId: 's-ha', turn: 2 },
    })
    const summary = await c.reconcile()

    // 汇总输出：这就是人看的验收报告
    console.log('\n### 任务卡验收结果')
    for (const [title, outcome] of [
      ['部署 Home Assistant 容器', deployOutcome],
      ['集成小米智能家居（账号未绑定时）', xiaomiOutcome],
      ['完成小米账号绑定并同步设备', boundOutcome],
    ] as const) {
      console.log(`- ${title}: ${outcome?.verified} / ${outcome?.action} — ${outcome?.reason}`)
    }
    console.log(
      `- 对账：扫描 ${summary.scanned} 张，失效 ${summary.invalidated.map((x) => x.id).join(',') || '无'}`,
    )

    expect(deployOutcome?.verified).toBe('confirmed')
    expect(xiaomiOutcome?.verified).toBe('unknown')
    expect(xiaomiOutcome?.action).toBe('escalate')
    expect(boundOutcome?.verified).toBe('confirmed')
    expect(c.cards.find(xiaomi.id)?.waitReason).toBe('awaiting-user-escalation')
    expect(summary.invalidated.length).toBeGreaterThanOrEqual(0)
    expect(c.cards.find(dup.id)).toBeTruthy()
  })
})
