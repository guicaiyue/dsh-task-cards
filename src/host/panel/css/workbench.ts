// 面板样式（工作台样式：五格 KPI、过滤条、会话分组、阶段徽标。）
//
// 由宿主作为静态资源提供（GET {{API_PREFIX}}/css），不进客户端 bundle：
// 样式是文本资产，跟着 JS 一起发只会把 150KB 的预算吃掉三分之一。
// 面板通过 <link> 挂上来，宿主卸载路由即失效。

export const WORKBENCH_CSS = `
.dtc-wb { display: flex; flex-direction: column; gap: 12px; }
.dtc-paused { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 8px;
  font-size: 12px; color: var(--dtc-accent); background: var(--dtc-accent-soft); border: 1px solid var(--dtc-accent); }
.dtc-kpis.is-five { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.dtc-kpi.is-wait .dtc-kpi-value { color: #B45309; }
.dtc-kpi.is-run .dtc-kpi-value { color: var(--dtc-primary); }
.dtc-kpi.is-unknown .dtc-kpi-value { color: #6D28D9; }
.dtc-kpi.is-fail .dtc-kpi-value { color: var(--dtc-danger); }
.dtc-kpi-detail { font-size: 11px; color: var(--dtc-faint); }
.dtc-filterbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dtc-viewtoggle { display: flex; gap: 0; border: 1px solid var(--dtc-line); border-radius: 999px; overflow: hidden; margin-right: 4px; }
.dtc-viewtoggle .dtc-filter { border: none; border-radius: 0; }
.dtc-filter { border: 1px solid var(--dtc-line); background: var(--dtc-surface); color: var(--dtc-muted);
  border-radius: 999px; font-size: 12px; padding: 3px 10px; cursor: pointer; white-space: nowrap; }
.dtc-filter.is-on { background: var(--dtc-ink); border-color: var(--dtc-ink); color: var(--dtc-surface); font-weight: 600; }
.dtc-filter-count { margin-left: 5px; font: 600 10.5px/1 ui-monospace, Menlo, monospace; opacity: .75; }
.dtc-groups { display: flex; flex-direction: column; gap: 12px; }
.dtc-group { border: 1px solid var(--dtc-line); border-radius: 10px; background: var(--dtc-surface); overflow: hidden; }
.dtc-group-head { display: flex; align-items: center; gap: 9px; padding: 8px 12px; background: var(--dtc-raise); }
.dtc-group-caret { background: none; border: none; padding: 0; width: 14px; cursor: pointer; color: var(--dtc-muted); font-size: 11px; }
.dtc-group-id { font: 600 11px/1 ui-monospace, Menlo, monospace; color: var(--dtc-faint); }
.dtc-group-title { flex: 1; min-width: 0; background: none; border: none; padding: 0; text-align: left; cursor: pointer;
  font: 600 12.5px/1.4 ui-sans-serif, system-ui, sans-serif; color: var(--dtc-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dtc-group-meta { font-size: 11px; color: var(--dtc-faint); white-space: nowrap; }
.dtc-groups .dtc-cards { padding: 8px; gap: 8px; }
.dtc-rowchips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.dtc-stage { border: 1px solid transparent; border-radius: 5px; font-size: 11px; padding: 0 6px; line-height: 18px; white-space: nowrap; }
.dtc-stage.is-wait { color: #8A5300; background: #FDF5E7; border-color: #ECD8B0; }
.dtc-stage.is-run { color: #1746A8; background: #EAF0FD; border-color: #C7D7F8; }
.dtc-stage.is-ok { color: #136C3B; background: #E9F6EE; border-color: #BFE2CD; }
.dtc-stage.is-fail { color: #B0251C; background: #FDEEEC; border-color: #F3C8C2; }
.dtc-stage.is-unknown { color: #55489B; background: #EFEDFA; border-color: #D6D1EF; }
.dtc-stage.is-neutral { color: #3F4650; background: #EEF0F2; border-color: #D8DCE1; }
.dtc-wait { color: #8A5300; font-size: 11px; }
.dtc-tag { font-size: 10.5px; border: 1px solid var(--dtc-line); border-radius: 4px; padding: 0 5px; color: var(--dtc-muted); text-transform: lowercase; }
.dtc-tag.is-neutral { color: var(--dtc-faint); }
.dtc-mono { font: 11px/1.4 ui-monospace, Menlo, monospace; color: var(--dtc-faint); }
.dtc-authority { color: var(--dtc-muted); font-size: 11px; }
.dtc-trace { font: 11px/1.4 ui-monospace, Menlo, monospace; color: var(--dtc-faint); }
.dtc-card-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 6px; font-size: 11px; color: var(--dtc-faint); }
.dtc-card.is-wait .dtc-rail { background: #D9A441; }
.dtc-card.is-run .dtc-rail { background: var(--dtc-primary); }
.dtc-card.is-ok .dtc-rail { background: var(--dtc-success); }
.dtc-card.is-fail .dtc-rail { background: var(--dtc-danger); }
.dtc-card.is-unknown .dtc-rail { background: #8B7BD8; }
.dtc-chip.is-fail { color: var(--dtc-danger); border-color: var(--dtc-danger); }
body[data-ds-dark-theme] .dtc-stage.is-wait { color: #E3AE63; background: rgba(227,174,99,.13); border-color: rgba(227,174,99,.3); }
body[data-ds-dark-theme] .dtc-stage.is-run { color: #8FB0FF; background: rgba(143,176,255,.13); border-color: rgba(143,176,255,.3); }
body[data-ds-dark-theme] .dtc-stage.is-ok { color: #63D18E; background: rgba(99,209,142,.13); border-color: rgba(99,209,142,.3); }
body[data-ds-dark-theme] .dtc-stage.is-fail { color: #FF8B82; background: rgba(255,139,130,.13); border-color: rgba(255,139,130,.3); }
body[data-ds-dark-theme] .dtc-stage.is-unknown { color: #B5A9F0; background: rgba(181,169,240,.13); border-color: rgba(181,169,240,.3); }
body[data-ds-dark-theme] .dtc-stage.is-neutral { color: #A9B1BB; background: rgba(169,177,187,.12); border-color: rgba(169,177,187,.28); }
body[data-ds-dark-theme] .dtc-kpi.is-wait .dtc-kpi-value { color: #E3AE63; }
body[data-ds-dark-theme] .dtc-kpi.is-unknown .dtc-kpi-value { color: #B5A9F0; }
body[data-ds-dark-theme] .dtc-filter.is-on { background: var(--dtc-ink); color: var(--dtc-bg); }
`
