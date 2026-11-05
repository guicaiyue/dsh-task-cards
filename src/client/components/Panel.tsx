// 面板主组件：只做渲染，状态与副作用都在 usePanelState 里。

import { usePanelState } from '../hooks/usePanelState'
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
      {state.error ? (
        <div className="dtc-banner">
          <span>{state.error}</span>
        </div>
      ) : null}
      {state.detail ? (
        <DetailModal
          t={t}
          detail={state.detail}
          busy={state.busy}
          onClose={detailApi.closeDetail}
          onOpenSession={state.openSession}
          onAction={actions.onAction}
        />
      ) : null}
      {state.warning ? (
        <div className="dtc-banner">
          <span>{state.warning}</span>
        </div>
      ) : null}
      {tab === 'cards' ? (
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
          onDetail={(target) => detailApi.openDetail(target).catch(() => {})}
          onOpenSession={state.openSession}
        />
      ) : (
        <SettingsTab
          t={t}
          settings={state.settings}
          models={state.models}
          busy={state.busy}
          onSave={state.saveSettings}
        />
      )}
    </div>
  )
}
