// 面板主组件：七屏选一。只做渲染，状态与副作用都在 usePanelState 里。

import { type PanelState, usePanelState } from '../hooks/usePanelState'
import type { Card, Translate } from '../types'
import { DetailTab } from './DetailTab'
import { FailureTab } from './FailureTab'
import { NoticeToast } from './NoticeToast'
import { PanelHeader } from './PanelHeader'
import { PolicyTab } from './PolicyTab'
import { RecordsTab } from './RecordsTab'
import { SessionTab } from './SessionTab'
import { SettingsTab } from './SettingsTab'
import { WorkbenchTab } from './WorkbenchTab'

interface Props {
  t: Translate
  uiWorkspace?: { openSession?: (sessionId: string) => void }
}

export function Panel({ t, uiWorkspace }: Props) {
  const state = usePanelState(uiWorkspace)
  return (
    <div className="dtc-page">
      <PanelHeader
        t={t}
        cards={state.cards}
        tab={state.tab}
        onTab={state.setTab}
        onRefresh={state.actions.onRefresh}
        onReconcile={state.reconcile}
        busy={state.busy}
      />
      {state.notice ? (
        <NoticeToast t={t} notice={state.notice} onClose={state.dismissNotice} />
      ) : null}
      {state.error ? <Banner message={state.error} /> : null}
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

function TabBody({ t, state }: { t: Translate; state: PanelState }) {
  const { tab } = state
  if (tab === 'workbench') return <Workbench t={t} state={state} />
  if (tab === 'detail') return <Detail t={t} state={state} />
  if (tab === 'failure') {
    return (
      <FailureTab
        t={t}
        cards={state.cards}
        onOpenDetail={state.openCard}
        onOpenSession={state.openSession}
      />
    )
  }
  if (tab === 'policy') {
    return (
      <PolicyTab t={t} settings={state.settings} busy={state.busy} onSave={state.saveSettings} />
    )
  }
  if (tab === 'records') {
    return (
      <RecordsTab
        t={t}
        active
        cards={state.cards}
        onDetail={(card: Card) => state.openCard(card)}
      />
    )
  }
  if (tab === 'session') {
    return (
      <SessionTab
        t={t}
        cards={state.cards}
        sessionId={state.sessionId}
        onSelectSession={state.selectSession}
        onOpenDetail={state.openCard}
      />
    )
  }
  return (
    <SettingsTab
      t={t}
      settings={state.settings}
      models={state.models}
      busy={state.busy}
      onSave={state.saveSettings}
    />
  )
}

function Workbench({ t, state }: { t: Translate; state: PanelState }) {
  const { actions } = state
  return (
    <WorkbenchTab
      t={t}
      cards={state.cards}
      stats={state.stats}
      busy={state.busy}
      loading={state.loading}
      draft={state.draft}
      titles={state.titles}
      progress={state.progress}
      onDraftChange={state.setDraft}
      onAdd={actions.onAdd}
      onAction={actions.onAction}
      onAnswer={actions.onAnswer}
      onRedecide={actions.onRedecide}
      onOpenDetail={state.openCard}
      onOpenSession={state.openSession}
      onSelectSession={state.selectSession}
      onReconcile={state.reconcile}
      paused={state.paused}
    />
  )
}

function Detail({ t, state }: { t: Translate; state: PanelState }) {
  const { actions } = state
  const snapshot = state.detail?.card || null
  const live = snapshot ? state.cards.find((card) => card.id === snapshot.id) || snapshot : null
  return (
    <DetailTab
      t={t}
      detail={state.detail}
      card={live}
      precedents={state.precedents}
      busy={state.busy}
      onBack={() => state.setTab('workbench')}
      onOpenSession={state.openSession}
      onOpenSessionTab={state.selectSession}
      onAction={actions.onAction}
      onAdopt={actions.onAdopt}
      onFixAcceptance={actions.onFixAcceptance}
      suggestAsk={state.settings?.askTimeoutAction === 'suggest'}
      askTimeoutMinutes={state.settings?.askTimeoutMinutes ?? 10}
      onReworked={actions.onReworked}
      onRedecide={actions.onRedecide}
    />
  )
}
