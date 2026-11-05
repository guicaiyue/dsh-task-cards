// dsh-task-cards —— 客户端半边（DSH 客户端模块）。
//
// 版式按 Executive Dashboard：顶部四个 KPI，下面按「要我决策 / 要我知晓 /
// 自动处理中 / 已结束」分组，密集但一眼能扫。颜色走本页自己的 CSS 变量，
// 深色主题一组覆盖（DSH 在 body[data-ds-dark-theme] 上切）。
//
// 数据全部经宿主路由 `lib/index.js`；卡片是 JSON 的一种展现，JSON 才是源格式。
// 文案字典的值只能是字符串，插值用 {n}。

window.__ModuleLoader__.load({
  id: 'dsh-task-cards',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const NS = 'dsh-task-cards'
    const PANEL_ID = 'task-cards'
    const API = '/dsh-task-cards/api'

    const DICT = {
      zh: {
        nav: '任务卡',
        title: '任务卡',
        eyebrow: 'DSH · TASK CARDS',
        subtitle: '会话结束后，观察者把值得留下的东西记成 JSON；卡片只是它的样子',
        tabCards: '卡片',
        tabSettings: '提示词',
        kpiDecision: '要我决策',
        kpiInfo: '要我知晓',
        kpiAuto: '自动处理中',
        kpiClosed: '已结束',
        groupDecision: '需要我决策',
        groupInfo: '需要我知晓',
        groupAuto: '自动处理中',
        groupClosed: '已结束',
        placeholder: '记一件事（回车保存）',
        add: '记下',
        emptyAll: '还没有卡。会话结束后观察者会自己记，也可以在上面手写一条。',
        manualTree: '手写卡片',
        treeCount: '{n} 张',
        detail: '查看详情',
        openSession: '打开会话',
        modalTitle: '会话详情',
        roleUser: '用户',
        roleModel: '模型',
        turnNo: '第 {n} 轮',
        longExpand: '展开全文',
        longCollapse: '收起',
        showEarlier: '显示更早的 {n} 轮',
        alreadyClosed: '这张卡已经处理过了。',
        metaTurns: '{n} 轮',
        lastAt: '最近 {time}',
        modalEmpty: '这个会话还没有可读的对话。',
        close: '关闭',
        noSession: '这个会话已经打不开了。',
        approve: '批准',
        answerHint: '选一个，作为你的回答发回去：',
        know: '知道了',
        dismiss: '忽略',
        runNow: '立即执行',
        reopen: '重开',
        remove: '删除',
        loading: '读取中…',
        retry: '重试',
        fromHuman: '手工',
        fromAgent: '观察者',
        dueAt: '计划 {time}',
        ranAt: '执行于 {time}',
        failReason: '上次失败：{reason}',
        settingsHint: '观察者只拿到这段系统提示词，没有工具、没有技能。提示词决定卡片怎么分类：要我决策 / 要我知晓 / 自动处理。',
        enabled: '启用观察者',
        model: '分析用的模型',
        modelDefault: '跟随当前默认模型',
        minReplyChars: '只分析不短于（字）',
        timeoutMs: '超时（毫秒）',
        systemPrompt: '系统提示词',
        save: '保存',
        saved: '已保存',
        saving: '保存中…',
        refresh: '刷新',
        error: '错误',
      },
      en: {
        nav: 'Task Cards',
        title: 'Task Cards',
        eyebrow: 'DSH · TASK CARDS',
        subtitle: 'After a turn ends, an observer records what matters as JSON; a card is just its shape',
        tabCards: 'Cards',
        tabSettings: 'Prompt',
        kpiDecision: 'To decide',
        kpiInfo: 'To know',
        kpiAuto: 'Automating',
        kpiClosed: 'Closed',
        groupDecision: 'Needs my decision',
        groupInfo: 'Needs my awareness',
        groupAuto: 'Running automatically',
        groupClosed: 'Closed',
        placeholder: 'Note something (Enter to save)',
        add: 'Add',
        emptyAll: 'No cards yet. The observer records them after turns; you can also type one above.',
        manualTree: 'Manual cards',
        treeCount: '{n}',
        detail: 'Details',
        openSession: 'Open chat',
        modalTitle: 'Session detail',
        roleUser: 'User',
        roleModel: 'Model',
        turnNo: 'Turn {n}',
        longExpand: 'Show full text',
        longCollapse: 'Collapse',
        showEarlier: 'Show {n} earlier turns',
        alreadyClosed: 'This card has already been handled.',
        metaTurns: '{n} turns',
        lastAt: 'last {time}',
        modalEmpty: 'No readable conversation in this session.',
        close: 'Close',
        noSession: 'This session can no longer be opened.',
        approve: 'Approve',
        answerHint: 'Pick one — it goes back as your answer:',
        know: 'Got it',
        dismiss: 'Dismiss',
        runNow: 'Run now',
        reopen: 'Reopen',
        remove: 'Delete',
        loading: 'Loading…',
        retry: 'Retry',
        fromHuman: 'manual',
        fromAgent: 'observer',
        dueAt: 'planned {time}',
        ranAt: 'ran {time}',
        failReason: 'last failure: {reason}',
        settingsHint: 'The observer gets only this system prompt — no tools, no skills. It decides how cards are classified.',
        enabled: 'Observer enabled',
        model: 'Model for analysis',
        modelDefault: 'Follow the current default model',
        minReplyChars: 'Only analyse replies longer than',
        timeoutMs: 'Timeout (ms)',
        systemPrompt: 'System prompt',
        save: 'Save',
        saved: 'Saved',
        saving: 'Saving…',
        refresh: 'Refresh',
        error: 'error',
      },
    }

    const CSS = `
      .dtc-page {
        --dtc-bg: #F8FAFC; --dtc-surface: #FFFFFF; --dtc-raise: #F1F5F9;
        --dtc-border: #DBEAFE; --dtc-line: #E2E8F0;
        --dtc-text: #1E3A8A; --dtc-ink: #0F172A; --dtc-muted: #64748B; --dtc-faint: #94A3B8;
        --dtc-primary: #1E40AF; --dtc-primary-soft: #DBEAFE;
        --dtc-accent: #D97706; --dtc-accent-soft: #FEF3C7;
        --dtc-danger: #DC2626; --dtc-success: #15803D;
        background: var(--dtc-bg); color: var(--dtc-ink);
        display: flex; flex-direction: column; gap: 18px;
        padding: 24px clamp(20px, 4vw, 56px) 56px;
        width: 100%; box-sizing: border-box; height: 100%; overflow: auto;
        font-variant-numeric: tabular-nums;
      }
      body[data-ds-dark-theme] .dtc-page {
        --dtc-bg: #0B1220; --dtc-surface: #111A2C; --dtc-raise: #16233A;
        --dtc-border: #1E3A5F; --dtc-line: #1B2942;
        --dtc-text: #BFDBFE; --dtc-ink: #E2E8F0; --dtc-muted: #94A3B8; --dtc-faint: #64748B;
        --dtc-primary: #60A5FA; --dtc-primary-soft: #1E3A8A;
        --dtc-accent: #FBBF24; --dtc-accent-soft: #78350F;
        --dtc-danger: #F87171; --dtc-success: #4ADE80;
      }
      .dtc-head { display: flex; align-items: flex-end; gap: 14px; }
      .dtc-eyebrow { font: 500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .12em; color: var(--dtc-faint); text-transform: uppercase; }
      .dtc-title { margin: 6px 0 0; font: 700 24px/1.15 ui-sans-serif, system-ui, sans-serif; color: var(--dtc-ink); letter-spacing: -.01em; }
      .dtc-sub { font-size: 12px; color: var(--dtc-muted); margin-top: 5px; }
      .dtc-spacer { flex: 1; }
      .dtc-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
      .dtc-kpi { background: var(--dtc-surface); border: 1px solid var(--dtc-border); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; }
      .dtc-kpi-label { font: 500 11px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .06em; color: var(--dtc-muted); text-transform: uppercase; }
      .dtc-kpi-value { font: 700 26px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dtc-ink); }
      .dtc-kpi.is-decision .dtc-kpi-value { color: var(--dtc-accent); }
      .dtc-kpi.is-auto .dtc-kpi-value { color: var(--dtc-primary); }
      .dtc-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--dtc-line); }
      .dtc-tab { padding: 8px 13px; font-size: 13px; cursor: pointer; border: none; background: transparent;
        color: var(--dtc-muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
      .dtc-tab.is-active { color: var(--dtc-ink); border-bottom-color: var(--dtc-primary); font-weight: 600; }
      .dtc-section { display: flex; flex-direction: column; gap: 8px; }
      .dtc-section-head { display: flex; align-items: baseline; gap: 8px; }
      .dtc-section-title { font: 600 12px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--dtc-muted); }
      .dtc-section-count { font: 500 12px/1 ui-monospace, Menlo, monospace; color: var(--dtc-faint); }
      .dtc-form { display: flex; gap: 8px; }
      .dtc-input, .dtc-select, .dtc-textarea { padding: 9px 11px; border-radius: 8px; font-size: 13px; font-family: inherit;
        color: var(--dtc-ink); background: var(--dtc-surface); border: 1px solid var(--dtc-border); outline: none; }
      .dtc-input:focus, .dtc-select:focus, .dtc-textarea:focus { border-color: var(--dtc-primary); }
      .dtc-input { flex: 1; min-width: 0; }
      .dtc-textarea { width: 100%; box-sizing: border-box; min-height: 230px; resize: vertical; line-height: 1.6;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
      .dtc-add, .dtc-save { padding: 9px 15px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
        border: 1px solid var(--dtc-primary); color: #FFFFFF; background: var(--dtc-primary); }
      .dtc-add:disabled, .dtc-save:disabled { opacity: .45; cursor: default; }
      .dtc-btn { padding: 5px 9px; border-radius: 6px; font-size: 12px; cursor: pointer;
        border: 1px solid var(--dtc-border); color: var(--dtc-text); background: var(--dtc-surface); white-space: nowrap; }
      .dtc-btn:hover { background: var(--dtc-raise); }
      .dtc-btn.is-primary { border-color: var(--dtc-primary); color: var(--dtc-primary); }
      .dtc-btn.is-danger { color: var(--dtc-danger); border-color: var(--dtc-border); }
      .dtc-cards { display: flex; flex-direction: column; gap: 6px; }
      .dtc-card { display: flex; gap: 12px; padding: 11px 13px 11px 11px; border-radius: 8px;
        background: var(--dtc-surface); border: 1px solid var(--dtc-border); }
      .dtc-rail { width: 3px; border-radius: 3px; background: var(--dtc-faint); flex-shrink: 0; }
      .dtc-card.is-decision .dtc-rail { background: var(--dtc-accent); }
      .dtc-card.is-auto .dtc-rail { background: var(--dtc-primary); }
      .dtc-card.is-closed { opacity: .62; }
      .dtc-main { flex: 1; min-width: 0; }
      .dtc-text { font-size: 13.5px; line-height: 1.5; color: var(--dtc-ink); font-weight: 550; overflow-wrap: anywhere; }
      .dtc-card.is-closed .dtc-text { font-weight: 500; color: var(--dtc-muted); }
      .dtc-detail { margin-top: 3px; font-size: 12px; line-height: 1.55; color: var(--dtc-muted); }
      .dtc-meta { margin-top: 5px; display: flex; gap: 8px; flex-wrap: wrap; font-size: 11px; color: var(--dtc-faint); }
      .dtc-chip { padding: 1px 7px; border-radius: 999px; border: 1px solid var(--dtc-border); }
      .dtc-chip.is-decision { color: var(--dtc-accent); border-color: var(--dtc-accent); }
      .dtc-chip.is-auto { color: var(--dtc-primary); border-color: var(--dtc-primary); }
      .dtc-actions { display: flex; align-items: flex-start; gap: 6px; flex-shrink: 0; }
      .dtc-options { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .dtc-option { padding: 6px 11px; border-radius: 6px; font-size: 12px; cursor: pointer;
        border: 1px solid var(--dtc-primary); color: var(--dtc-primary); background: var(--dtc-surface); }
      .dtc-option:hover { background: var(--dtc-primary); color: #FFFFFF; }
      .dtc-empty { padding: 22px 0; font-size: 12px; color: var(--dtc-faint); text-align: center; }
      .dtc-banner { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; font-size: 12px;
        color: var(--dtc-danger); background: var(--dtc-surface); border: 1px solid var(--dtc-danger); }
      .dtc-hint { font-size: 12px; line-height: 1.65; color: var(--dtc-muted); }
      .dtc-record { padding: 10px 12px; border-radius: 8px; background: var(--dtc-surface);
        border: 1px solid var(--dtc-border); display: flex; flex-direction: column; gap: 5px; }
      .dtc-record-head { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--dtc-muted); }
      .dtc-status { font-weight: 700; font-family: ui-monospace, Menlo, monospace; }
      .dtc-status.is-ok { color: var(--dtc-success); }
      .dtc-status.is-empty { color: var(--dtc-muted); }
      .dtc-status.is-invalid { color: var(--dtc-accent); }
      .dtc-status.is-error { color: var(--dtc-danger); }
      .dtc-pre { margin: 0; font: 400 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap;
        word-break: break-word; color: var(--dtc-muted); background: var(--dtc-raise); padding: 7px 9px; border-radius: 6px; }
      .dtc-field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--dtc-muted); }
      .dtc-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
      .dtc-tree { display: flex; flex-direction: column; gap: 10px; }
      .dtc-tree-node { border: 1px solid var(--dtc-border); border-radius: 10px; background: var(--dtc-surface); overflow: hidden; }
      .dtc-tree-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--dtc-raise); }
      .dtc-tree-caret { cursor: pointer; width: 16px; color: var(--dtc-muted); font-size: 11px; user-select: none; }
      .dtc-tree-title { font-size: 13px; font-weight: 600; color: var(--dtc-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
      .dtc-tree-meta { font-size: 11px; color: var(--dtc-faint); white-space: nowrap; }
      .dtc-tree-body { display: flex; flex-direction: column; }
      .dtc-branch { display: flex; gap: 10px; padding: 9px 14px 9px 24px; border-top: 1px solid var(--dtc-line); position: relative; }
      .dtc-branch::before { content: ''; position: absolute; left: 12px; top: 0; bottom: 50%; width: 1px; background: var(--dtc-border); }
      .dtc-branch::after { content: ''; position: absolute; left: 12px; top: 50%; width: 8px; height: 1px; background: var(--dtc-border); }
      .dtc-modal-mask { position: fixed; inset: 0; background: rgba(8, 15, 30, .55); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 40px 32px; }
      .dtc-modal { width: min(900px, 100%); max-height: 100%; display: flex; flex-direction: column; background: var(--dtc-surface);
        border: 1px solid var(--dtc-border); border-radius: 12px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
      .dtc-modal-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--dtc-line); }
      .dtc-modal-title { font-size: 13px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dtc-modal-head { position: sticky; top: 0; z-index: 1; background: var(--dtc-surface); }
      .dtc-modal-meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px; color: var(--dtc-faint); padding: 8px 16px 10px; border-bottom: 1px solid var(--dtc-line); }
      .dtc-card-block { margin: 0 16px; padding: 12px 14px; border: 1px solid var(--dtc-border); border-radius: 10px; background: var(--dtc-raise); }
      .dtc-card-block-title { font-size: 13.5px; font-weight: 600; color: var(--dtc-ink); overflow-wrap: anywhere; }
      .dtc-card-block-detail { margin-top: 4px; font-size: 12px; line-height: 1.6; color: var(--dtc-muted); white-space: pre-wrap; }
      .dtc-modal-meta code { font-family: ui-monospace, Menlo, monospace; }
      .dtc-modal-body { padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
      .dtc-timeline { position: relative; display: flex; flex-direction: column; gap: 14px; padding-left: 22px; }
      .dtc-timeline::before { content: ''; position: absolute; left: 6px; top: 6px; bottom: 6px; width: 1px; background: var(--dtc-border); }
      .dtc-turn { position: relative; display: flex; flex-direction: column; gap: 6px; }
      .dtc-turn::before { content: ''; position: absolute; left: -19px; top: 7px; width: 7px; height: 7px; border-radius: 50%;
        background: var(--dtc-surface); border: 2px solid var(--dtc-primary); }
      .dtc-turn-label { display: flex; align-items: baseline; gap: 8px; font-size: 11px; color: var(--dtc-faint); }
      .dtc-turn-label b { font-weight: 600; color: var(--dtc-muted); letter-spacing: .04em; }
      .dtc-role { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--dtc-faint); margin: 2px 0 3px; }
      .dtc-turn-user, .dtc-turn-ai { padding: 9px 11px; border-radius: 8px; font-size: 12.5px; line-height: 1.65;
        white-space: pre-wrap; word-break: break-word; max-width: 76ch; }
      .dtc-turn-user { background: var(--dtc-raise); color: var(--dtc-text); border-left: 2px solid var(--dtc-faint); }
      .dtc-turn-ai { background: var(--dtc-surface); color: var(--dtc-ink); border: 1px solid var(--dtc-border); }
      .dtc-clamp { display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
      .dtc-more { align-self: flex-start; margin-top: 2px; padding: 0; border: none; background: none; color: var(--dtc-primary); font-size: 11px; cursor: pointer; }
      .dtc-more:hover { text-decoration: underline; }
      .dtc-earlier { align-self: center; margin-top: 2px; }
    `

    async function call(pathname, init) {
      const res = await fetch(pathname, init)
      let body = null
      try {
        body = await res.json()
      } catch (err) {
        /* 非 JSON 响应走下面兜底 */
      }
      if (!res.ok || !body || body.ok === false) throw new Error((body && body.error) || `请求失败（HTTP ${res.status}）`)
      return body
    }

    function timeLabel(at) {
      try {
        const d = new Date(at)
        return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      } catch (err) {
        return ''
      }
    }

    const CLOSED = new Set(['done', 'dismissed', 'acknowledged'])

    function groupCards(cards) {
      return {
        decision: cards.filter((c) => c.kind === 'decision' && !CLOSED.has(c.status)),
        info: cards.filter((c) => c.kind === 'info' && !CLOSED.has(c.status)),
        auto: cards.filter((c) => c.kind === 'auto' && !CLOSED.has(c.status)),
        closed: cards.filter((c) => CLOSED.has(c.status)),
      }
    }

    function CardRow({ t, card, busy, onAction, onAnswer, onDetail, onOpenSession }) {
      const isDecision = card.kind === 'decision'
      const isAuto = card.kind === 'auto'
      const closed = CLOSED.has(card.status)
      const cls = `dtc-card${isDecision ? ' is-decision' : isAuto ? ' is-auto' : ''}${closed ? ' is-closed' : ''}`
      const kindLabel = isDecision ? t('groupDecision') : isAuto ? t('groupAuto') : t('groupInfo')
      return h(
        'div',
        { className: cls },
        h('div', { className: 'dtc-rail' }),
        h(
          'div',
          { className: 'dtc-main' },
          h('div', { className: 'dtc-text' }, card.title),
          card.detail ? h('div', { className: 'dtc-detail' }, card.detail) : null,
          h(
            'div',
            { className: 'dtc-meta' },
            h('span', { className: `dtc-chip${isDecision ? ' is-decision' : isAuto ? ' is-auto' : ''}` }, kindLabel),
            h('span', null, card.source === 'agent' ? t('fromAgent') : t('fromHuman')),
            h('span', null, timeLabel(closed ? card.updatedAt : card.createdAt)),
            isAuto && card.dueAt && !closed ? h('span', null, t('dueAt', { time: timeLabel(card.dueAt) })) : null,
            card.executedAt ? h('span', null, t('ranAt', { time: timeLabel(card.executedAt) })) : null,
            card.lastError
              ? h('span', { className: 'dtc-chip is-decision' }, t('failReason', { reason: card.lastError.slice(0, 60) }))
              : null,
          ),
          // 阻塞式提问生成的卡：直接把选项当回答发回去
          card.interaction === 'question' && !closed && card.question && Array.isArray(card.question.items)
            ? h(
                'div',
                { className: 'dtc-options' },
                h('span', { className: 'dtc-hint' }, t('answerHint')),
                card.question.items
                  .flatMap((item) => (item.options || []).map((label) => ({ label, item })))
                  .map((option) =>
                    h(
                      'button',
                      {
                        key: `${card.id}-${option.item.id}-${option.label}`,
                        className: 'dtc-option',
                        disabled: busy,
                        onClick: () => onAnswer(card, option.label),
                      },
                      option.label,
                    ),
                  ),
              )
            : null,
        ),
        h(
          'div',
          { className: 'dtc-actions' },
          isDecision && !closed
            ? h('button', { className: 'dtc-btn is-primary', disabled: busy, onClick: () => onAction(card, 'complete') }, t('approve'))
            : null,
          !isDecision && !isAuto && !closed
            ? h('button', { className: 'dtc-btn is-primary', disabled: busy, onClick: () => onAction(card, 'acknowledge') }, t('know'))
            : null,
          isAuto && !closed
            ? h('button', { className: 'dtc-btn is-primary', disabled: busy, onClick: () => onAction(card, 'run-now') }, t('runNow'))
            : null,
          !closed ? h('button', { className: 'dtc-btn', disabled: busy, onClick: () => onAction(card, 'dismiss') }, t('dismiss')) : null,
          closed ? h('button', { className: 'dtc-btn', disabled: busy, onClick: () => onAction(card, 'reopen') }, t('reopen')) : null,
          card.kind === 'decision' && !closed
            ? h(
                'button',
                {
                  className: 'dtc-btn',
                  disabled: busy,
                  onClick: () =>
                    onDetail({ card, title: card.title, sessionId: (card.origin && card.origin.sessionId) || '' }),
                },
                t('detail'),
              )
            : null,
          h('button', { className: 'dtc-btn is-danger', disabled: busy, onClick: () => onAction(card, 'delete') }, t('remove')),
        ),
      )
    }

    function Section({ t, title, cards, busy, onAction, onAnswer }) {
      if (!cards.length) return null
      return h(
        'div',
        { className: 'dtc-section' },
        h(
          'div',
          { className: 'dtc-section-head' },
          h('div', { className: 'dtc-section-title' }, title),
          h('div', { className: 'dtc-section-count' }, String(cards.length)),
        ),
        h(
          'div',
          { className: 'dtc-cards' },
          cards.map((card) => h(CardRow, { key: card.id, t, card, busy, onAction, onAnswer })),
        ),
      )
    }

    function buildTrees(cards) {
      const groups = new Map()
      for (const card of cards) {
        const sid = (card.origin && card.origin.sessionId) || ''
        if (!groups.has(sid)) groups.set(sid, [])
        groups.get(sid).push(card)
      }
      return [...groups.entries()]
        .map(([sid, list]) => ({ sid, cards: list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) }))
        .sort((a, b) => (b.cards[0].createdAt || 0) - (a.cards[0].createdAt || 0))
    }

    function CardsTab({ t, cards, busy, draft, setDraft, add, onAction, onAnswer, loading, titles, onDetail, onOpenSession }) {
      const [collapsed, setCollapsed] = useState(() => new Set())
      const trees = useMemo(() => buildTrees(cards), [cards])
      const toggle = (sid) =>
        setCollapsed((prev) => {
          const next = new Set(prev)
          if (next.has(sid)) next.delete(sid)
          else next.add(sid)
          return next
        })

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'dtc-form' },
          h('input', {
            className: 'dtc-input',
            value: draft,
            placeholder: t('placeholder'),
            disabled: busy,
            maxLength: 200,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                add()
              }
            },
          }),
          h('button', { className: 'dtc-add', disabled: busy || !draft.trim(), onClick: add }, t('add')),
        ),
        loading
          ? h('div', { className: 'dtc-empty' }, t('loading'))
          : cards.length === 0
            ? h('div', { className: 'dtc-empty' }, t('emptyAll'))
            : h(
                'div',
                { className: 'dtc-tree' },
                trees.map((tree) => {
                  const isManual = !tree.sid
                  const open = !collapsed.has(tree.sid)
                  const title = isManual ? t('manualTree') : titles[tree.sid] || tree.sid.slice(0, 18)
                  const latest = tree.cards[0]
                  return h(
                    'div',
                    { key: tree.sid || 'manual', className: 'dtc-tree-node' },
                    h(
                      'div',
                      { className: 'dtc-tree-head' },
                      h('span', { className: 'dtc-tree-caret', onClick: () => toggle(tree.sid) }, open ? '▾' : '▸'),
                      h('span', { className: 'dtc-tree-title', onClick: () => toggle(tree.sid) }, title),
                      h('span', { className: 'dtc-tree-meta' }, t('treeCount', { n: tree.cards.length })),
                      h('span', { className: 'dtc-tree-meta' }, timeLabel(latest.createdAt)),
                      !isManual ? h('button', { className: 'dtc-btn', onClick: () => onDetail({ sessionId: tree.sid, title }) }, t('detail')) : null,
                      !isManual ? h('button', { className: 'dtc-btn is-primary', onClick: () => onOpenSession(tree.sid) }, t('openSession')) : null,
                    ),
                    open
                      ? h(
                          'div',
                          { className: 'dtc-tree-body' },
                          tree.cards.map((card) =>
                            h(
                              'div',
                              { key: card.id, className: 'dtc-branch' },
                              h(CardRow, { t, card, busy, onAction, onAnswer, onDetail, onOpenSession }),
                            ),
                          ),
                        )
                      : null,
                  )
                }),
              ),
      )
    }

    function TurnBlock({ t, turn, index, total }) {
      const [open, setOpen] = useState(false)
      const long = (turn.assistant || '').length > 320 || (turn.assistant || '').split('\n').length > 6
      return h(
        'div',
        { className: 'dtc-turn' },
        h(
          'div',
          { className: 'dtc-turn-label' },
          h('b', null, t('turnNo', { n: index + 1 })),
          turn.at ? h('span', null, timeLabel(turn.at)) : null,
        ),
        turn.user
          ? h(
              'div',
              null,
              h('div', { className: 'dtc-role' }, t('roleUser')),
              h('div', { className: 'dtc-turn-user' }, turn.user),
            )
          : null,
        turn.assistant
          ? h(
              'div',
              null,
              h('div', { className: 'dtc-role' }, t('roleModel')),
              h('div', { className: `dtc-turn-ai${long && !open ? ' dtc-clamp' : ''}` }, turn.assistant),
              long
                ? h(
                    'button',
                    { className: 'dtc-more', onClick: () => setOpen((value) => !value) },
                    open ? t('longCollapse') : t('longExpand'),
                  )
                : null,
            )
          : null,
      )
    }

    function DetailModal({ t, detail, onClose, onOpenSession, onAction, busy }) {
      const card = detail.card || null
      const closed = card ? ['done', 'dismissed', 'acknowledged'].includes(card.status) : true
      const [showAll, setShowAll] = useState(false)
      const turns = detail.turns || []
      const visible = showAll ? turns : turns.slice(-3)
      const hidden = turns.length - visible.length

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])

      return h(
        'div',
        { className: 'dtc-modal-mask', onClick: onClose },
        h(
          'div',
          {
            className: 'dtc-modal',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': detail.title || t('modalTitle'),
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'div',
            { className: 'dtc-modal-head' },
            h('div', { className: 'dtc-modal-title' }, detail.title || detail.sessionId || t('modalTitle')),
            detail.sessionId
              ? h('button', { className: 'dtc-btn is-primary', onClick: () => onOpenSession(detail.sessionId) }, t('openSession'))
              : null,
            h('button', { className: 'dtc-btn', onClick: onClose, autoFocus: true }, t('close')),
          ),
          card
            ? h(
                'div',
                { className: 'dtc-card-block' },
                h('div', { className: 'dtc-card-block-title' }, card.title),
                card.detail ? h('div', { className: 'dtc-card-block-detail' }, card.detail) : null,
                (card.question && card.question.items ? card.question.items : []).length
                  ? h(
                      'div',
                      { className: 'dtc-options' },
                      card.question.items
                        .flatMap((item) => (item.options || []).map((label) => ({ label, item })))
                        .map((option) =>
                          h(
                            'button',
                            {
                              key: `${card.id}-${option.label}`,
                              className: 'dtc-option',
                              disabled: busy || closed,
                              onClick: () => onAction(card, 'answer', option.label),
                            },
                            option.label,
                          ),
                        ),
                    )
                  : null,
                closed
                  ? h('div', { className: 'dtc-hint' }, t('alreadyClosed'))
                  : h(
                      'div',
                      { className: 'dtc-actions', style: { marginTop: '10px' } },
                      card.kind === 'decision'
                        ? h('button', { className: 'dtc-btn is-primary', disabled: busy, onClick: () => onAction(card, 'complete') }, t('approve'))
                        : null,
                      card.kind === 'info'
                        ? h('button', { className: 'dtc-btn is-primary', disabled: busy, onClick: () => onAction(card, 'acknowledge') }, t('know'))
                        : null,
                      card.kind === 'auto'
                        ? h('button', { className: 'dtc-btn is-primary', disabled: busy, onClick: () => onAction(card, 'run-now') }, t('runNow'))
                        : null,
                      h('button', { className: 'dtc-btn', disabled: busy, onClick: () => onAction(card, 'dismiss') }, t('dismiss')),
                      h('button', { className: 'dtc-btn is-danger', disabled: busy, onClick: () => onAction(card, 'delete') }, t('remove')),
                    ),
              )
            : null,
          h(
            'div',
            { className: 'dtc-modal-meta' },
            h('span', null, t('metaTurns', { n: turns.length })),
            turns.length ? h('span', null, t('lastAt', { time: timeLabel(turns[turns.length - 1].at) })) : null,
            detail.sessionId ? h('code', null, detail.sessionId) : null,
          ),
          h(
            'div',
            { className: 'dtc-modal-body' },
            detail.loading
              ? h('div', { className: 'dtc-hint' }, t('loading'))
              : turns.length === 0
                ? h('div', { className: 'dtc-hint' }, detail.error || t('modalEmpty'))
                : h(
                    'div',
                    { className: 'dtc-timeline' },
                    hidden > 0
                      ? h(
                          'button',
                          { className: 'dtc-btn dtc-earlier', onClick: () => setShowAll(true) },
                          t('showEarlier', { n: hidden }),
                        )
                      : null,
                    visible.map((turn, index) =>
                      h(TurnBlock, { key: `${detail.sessionId}-${index}`, t, turn, index: turns.length - visible.length + index, total: turns.length }),
                    ),
                  ),
          ),
        ),
      )
    }

    function SettingsTab({ t, settings, models, onSave, busy }) {
      const [form, setForm] = useState(settings || null)
      const [saved, setSaved] = useState(false)
      useEffect(() => {
        setForm(settings || null)
      }, [settings])
      if (!form) return h('div', { className: 'dtc-empty' }, t('loading'))

      const groups = (models && models.groups) || []
      const optionValue = form.provider && form.model ? `${form.provider}::${form.model}` : ''
      const patch = (key, value) => {
        setForm((prev) => ({ ...(prev || {}), [key]: value }))
        setSaved(false)
      }

      return h(
        React.Fragment,
        null,
        h('div', { className: 'dtc-hint' }, t('settingsHint')),
        h(
          'label',
          { className: 'dtc-row', style: { cursor: 'pointer', fontSize: '12px' } },
          h('input', { type: 'checkbox', checked: !!form.enabled, onChange: (event) => patch('enabled', event.target.checked) }),
          h('span', null, t('enabled')),
        ),
        h(
          'div',
          { className: 'dtc-row' },
          h(
            'div',
            { className: 'dtc-field', style: { flex: 1, minWidth: '260px' } },
            h('span', null, t('model')),
            h(
              'select',
              {
                className: 'dtc-select',
                value: optionValue,
                onChange: (event) => {
                  const raw = event.target.value
                  if (!raw) {
                    patch('provider', '')
                    patch('model', '')
                    return
                  }
                  const [provider, model] = raw.split('::')
                  patch('provider', provider)
                  patch('model', model)
                },
              },
              h('option', { value: '' }, t('modelDefault')),
              groups.map((group) =>
                h(
                  'optgroup',
                  { key: group.provider, label: group.provider },
                  (group.models || []).map((model) =>
                    h('option', { key: `${group.provider}::${model.id}`, value: `${group.provider}::${model.id}` }, model.name),
                  ),
                ),
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dtc-row' },
          h(
            'div',
            { className: 'dtc-field', style: { flex: 1 } },
            h('span', null, t('minReplyChars')),
            h('input', {
              className: 'dtc-input',
              type: 'number',
              min: 0,
              value: form.minReplyChars ?? 120,
              onChange: (event) => patch('minReplyChars', Number(event.target.value)),
            }),
          ),
          h(
            'div',
            { className: 'dtc-field', style: { flex: 1 } },
            h('span', null, t('timeoutMs')),
            h('input', {
              className: 'dtc-input',
              type: 'number',
              min: 1000,
              value: form.timeoutMs ?? 60000,
              onChange: (event) => patch('timeoutMs', Number(event.target.value)),
            }),
          ),
        ),
        h('div', { className: 'dtc-field' }, h('span', null, t('systemPrompt'))),
        h('textarea', {
          className: 'dtc-textarea',
          value: form.systemPrompt || '',
          onChange: (event) => patch('systemPrompt', event.target.value),
        }),
        h(
          'div',
          { className: 'dtc-row' },
          h(
            'button',
            {
              className: 'dtc-save',
              disabled: busy,
              onClick: async () => {
                await onSave(form)
                setSaved(true)
              },
            },
            busy ? t('saving') : t('save'),
          ),
          saved ? h('span', { className: 'dtc-hint' }, t('saved')) : null,
        ),
      )
    }

    function Panel({ t, uiWorkspace }) {
      const [tab, setTab] = useState('cards')
      const [cards, setCards] = useState([])
      const [settings, setSettings] = useState(null)
      const [models, setModels] = useState(null)
      const [warning, setWarning] = useState('')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [loading, setLoading] = useState(true)
      const [draft, setDraft] = useState('')
      const [titles, setTitles] = useState({})
      const [detail, setDetail] = useState(null)

      const loadCards = useCallback(async (soft) => {
        if (!soft) setLoading(true)
        try {
          const body = await call(`${API}/cards`)
          setCards(body.cards || [])
          setWarning(body.warning || '')
        } catch (err) {
          setError(err.message || String(err))
        } finally {
          if (!soft) setLoading(false)
        }
      }, [])

      const loadTab = useCallback(async (name) => {
        setError('')
        try {
          if (name === 'settings') {
            const [settingsBody, modelsBody] = await Promise.all([
              call(`${API}/settings`),
              call(`${API}/models`).catch(() => ({ groups: [] })),
            ])
            setSettings(settingsBody.settings)
            setModels(modelsBody)
          }
        } catch (err) {
          setError(err.message || String(err))
        }
      }, [])

      // 面板在线心跳：宿主据此决定提问由卡片作答（原生返回），还是交回聊天里的提问 UI。
      useEffect(() => {
        let alive = true
        const ping = () => {
          if (!alive) return
          fetch(`${API}/presence`, { method: 'POST' }).catch(() => {})
        }
        ping()
        const timer = setInterval(ping, 20000)
        return () => {
          alive = false
          clearInterval(timer)
          // 面板关掉：宿主会把还挂着的提问交回聊天里的提问 UI
          fetch(`${API}/presence`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ active: false }),
          }).catch(() => {})
        }
      }, [])

      useEffect(() => {
        loadCards()
      }, [loadCards])

      // 树的外层要显示会话标题：只在缺的时候批量补一次。
      const sessionIds = useMemo(() => {
        const ids = new Set()
        for (const card of cards) {
          const sid = card.origin && card.origin.sessionId
          if (sid) ids.add(sid)
        }
        return [...ids]
      }, [cards])

      useEffect(() => {
        const missing = sessionIds.filter((id) => titles[id] === undefined)
        if (!missing.length) return
        call(`${API}/titles?ids=${encodeURIComponent(missing.join(','))}`)
          .then((body) => setTitles((prev) => ({ ...prev, ...(body.titles || {}) })))
          .catch(() => {})
      }, [sessionIds, titles])

      const onOpenSession = useCallback(
        (sessionId) => {
          try {
            if (uiWorkspace && typeof uiWorkspace.openSession === 'function') uiWorkspace.openSession(sessionId)
          } catch (err) {}
        },
        [],
      )

      const openDetail = useCallback(async (target) => {
        const sessionId = target.sessionId || (target.card && target.card.origin && target.card.origin.sessionId) || ''
        const card = target.card || null
        setDetail({ sessionId, card, title: target.title || (card && card.title) || '', loading: true, turns: [] })
        if (!sessionId) {
          setDetail({ sessionId: '', card, title: target.title || (card && card.title) || '', loading: false, turns: [] })
          return
        }
        try {
          const body = await call(`${API}/timeline?id=${encodeURIComponent(sessionId)}`)
          setDetail({ sessionId, card, title: body.title || target.title || '', loading: false, turns: body.turns || [] })
        } catch (err) {
          setDetail({ sessionId, card, title: target.title || '', loading: false, turns: [], error: err.message || String(err) })
        }
      }, [])

      // 卡片页 5 秒轻刷：观察者在别的会话结束后写卡，扫描器还会改状态。
      useEffect(() => {
        if (tab !== 'cards') return undefined
        const timer = setInterval(() => loadCards(true), 5000)
        return () => clearInterval(timer)
      }, [tab, loadCards])

      useEffect(() => {
        loadTab(tab)
      }, [tab, loadTab])

      const add = useCallback(async () => {
        const title = draft.trim()
        if (!title || busy) return
        setBusy(true)
        setError('')
        try {
          const body = await call(`${API}/cards`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title }),
          })
          setCards((prev) => [body.card, ...prev])
          setDraft('')
        } catch (err) {
          setError(err.message || String(err))
        } finally {
          setBusy(false)
        }
      }, [draft, busy])

      const onAction = useCallback(
        async (card, action, option) => {
          setBusy(true)
          setError('')
          try {
            const body = await call(`${API}/action`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: card.id, action, ...(option ? { option } : {}) }),
            })
            if (action === 'delete') setCards((prev) => prev.filter((item) => item.id !== card.id))
            else if (body.card) setCards((prev) => prev.map((item) => (item.id === card.id ? body.card : item)))
            else await loadCards(true)
            return { action, card: body.card || null }
          } catch (err) {
            setError(err.message || String(err))
          } finally {
            setBusy(false)
          }
        },
        [loadCards],
      )

      const onAnswer = useCallback(
        (card, option) => onAction(card, 'answer', option),
        [onAction],
      )

      const saveSettings = useCallback(async (next) => {
        setBusy(true)
        setError('')
        try {
          const body = await call(`${API}/settings`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ settings: next }),
          })
          setSettings(body.settings)
        } catch (err) {
          setError(err.message || String(err))
        } finally {
          setBusy(false)
        }
      }, [])

      const groups = useMemo(() => groupCards(cards), [cards])

      return h(
        'div',
        { className: 'dtc-page' },
        h(
          'div',
          { className: 'dtc-head' },
          h(
            'div',
            null,
            h('div', { className: 'dtc-eyebrow' }, t('eyebrow')),
            h('h1', { className: 'dtc-title' }, t('title')),
            h('div', { className: 'dtc-sub' }, t('subtitle')),
          ),
          h('div', { className: 'dtc-spacer' }),
          h('button', { className: 'dtc-btn', onClick: () => (tab === 'cards' ? loadCards() : loadTab(tab)) }, t('refresh')),
        ),
        h(
          'div',
          { className: 'dtc-kpis' },
          h(
            'div',
            { className: 'dtc-kpi is-decision' },
            h('div', { className: 'dtc-kpi-label' }, t('kpiDecision')),
            h('div', { className: 'dtc-kpi-value' }, String(groups.decision.length)),
          ),
          h(
            'div',
            { className: 'dtc-kpi' },
            h('div', { className: 'dtc-kpi-label' }, t('kpiInfo')),
            h('div', { className: 'dtc-kpi-value' }, String(groups.info.length)),
          ),
          h(
            'div',
            { className: 'dtc-kpi is-auto' },
            h('div', { className: 'dtc-kpi-label' }, t('kpiAuto')),
            h('div', { className: 'dtc-kpi-value' }, String(groups.auto.length)),
          ),
          h(
            'div',
            { className: 'dtc-kpi' },
            h('div', { className: 'dtc-kpi-label' }, t('kpiClosed')),
            h('div', { className: 'dtc-kpi-value' }, String(groups.closed.length)),
          ),
        ),
        h(
          'div',
          { className: 'dtc-tabs' },
          h('button', { className: `dtc-tab${tab === 'cards' ? ' is-active' : ''}`, onClick: () => setTab('cards') }, t('tabCards')),
          h('button', { className: `dtc-tab${tab === 'settings' ? ' is-active' : ''}`, onClick: () => setTab('settings') }, t('tabSettings')),
        ),
        error ? h('div', { className: 'dtc-banner' }, h('span', null, error)) : null,
        detail
          ? h(DetailModal, {
              t,
              detail,
              busy,
              onAction: async (card, action, option) => {
                const outcome = await onAction(card, action, option)
                if (action === 'delete') {
                  setDetail(null)
                  return
                }
                if (outcome && outcome.card) {
                  setDetail((prev) => (prev && prev.card && prev.card.id === card.id ? { ...prev, card: outcome.card } : prev))
                }
              },
              onClose: () => setDetail(null),
              onOpenSession,
            })
          : null,
        warning ? h('div', { className: 'dtc-banner' }, warning) : null,
        tab === 'cards'
          ? h(CardsTab, {
              t,
              cards,
              busy,
              draft,
              setDraft,
              add,
              onAction,
              onAnswer,
              loading,
              titles,
              onDetail: openDetail,
              onOpenSession,
            })
            : h(SettingsTab, { t, settings, models, onSave: saveSettings, busy }),
      )
    }

    function PanelIcon({ size = 18 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('rect', { x: 4, y: 4, width: 16, height: 16, rx: 3 }),
        h('path', { d: 'M8 9.5h8' }),
        h('path', { d: 'M8 13h5' }),
        h('path', { d: 'M8 16.5h3' }),
      )
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'dsh-task-cards: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 18, locale: NS, label: () => t('nav') },
            (owner = {}) => h(PanelIcon, { size: owner.size ?? 18 }),
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t, uiWorkspace: ctx.uiWorkspace }) }, Panel),
        )

        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-task-cards'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => {
            try {
              tag.remove()
            } catch (err) {}
          }
        }, 'dsh-task-cards: styles')
      },
    }
  },
})
