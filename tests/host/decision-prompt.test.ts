import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { DEFAULT_PROMPT } from '../../src/host/cards/defaults'
import { DECISION_PRESET_ID, DEFAULT_DECISION_PROMPT } from '../../src/host/decision/defaults'
import { registerDecisionPreset } from '../../src/host/decision/preset'
import { OBSERVER_PRESET_ID } from '../../src/host/observer/constants'
import { registerObserverPreset } from '../../src/host/observer/preset'
import { apply } from '../../src/host/observer/prompt'

interface FakeSection {
  name: string
  text: string
}

function settingsFile(content: Record<string, unknown> | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtc-prompt-'))
  const file = path.join(dir, 'settings.json')
  if (content) fs.writeFileSync(file, JSON.stringify(content), 'utf8')
  return file
}

function fakePromptCtx(): { ctx: never; sections: FakeSection[] } {
  const sections: FakeSection[] = []
  const ctx = {
    tools: {
      schemas: () => [],
      restrict: () => undefined,
    },
    systemPrompt: {
      getSectionOrder: () => 0,
      section(spec: Record<string, unknown>) {
        const read = typeof spec.text === 'function' ? (spec.text as () => string)() : spec.text
        sections.push({ name: String(spec.name), text: String(read ?? '') })
        return () => undefined
      },
    },
    effect(fn: () => (() => void) | undefined) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => undefined
    },
  }
  return { ctx: ctx as never, sections }
}

describe('提示词插件双模式', () => {
  it('observer 模式读 systemPrompt，decision 模式读 decisionPrompt，互不串台', () => {
    const file = settingsFile({
      systemPrompt: '观察者提示词：把事记成卡',
      decisionPrompt: '决策画像：先问三个月后还有没有痕迹',
    })

    const observer = fakePromptCtx()
    apply(observer.ctx, { settingsFile: file, mode: 'observer' })
    expect(observer.sections).toHaveLength(1)
    expect(observer.sections[0]?.name).toBe('task-cards:observer-prompt')
    expect(observer.sections[0]?.text).toContain('观察者提示词：把事记成卡')

    const decision = fakePromptCtx()
    apply(decision.ctx, { settingsFile: file, mode: 'decision' })
    expect(decision.sections[0]?.name).toBe('task-cards:decision-prompt')
    expect(decision.sections[0]?.text).toContain('决策画像：先问三个月后还有没有痕迹')
  })

  it('decision 模式不读 systemPrompt；decisionPrompt 为空时用默认画像', () => {
    const file = settingsFile({ systemPrompt: '观察者提示词' })
    const decision = fakePromptCtx()
    apply(decision.ctx, { settingsFile: file, mode: 'decision' })
    expect(decision.sections[0]?.text).toBe(DEFAULT_DECISION_PROMPT)
    expect(decision.sections[0]?.text).not.toBe('观察者提示词')

    const blank = settingsFile({ decisionPrompt: '   ' })
    const fallback = fakePromptCtx()
    apply(fallback.ctx, { settingsFile: blank, mode: 'decision' })
    expect(fallback.sections[0]?.text).toBe(DEFAULT_DECISION_PROMPT)
  })

  it('不带 mode 时按观察者处理；设置读不到用内置提示词兜底', () => {
    const observer = fakePromptCtx()
    apply(observer.ctx, { settingsFile: settingsFile(null) })
    expect(observer.sections[0]?.name).toBe('task-cards:observer-prompt')
    expect(observer.sections[0]?.text).toBe(DEFAULT_PROMPT)
  })
})

describe('两个 preset 各自注册', () => {
  it('观察者与决策代理人 preset id 不同，决策那个带 mode=decision', async () => {
    const registered: Array<Record<string, unknown>> = []
    const ctx = {
      agentPresets: {
        async register(definition: Record<string, unknown>) {
          registered.push(definition)
          return () => undefined
        },
      },
    }
    const log = () => {}

    await registerObserverPreset(ctx as never, log)
    await registerDecisionPreset(ctx as never, log)

    expect(registered.map((item) => item.id)).toEqual([OBSERVER_PRESET_ID, DECISION_PRESET_ID])
    expect(pluginsOf(registered, 0)).toHaveLength(1)
    expect(pluginsOf(registered, 1)).toHaveLength(1)
    // 两个 preset 都只挂提示词，不挂 tool。
    expect(configOf(registered, 0).mode).toBeUndefined()
    expect(configOf(registered, 1).mode).toBe('decision')
    expect(String(pluginOf(registered, 1).name ?? '')).toContain('observer-prompt.js?v=')
    expect(String(pluginOf(registered, 0).id)).toBe('task-cards-observer-prompt')
    expect(String(pluginOf(registered, 1).id)).toBe('task-cards-decision-prompt')
  })
})

function pluginsOf(registered: Array<Record<string, unknown>>, index: number): unknown[] {
  const definition = registered[index] ?? {}
  return Array.isArray(definition.plugins) ? definition.plugins : []
}

function pluginOf(
  registered: Array<Record<string, unknown>>,
  index: number,
): Record<string, unknown> {
  const plugin = pluginsOf(registered, index)[0]
  return plugin && typeof plugin === 'object' ? (plugin as Record<string, unknown>) : {}
}

function configOf(
  registered: Array<Record<string, unknown>>,
  index: number,
): Record<string, unknown> {
  const config = pluginOf(registered, index).config
  return config && typeof config === 'object' ? (config as Record<string, unknown>) : {}
}
