import assert from 'node:assert/strict'
import test from 'node:test'

import { coerceCards, extractJson } from '../lib/extract.mjs'

test('整段就是 JSON', () => {
  const result = extractJson('{"cards":[{"title":"跑测试"}]}')
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, { cards: [{ title: '跑测试' }] })
})

test('包在 markdown 代码块里', () => {
  const result = extractJson('```json\n{"cards":[{"title":"补空态"}]}\n```')
  assert.equal(result.ok, true)
  assert.equal(result.via, 'fence')
  assert.equal(result.value.cards[0].title, '补空态')
})

test('前后带解释文字', () => {
  const text = '好的，我判断如下：\n{"cards":[{"title":"删掉旧表"}]}\n以上。'
  const result = extractJson(text)
  assert.equal(result.ok, true)
  assert.equal(result.via, 'bracket')
  assert.equal(result.value.cards[0].title, '删掉旧表')
})

test('字符串里的花括号不打乱扫描', () => {
  const result = extractJson('{"cards":[{"title":"把 {x} 换成 {y}","detail":"a}b"}]}')
  assert.equal(result.ok, true)
  assert.equal(result.value.cards[0].title, '把 {x} 换成 {y}')
})

test('没有 JSON 时明确失败', () => {
  const result = extractJson('这次没有需要跟进的事。')
  assert.equal(result.ok, false)
  assert.ok(result.reason.length > 0)
})

test('空输出失败而不是当成空卡', () => {
  assert.equal(extractJson('').ok, false)
  assert.equal(extractJson('   ').ok, false)
})

test('coerceCards 接受 cards 数组、单对象、裸数组', () => {
  const a = coerceCards({ cards: [{ title: 'A', detail: 'a' }] })
  assert.equal(a.ok, true)
  assert.equal(a.cards[0].title, 'A')
  assert.equal(a.cards[0].detail, 'a')
  assert.equal(a.cards[0].kind, 'info')
  assert.equal(coerceCards({ title: 'B' }).cards[0].title, 'B')
  assert.equal(coerceCards([{ name: 'C' }]).cards[0].title, 'C')
})

test('auto 卡必须带可执行动作，否则降级成 info', () => {
  const withAction = coerceCards({
    cards: [{ title: '限流重试', kind: 'auto', action: { type: 'prompt', delayMs: 600000, input: '继续' } }],
  })
  assert.equal(withAction.cards[0].kind, 'auto')
  assert.equal(withAction.cards[0].action.delayMs, 600000)

  const noAction = coerceCards({ cards: [{ title: '没有动作', kind: 'auto' }] })
  assert.equal(noAction.cards[0].kind, 'info')
  assert.equal(noAction.cards[0].action, null)
})

test('decision 卡保留 kind 与 severity', () => {
  const result = coerceCards({ cards: [{ title: '删表', kind: 'decision', severity: 'high' }] })
  assert.equal(result.cards[0].kind, 'decision')
  assert.equal(result.cards[0].severity, 'high')
})

test('coerceCards 丢掉没有标题的行，形状不对就报错', () => {
  const result = coerceCards({ cards: [{ title: '  ' }, { title: '留下' }] })
  assert.equal(result.ok, true)
  assert.equal(result.cards.length, 1)
  assert.equal(coerceCards({ foo: 1 }).ok, false)
})
