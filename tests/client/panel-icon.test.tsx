// 侧栏图标：有未读知晓卡时画圆点，没有就不画。
// 图标自己轻量轮询 /cards——面板没打开时用户也要能看到「有新的」。

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PanelIcon } from '../../src/client/components/PanelIcon'

function reply(cards: unknown[]): Response {
  return new Response(JSON.stringify({ ok: true, cards }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function info(status: string): Record<string, unknown> {
  return {
    id: `c-${status}`,
    title: '一点通知',
    kind: 'info',
    status,
    createdAt: Date.now(),
    events: [],
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('侧栏图标', () => {
  it('有未读知晓卡时画未读圆点', async () => {
    const fetchMock = vi.fn(async () => reply([info('open')]))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<PanelIcon />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('.dtc-unread-dot')).toBeTruthy())
  })

  it('没有未读时不画圆点', async () => {
    const fetchMock = vi.fn(async () => reply([info('acknowledged')]))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<PanelIcon />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.querySelector('.dtc-unread-dot')).toBeNull()
  })
})
