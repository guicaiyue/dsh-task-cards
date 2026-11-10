// 设置（六组 + 危险区）与会话两屏的文案。由该屏实现方维护。
// 阶段徽标 / 等待原因的键在 locale/workbench.ts：两屏共用同一套 labelKey，不在这里重复定义。

import type { ExtraDict } from './extras'

export const SETTINGS_DICT: ExtraDict = {
  tabSettings: { zh: '设置', en: 'Settings' },
  tabSession: { zh: '会话', en: 'Session' },
  // ── 六组标题与说明 ──────────────────────────────────────
  setGroupMaster: { zh: '总开关', en: 'Master switch' },
  setMasterHint: {
    zh: '关掉任一角色，它就不再参与卡的生命周期；卡片与账本照常保留。',
    en: 'Turning a role off takes it out of the card lifecycle; cards and the ledger stay.',
  },
  setEnabledHint: {
    zh: '关闭后观察者不再建卡，面板只读，也不再接单。',
    en: 'When off, the observer creates no cards and the panel becomes read-only.',
  },
  setGroupDecision: { zh: '决策者', en: 'Decision agent' },
  setDecisionHint: {
    zh: '秘书 = 决策者。暂停后只建卡、不批红；已批的卡照常派发。',
    en: 'The secretary decides. Paused means cards are still created, no verdicts are issued.',
  },
  setPauseDecision: { zh: '暂停（只建卡不批）', en: 'Pause (cards only, no verdicts)' },
  setPauseHint: {
    zh: '暂停期间卡停在「待决」，等你本人处理；恢复后不会补批。',
    en: 'While paused cards wait in “pending” for you; resuming does not back-fill verdicts.',
  },
  setGroupExec: { zh: '执行者 / 观察者', en: 'Executor / observer' },
  setExecHint: {
    zh: '观察者只读会话、不出手；执行者领取租约并按清单动手（每会话 WIP=1）。',
    en: 'The observer only reads; the executor takes a lease and works the checklist (WIP=1 per session).',
  },
  setIncludeSubagents: { zh: '连子代理的会话也观察', en: 'Observe subagent sessions too' },
  setIncludeSubagentsHint: {
    zh: '打开后子代理跑完也会建卡；默认只看主会话。',
    en: 'When on, finished subagents can create cards too; the default is the main session only.',
  },
  setModelHint: {
    zh: '留空 = 跟随当前默认模型。',
    en: 'Empty means follow the current default model.',
  },
  setPromptHint: {
    zh: '观察者只拿到这段提示词，没有工具、没有技能；空着用内置默认。',
    en: 'The observer gets only this prompt — no tools, no skills. Empty uses the built-in default.',
  },
  setGroupBudget: { zh: '预算与超时', en: 'Budget & timeouts' },
  setBudgetHint: {
    zh: '超限不静默失败：降级为等待，或升级给你决定。',
    en: 'Going over budget never fails silently: it degrades to waiting or escalates to you.',
  },
  setMaxInputBytes: { zh: '单次输入上限（字节）', en: 'Input cap per run (bytes)' },
  setMaxInputBytesHint: {
    zh: '喂给模型的会话文本超过上限就截断，避免一次烧掉整轮预算。',
    en: 'Session text above the cap is truncated before it reaches the model.',
  },
  setTimeoutHint: {
    zh: '单次调用超过这个时长判为「未知」，等你决定重试或补偿。',
    en: 'A run longer than this is marked unknown; you decide retry or compensation.',
  },
  setPrecedentLimit: { zh: '一次票拟最多带几条判例', en: 'Precedents per verdict' },
  setPrecedentLimitHint: {
    zh: '带得越多越贴合旧决定，也越费输入预算。',
    en: 'More precedents fit past decisions better and cost more input budget.',
  },
  // ── 保留与隐私：固定策略，只读 ──────────────────────────
  setGroupPrivacy: { zh: '保留与隐私', en: 'Retention & privacy' },
  setPrivacyHint: {
    zh: '以下四条是固定策略，面板里只读，改不了。',
    en: 'These four are fixed policies; they are read-only here.',
  },
  setPrivacyRecords: { zh: '运行记录最多保留 200 条。', en: 'At most 200 run records are kept.' },
  setPrivacyEvents: {
    zh: '事件流只存状态迁移，不存会话正文。',
    en: 'The event stream stores transitions only, never message bodies.',
  },
  setPrivacyEvidence: {
    zh: '证据只存引用与摘要，不落原文。',
    en: 'Evidence stores references and digests, never raw text.',
  },
  setPrivacyBaseline: {
    zh: '执行清单基线冻结后只能追加，不能改写。',
    en: 'Once frozen, a checklist baseline can only be appended to.',
  },
  // ── 通知：只读 ─────────────────────────────────────────
  setGroupNotify: { zh: '通知', en: 'Notifications' },
  setNotifyMajor: {
    zh: '只有 major 或需要你拍板的卡才进未读与提醒。',
    en: 'Only major cards or ones needing your call enter unread and reminders.',
  },
  setNotifySeen: {
    zh: '通知类卡看过即免打扰，不再计未读。',
    en: 'Notice cards are muted once seen and stop counting as unread.',
  },
  setNotifySilent: {
    zh: '静默卡不亮圆点、不计未读。',
    en: 'Silent cards never light the dot or count as unread.',
  },
  // ── 危险区 ─────────────────────────────────────────────
  setDanger: { zh: '危险区', en: 'Danger zone' },
  setDangerHint: {
    zh: '停用立刻生效，需要二次确认；这里不删任何卡片。',
    en: 'Disabling takes effect at once and needs a second confirmation. No cards are deleted here.',
  },
  setDisableObserver: { zh: '停用观察者', en: 'Disable observer' },
  setDisableObserverHint: {
    zh: '观察者不再建卡；已有卡保留，面板只读。',
    en: 'The observer stops creating cards; existing cards stay and the panel is read-only.',
  },
  setDisableDecision: { zh: '停用决策代理人', en: 'Disable decision agent' },
  setDisableDecisionHint: {
    zh: '决策者不再出票拟；卡继续建，全部等你拍板。',
    en: 'No more verdicts are issued; cards still arrive and all wait for your call.',
  },
  setConfirmDisable: { zh: '确认停用', en: 'Confirm disable' },
  setCancel: { zh: '取消', en: 'Cancel' },
  setDirty: { zh: '有未保存的修改', en: 'Unsaved changes' },
  // ── 会话屏 ─────────────────────────────────────────────
  sesPickLabel: { zh: '会话', en: 'Session' },
  sesPickPlaceholder: { zh: '选择一个会话', en: 'Pick a session' },
  sesNoSessions: {
    zh: '还没有带会话的卡。工作台建卡后，这里就能按会话看时间线。',
    en: 'No cards with a session yet. Once the workbench has cards, their timelines show up here.',
  },
  sesPickEmpty: {
    zh: '从工作台或记录里选一个会话，这里显示它的时间线和卡节点。',
    en: 'Pick a session from the workbench or records to see its timeline and card nodes.',
  },
  sesCardCount: { zh: '{n} 张卡', en: '{n} cards' },
  sesPendingCount: { zh: '{n} 待处理', en: '{n} pending' },
  sesLoading: { zh: '正在读取会话时间线…', en: 'Loading the session timeline…' },
  sesLoadError: { zh: '读取会话失败：{error}', en: 'Could not load the session: {error}' },
  sesTimelineEmpty: {
    zh: '这个会话没有可读的对话：宿主没返回时间线，或会话已被清理。卡片节点仍然可点。',
    en: 'No readable conversation: no timeline from the host, or it was pruned. Card nodes still open.',
  },
  sesOtherCards: { zh: '其它卡（没有归到某一轮）', en: 'Other cards (not tied to a turn)' },
  sesOpenHint: { zh: '看卡片详情', en: 'Open card detail' },
}
