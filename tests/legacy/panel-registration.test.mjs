// 旧客户端模块（assets/panel.js）的离线注册校验：P3 换成 src/client 后删除。
// 不渲染 React，只跑注册路径，所以 require('react') 换成桩。

import { expect, test } from 'vitest'

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
  if (name !== 'react') throw new Error(`unexpected require: ${name}`)
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

await import('../../assets/panel.js')

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
  expect(loaded.id).toBe('dsh-task-cards')
})

test('注册出侧栏入口与主面板，且 id 对得上', () => {
  loaded.module.apply(ctx)
  const sidebar = slots.find((slot) => slot.spec.name === 'sidebar.panellist')
  const main = slots.find((slot) => slot.spec.name === 'main')
  expect(sidebar && main, '两个插槽都要注册').toBeTruthy()
  expect(sidebar.spec.id).toBe(main.spec.key)
  expect(sidebar.spec.id).toBe('task-cards')
  expect(typeof sidebar.component).toBe('function')
  expect(typeof main.component).toBe('function')
  expect(typeof sidebar.spec.label()).toBe('string')
})

test('样式以插件标记注入，卸载可摘掉', () => {
  expect(styles.length).toBe(1)
  expect(styles[0].dataset.plugin).toBe('dsh-task-cards')
  expect(styles[0].textContent).toContain('.dtc-page')
})

test('字典的每个值都是字符串，插值只用占位符', () => {
  const entry = captured.dicts.find((item) => item.ns === 'dsh-task-cards')
  expect(entry, '必须注册文案目录').toBeTruthy()
  for (const [locale, dict] of Object.entries(entry.dict)) {
    for (const [key, value] of Object.entries(dict)) {
      expect(typeof value, `${locale}.${key} 必须是字符串`).toBe('string')
    }
  }
  const template = entry.dict.zh.dueAt
  expect(template).toContain('{time}')
  expect(template.replace(/\{(\w+)\}/g, (_m, name) => (name === 'time' ? '12:00' : _m))).toBe(
    '计划 12:00',
  )
})
