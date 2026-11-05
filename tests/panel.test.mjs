// 客户端模块的离线校验：不开浏览器，确认它能注册出「侧栏入口 + 主面板 + 样式」。
//
// 不渲染 React，只跑注册路径。所以 require('react') 换成桩：
// 定义期只用到 createElement 的引用，hooks 在渲染时才调用。

import assert from 'node:assert/strict'
import test from 'node:test'

const slots = []
const styles = []
const captured = { dicts: [] }
let loaded = null

globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      loaded = { id, module: factory(fakeRequire) }
    },
  },
}

function fakeRequire(name) {
  assert.equal(name, 'react')
  return {
    createElement: (...args) => ({ args }),
    useCallback: (fn) => fn,
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: () => ({ current: null }),
    useState: (initial) => [initial, () => {}],
  }
}

globalThis.document = {
  createElement(tag) {
    return {
      tag,
      dataset: {},
      textContent: '',
      remove() {
        styles.pop()
      },
    }
  },
  head: {
    appendChild(node) {
      styles.push(node)
    },
  },
}

await import('../assets/panel.js')

const ctx = {
  effect(fn) {
    fn()
  },
  locale: {
    register(ns, dict) {
      captured.dicts.push({ ns, dict })
    },
    bind: () => (key) => key,
  },
  slots: {
    inject(_name, run) {
      run()
    },
    register(spec, component) {
      slots.push({ spec, component })
    },
  },
}

test('模块以正确的 id 注册', () => {
  assert.equal(loaded.id, 'dsh-task-cards')
})

test('注册出侧栏入口与主面板，且 id 对得上', () => {
  loaded.module.apply(ctx)
  const sidebar = slots.find((slot) => slot.spec.name === 'sidebar.panellist')
  const main = slots.find((slot) => slot.spec.name === 'main')
  assert.ok(sidebar && main, '两个插槽都要注册')
  assert.equal(sidebar.spec.id, main.spec.key, '侧栏 id 与主面板 key 必须一致')
  assert.equal(sidebar.spec.id, 'task-cards')
  assert.equal(typeof sidebar.component, 'function')
  assert.equal(typeof main.component, 'function')
  assert.equal(typeof sidebar.spec.label(), 'string')
})

test('样式以插件标记注入，卸载可摘掉', () => {
  assert.equal(styles.length, 1)
  assert.equal(styles[0].dataset.plugin, 'dsh-task-cards')
  assert.ok(styles[0].textContent.includes('.dtc-page'))
})

// 回归：宿主 locale.translate 会对模板做 String.replace。
// 字典里放函数（把 n 拼进文案）会在渲染时抛 TypeError，整块面板变空白。
test('字典的每个值都是字符串，插值只用 {n} 占位', () => {
  const entry = captured.dicts.find((item) => item.ns === 'dsh-task-cards')
  assert.ok(entry, '必须注册文案目录')
  for (const [locale, dict] of Object.entries(entry.dict)) {
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', `${locale}.${key} 必须是字符串`)
    }
  }
  // 有占位符的键必须能在 translate 里被替换掉
  const template = entry.dict.zh.dueAt
  assert.ok(template.includes('{time}'), '时间文案要用 {time} 占位')
  assert.equal(template.replace(/\{(\w+)\}/g, (_m, name) => (name === 'time' ? '12:00' : _m)), '计划 12:00')
})
