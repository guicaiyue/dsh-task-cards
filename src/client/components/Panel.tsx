// 面板主组件：只做渲染，状态与副作用都在 usePanelState 里。

import { type PanelState, usePanelState } from '../hooks/usePanelState'
import type { Translate } from '../types'
import { CardsTab } from './CardsTab'
import { DetailModal } from './DetailModal'
import { KpiRow, PanelHeader, TabBar } from './PanelHeader'
import { SettingsTab } from './SettingsTab'

interface Props {
  t: Translate
  uiWorkspace?: { openSession?: (sessionId: string) => void }
}

export function Panel({ t, uiWorkspace }: Props) {
  const state = usePanelState(uiWorkspace)
  const { tab, setTab, actions, detailApi } = state

  return (
    <div className="dtc-page">
      <PanelHeader t={t} cards={state.cards} onRefresh={actions.onRefresh} />
      <KpiRow t={t} cards={state.cards} />
      <TabBar t={t} tab={tab} onChange={setTab} />
      {state.error ? <Banner message={state.error} /> : null}
      {state.detail ? (
        <DetailModal
          t={t}
          detail={state.detail}
          precedents={state.precedents}
          busy={state.busy}
          onClose={detailApi.closeDetail}
          onOpenSession={state.openSession}
          onAction={actions.onAction}
          onAdopt={actions.onAdopt}
          onReworked={actions.onReworked}
        />
      ) : null}
      {state.warning ? <Banner message={state.warning} /> : null}
      <TabBody t={t} state={state} />
    </div>
  )
}

function Banner({ message }: { message: string }) {
  return (
    <div className="dtc-banner">
      <span>{message}</span>
    </div>
  )
}

/** 卡片页 / 提示词页二选一：两块各自独立，装配留在这里。 */
function TabBody({ t, state }: { t: Translate; state: PanelState }) {
  const { tab, actions, detailApi } = state
  if (tab === 'settings') {
    return (
      <SettingsTab
        t={t}
        settings={state.settings}
        models={state.models}
        precedents={state.precedents}
        busy={state.busy}
        onSave={state.saveSettings}
      />
    )
  }
  return (
    <CardsTab
      t={t}
      cards={state.cards}
      busy={state.busy}
      draft={state.draft}
      loading={state.loading}
      titles={state.titles}
      onDraftChange={state.setDraft}
      onAdd={actions.onAdd}
      onAction={actions.onAction}
      onAnswer={actions.onAnswer}
      onRedecide={actions.onRedecide}
      onDetail={(target) => detailApi.openDetail(target).catch(() => {})}
      onOpenSession={state.openSession}
    />
  )
}
