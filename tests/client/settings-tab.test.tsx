// 设置屏：六组渲染、改字段后只提交改过的键、pause=decisionEnabled=false、危险区二次确认、busy 禁用。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsTab } from '../../src/client/components/SettingsTab'
import { DICT } from '../../src/client/locale'
import type { Settings } from '../../src/client/types'

const zh = DICT.zh as Record<string, string>

function translate(key: string, vars?: Record<string, string | number>): string {
  const template = zh[key] ?? key
  return vars
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match))
    : template
}

const BASE: Settings = {
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
  autoDecide: true,
  fallbackObserve: true,
  receiptTimeoutMs: 180000,
  turnGate: 'high-risk',
}

function renderTab(
  options: { settings?: Settings | null; busy?: boolean; onSave?: ReturnType<typeof vi.fn> } = {},
) {
  const onSave = options.onSave ?? vi.fn(async () => {})
  render(
    <SettingsTab
      t={translate}
      settings={options.settings === undefined ? BASE : options.settings}
      models={null}
      busy={options.busy ?? false}
      onSave={onSave as (next: Settings) => Promise<void>}
    />,
  )
  return onSave
}

afterEach(cleanup)

describe('设置屏', () => {
  it('设置还没读到时显示加载', () => {
    renderTab({ settings: null })
    expect(screen.getByText(zh.loading as string)).toBeTruthy()
  })

  it('渲染六组与危险区，保留与隐私是只读固定策略', () => {
    renderTab()
    for (const key of [
      'setGroupMaster',
      'setGroupDecision',
      'setGroupExec',
      'setGroupBudget',
      'setGroupPrivacy',
      'setGroupNotify',
      'setDanger',
    ]) {
      expect(screen.getByText(zh[key] as string)).toBeTruthy()
    }
    // 四条固定策略 + 三条通知规则都是静态说明，没有对应输入框
    expect(screen.getByText(zh.setPrivacyRecords as string)).toBeTruthy()
    expect(screen.getByText(zh.setNotifyMajor as string)).toBeTruthy()
  })

  it('改一个字段点保存：onSave 收到改后的完整 Settings，其它键保持原值', async () => {
    const onSave = renderTab()
    fireEvent.change(screen.getByLabelText(zh.minReplyChars as string), {
      target: { value: '400' },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.save as string }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({ ...BASE, minReplyChars: 400 })
  })

  it('「暂停（只建卡不批）」勾上即 decisionEnabled=false', async () => {
    const onSave = renderTab()
    fireEvent.click(screen.getByLabelText(zh.setPauseDecision as string))
    fireEvent.click(screen.getByRole('button', { name: zh.save as string }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({ ...BASE, decisionEnabled: false })
  })

  it('危险区要点两次：先出现「确认停用」，确认后才停用观察者', async () => {
    const onSave = renderTab()
    fireEvent.click(screen.getByRole('button', { name: zh.setDisableObserver as string }))
    expect(screen.queryByText(zh.setConfirmDisable as string)).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh.setConfirmDisable as string }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ ...BASE, enabled: false }))
  })

  it('busy 时保存按钮禁用', () => {
    renderTab({ busy: true })
    expect(screen.getByRole('button', { name: zh.saving as string })).toHaveProperty(
      'disabled',
      true,
    )
  })
})
