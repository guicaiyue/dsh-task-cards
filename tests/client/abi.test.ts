// 构建产物的 ABI 测试：宿主只认「__ModuleLoader__ + id 等于包名 + factory(require)」，
// 这里按宿主的加载方式真跑一次 lib/client.js，而不是只对源码跑。

import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'

const nodeRequire = createRequire(import.meta.url)

interface Loaded {
  id: string
  factory: (require: (name: string) => unknown) => unknown
}

let loaded: Loaded | null = null
let module_: { inject?: string[]; apply?: (ctx: unknown) => void } | null = null

interface SlotSpec {
  name: string
  id?: string
  key?: string
  order?: number
  locale?: string
  label?: () => string
}

interface Captured {
  slots: Array<{ spec: SlotSpec; component: unknown }>
  dicts: Array<{ ns: string; dict: Record<string, Record<string, string>> }>
  disposers: Array<() => void>
}

function harness(): { ctx: unknown; captured: Captured } {
  const captured: Captured = { slots: [], dicts: [], disposers: [] }
  const ctx = {
    effect(fn: () => (() => void) | undefined) {
      const dispose = fn()
      if (typeof dispose === 'function') captured.disposers.push(dispose)
    },
    locale: {
      register(ns: string, dict: Record<string, Record<string, string>>) {
        captured.dicts.push({ ns, dict })
        return () => {}
      },
      bind: () => (key: string) => key,
    },
    slots: {
      inject(_name: string, run: () => void) {
        run()
      },
      register(spec: SlotSpec, component: unknown) {
        captured.slots.push({ spec, component })
        return () => {}
      },
    },
    uiWorkspace: { openSession: () => {} },
  }
  return { ctx, captured }
}

describe('客户端 bundle 的宿主 ABI', () => {
  beforeAll(async () => {
    // 先立好加载器，再让 bundle 自己跑起来：bundle 顶层就调 window.__ModuleLoader__.load
    ;(globalThis as unknown as { window: Record<string, unknown> }).window = {
      ...(globalThis as unknown as { window?: Record<string, unknown> }).window,
      __ModuleLoader__: {
        load(payload: Loaded) {
          loaded = payload
          module_ = payload.factory(nodeRequire) as typeof module_
        },
      },
    }
    // 构建产物没有 .d.ts：这里要的就是「宿主看到的那个 JS」
    // @ts-expect-error lib/client.js 是构建产物，无类型声明
    await import('../../lib/client.js')
  })

  it('id 等于包名，且 factory 返回 inject/apply', () => {
    expect(loaded?.id).toBe('dsh-task-cards')
    expect(Array.isArray(module_?.inject)).toBe(true)
    expect(module_?.inject).toEqual(['slots', 'locale', 'uiWorkspace', 'uiConversation'])
    expect(typeof module_?.apply).toBe('function')
  })

  it('注册侧栏入口与主面板，id 与 key 一致', () => {
    const { ctx, captured } = harness()
    module_?.apply?.(ctx)
    const sidebar = captured.slots.find((slot) => slot.spec.name === 'sidebar.panellist')
    const main = captured.slots.find((slot) => slot.spec.name === 'main')
    expect(sidebar, '侧栏入口必须注册').toBeTruthy()
    expect(main, '主面板必须注册').toBeTruthy()
    expect(sidebar?.spec.id).toBe('task-cards')
    expect(main?.spec.key).toBe(sidebar?.spec.id)
    expect(sidebar?.spec.order).toBe(18)
    expect(sidebar?.spec.locale).toBe('dsh-task-cards')
    expect(typeof sidebar?.spec.label?.()).toBe('string')
    expect(typeof sidebar?.component).toBe('function')
    expect(typeof main?.component).toBe('function')
  })

  it('注册中英字典，值都是字符串且占位符完整', () => {
    const { ctx, captured } = harness()
    module_?.apply?.(ctx)
    const entry = captured.dicts.find((item) => item.ns === 'dsh-task-cards')
    expect(entry).toBeTruthy()
    const locales = Object.keys(entry?.dict || {})
    expect(locales).toEqual(expect.arrayContaining(['zh', 'en']))
    for (const locale of locales) {
      for (const [key, value] of Object.entries(entry?.dict[locale] || {})) {
        expect(typeof value, `${locale}.${key}`).toBe('string')
      }
    }
    // 两套字典的键必须一致，否则切语言会掉文案
    const zhKeys = Object.keys(entry?.dict.zh || {}).sort()
    const enKeys = Object.keys(entry?.dict.en || {}).sort()
    expect(enKeys).toEqual(zhKeys)
    expect(entry?.dict.zh.dueAt).toContain('{time}')
  })

  it('挂样式表链接，且带插件标记（卸载时能精准摘掉）', () => {
    const { ctx, captured } = harness()
    module_?.apply?.(ctx)
    const tag = document.querySelector('link[data-plugin="dsh-task-cards"]')
    expect(tag, '必须挂 <link data-plugin>').toBeTruthy()
    expect(tag?.getAttribute('rel')).toBe('stylesheet')
    expect(tag?.getAttribute('href')).toBe('/dsh-task-cards/api/css')
    for (const dispose of captured.disposers) dispose()
    expect(document.querySelector('link[data-plugin="dsh-task-cards"]')).toBeNull()
  })
})
