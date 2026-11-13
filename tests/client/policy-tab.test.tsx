// 策略与验收模板屏：内置模板 / 三层判定 / 阈值表单的受控输入与保存回传。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PolicyTab } from '../../src/client/components/PolicyTab'
import { DICT } from '../../src/client/locale'
import type { Settings } from '../../src/client/types'

const zh = DICT.zh as Record<string, string>

function translate(key: string, vars?: Record<string, string | number>): string {
  const template = zh[key] ?? key
  return vars
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match))
    : template
}

const settings: Settings = {
  enabled: true,
  systemPrompt: '',
  provider: '',
  model: '',
  minReplyChars: 120,
  includeSubagents: false,
  maxInputBytes: 16000,
  timeoutMs: 60000,
  decisionEnabled: true,
  decisionPrompt: '',
  decisionProvider: '',
  decisionModel: '',
  decisionPrecedentLimit: 30,
  decisionAutoApply: true,
  autoApproveDiagnostics: false,
  askTimeoutAction: 'off',
  askAutoContinue: true,
  askTimeoutMinutes: 10,
  autonomyMode: 'auto',
  observerMode: 'exception-only',
  autoDecide: true,
  fallbackObserve: true,
  receiptTimeoutMs: 180000,
  turnGate: 'high-risk',
}

afterEach(cleanup)

describe('策略与验收模板屏', () => {
  it('左列给三种内置检查器与三层判定', () => {
    render(<PolicyTab t={translate} settings={settings} busy={false} onSave={vi.fn()} />)
    expect(screen.getByText(zh.policyTemplatesTitle as string)).toBeTruthy()
    // M1 三检查器：exit / file / http
    expect(screen.getByText('exit')).toBeTruthy()
    expect(screen.getByText('file')).toBeTruthy()
    expect(screen.getByText('http')).toBeTruthy()
    expect(screen.getByText(zh.policyTplExitName as string)).toBeTruthy()
    expect(screen.getByText(zh.policyTplFileName as string)).toBeTruthy()
    expect(screen.getByText(zh.policyTplHttpName as string)).toBeTruthy()
    // 每块都写清超时 10s 记 unknown
    expect(screen.getAllByText(zh.policyTplTimeout as string)).toHaveLength(3)
    // 三层判定
    expect(screen.getByText(zh.policyLayersTitle as string)).toBeTruthy()
    expect(screen.getByText('confirmed')).toBeTruthy()
    expect(screen.getByText('failed')).toBeTruthy()
    expect(screen.getByText('unknown')).toBeTruthy()
    expect(screen.getByText(zh.policyLayerUnknownText as string)).toBeTruthy()
  })

  it('settings 为 null 时显示加载态', () => {
    render(<PolicyTab t={translate} settings={null} busy={false} onSave={vi.fn()} />)
    expect(screen.getByText(zh.loading as string)).toBeTruthy()
  })

  it('改阈值后保存，回传的 Settings 只合并改动', async () => {
    const onSave = vi.fn(async () => {})
    render(<PolicyTab t={translate} settings={settings} busy={false} onSave={onSave} />)
    const timeout = screen.getByLabelText(zh.policyFieldTimeout as string)
    fireEvent.change(timeout, { target: { value: '90000' } })
    const precedent = screen.getByLabelText(zh.policyFieldPrecedent as string)
    fireEvent.change(precedent, { target: { value: '12' } })
    fireEvent.click(screen.getByText(zh.save as string))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({
      ...settings,
      timeoutMs: 90000,
      decisionPrecedentLimit: 12,
    })
  })

  it('开关改动也会随保存回传', async () => {
    const onSave = vi.fn(async () => {})
    render(<PolicyTab t={translate} settings={settings} busy={false} onSave={onSave} />)
    fireEvent.click(screen.getByLabelText(new RegExp(zh.policyFieldDiagnostics as string)))
    fireEvent.click(screen.getByText(zh.save as string))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({ ...settings, autoApproveDiagnostics: true })
  })

  it('busy 时保存按钮禁用', () => {
    render(<PolicyTab t={translate} settings={settings} busy onSave={vi.fn()} />)
    const button = screen.getByRole('button', { name: zh.saving as string })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})
