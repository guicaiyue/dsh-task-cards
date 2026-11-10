// 面板样式（失败排查 + 策略模板样式。）
//
// 由宿主作为静态资源提供（GET {{API_PREFIX}}/css），不进客户端 bundle：
// 样式是文本资产，跟着 JS 一起发只会把 150KB 的预算吃掉三分之一。
// 面板通过 <link> 挂上来，宿主卸载路由即失效。

export const FAILURE_CSS = `
.dtc-fail { display:flex; flex-direction:column; gap:12px; min-width:0; }
.dtc-fail-head { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
.dtc-fail-title { font:600 12px/1 ui-sans-serif,system-ui,sans-serif; letter-spacing:.08em; text-transform:uppercase; color:var(--dtc-muted); }
.dtc-fail-count { font:500 12px/1 ui-monospace,Menlo,monospace; color:var(--dtc-faint); }
.dtc-fail-hint { font-size:11.5px; color:var(--dtc-faint); }
.dtc-fail-empty { margin:12px 0 0; font-size:13px; color:var(--dtc-ink); }
.dtc-fail-body { display:grid; grid-template-columns:minmax(220px,300px) minmax(0,1fr); gap:14px; align-items:start; }
@media (max-width:860px) { .dtc-fail-body { grid-template-columns:minmax(0,1fr); } }
.dtc-fail-list { list-style:none; margin:0; padding:0; border:1px solid var(--dtc-line); border-radius:10px; background:var(--dtc-surface); overflow:hidden; }
.dtc-fail-item { display:flex; flex-direction:column; gap:3px; width:100%; padding:9px 11px; border:0; border-bottom:1px solid var(--dtc-line); background:transparent; text-align:left; cursor:pointer; color:inherit; font:inherit; }
.dtc-fail-list li:last-child .dtc-fail-item { border-bottom:0; }
.dtc-fail-item:hover { background:var(--dtc-raise); }
.dtc-fail-item.is-active { background:var(--dtc-primary-soft); box-shadow:inset 2px 0 0 var(--dtc-primary); }
.dtc-fail-item-top { display:flex; align-items:flex-start; gap:6px; }
.dtc-fail-badge { flex:none; padding:0 5px; border-radius:4px; border:1px solid var(--dtc-danger); color:var(--dtc-danger); background:#FEF2F2; font:600 10.5px/1.6 ui-sans-serif,system-ui,sans-serif; }
.dtc-fail-badge.is-unknown { color:#6D5DA8; border-color:#B9AEDF; background:#F4F1FB; }
body[data-ds-dark-theme] .dtc-fail-badge { background:#2A1417; }
body[data-ds-dark-theme] .dtc-fail-badge.is-unknown { color:#C4B5FD; border-color:#4C3F7A; background:#241E3A; }
.dtc-fail-item-title { font-size:12.5px; font-weight:600; color:var(--dtc-ink); overflow-wrap:anywhere; }
.dtc-fail-item-wait { font-size:11px; color:var(--dtc-warn,#D97706); }
.dtc-fail-item-foot { display:flex; align-items:center; gap:8px; }
.dtc-fail-trace { font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--dtc-muted); }
.dtc-fail-item-time { margin-left:auto; font:11px/1.4 ui-sans-serif,system-ui,sans-serif; color:var(--dtc-faint); }
.dtc-fail-conclusion { display:flex; flex-direction:column; gap:5px; padding:10px 12px; border:1px solid var(--dtc-line); border-left:3px solid var(--dtc-danger); border-radius:10px; background:var(--dtc-surface); }
.dtc-fail-conclusion.is-unknown { border-left-color:#8B7BC0; }
.dtc-fail-conclusion-top { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
.dtc-fail-verdict { font-size:13px; font-weight:700; color:var(--dtc-danger); }
.dtc-fail-conclusion.is-unknown .dtc-fail-verdict { color:#6D5DA8; }
body[data-ds-dark-theme] .dtc-fail-conclusion.is-unknown .dtc-fail-verdict { color:#C4B5FD; }
.dtc-fail-meta { font-size:11.5px; color:var(--dtc-muted); display:inline-flex; flex-wrap:wrap; gap:6px; }
.dtc-fail-reason { margin:0; font-size:12px; color:var(--dtc-ink); line-height:1.55; overflow-wrap:anywhere; }
.dtc-fail-next { margin:0; font-size:11.5px; color:var(--dtc-warn,#D97706); }
.dtc-fail-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:3px; }
.dtc-fail-btn { padding:5px 10px; border-radius:6px; font-size:12px; cursor:pointer; border:1px solid var(--dtc-border); color:var(--dtc-text); background:var(--dtc-surface); }
.dtc-fail-btn:hover:not(:disabled) { background:var(--dtc-raise); }
.dtc-fail-btn:disabled { opacity:.5; cursor:default; }
.dtc-fail-btn.is-primary { border-color:var(--dtc-primary); color:var(--dtc-primary); }
.dtc-fail-cols { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; min-width:0; }
@media (max-width:1040px) { .dtc-fail-cols { grid-template-columns:minmax(0,1fr); } }
.dtc-fail-col { display:flex; flex-direction:column; gap:7px; min-width:0; padding:10px 12px; border:1px solid var(--dtc-line); border-radius:10px; background:var(--dtc-surface); }
.dtc-fail-col-h { margin:0; font:600 10.5px/1.4 ui-sans-serif,system-ui,sans-serif; letter-spacing:.06em; text-transform:uppercase; color:var(--dtc-faint); }
.dtc-fail-lead { font-size:12.5px; font-weight:600; color:var(--dtc-ink); overflow-wrap:anywhere; }
.dtc-fail-text { margin:0; font-size:12px; color:var(--dtc-ink); line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere; }
.dtc-fail-field { display:flex; gap:6px; font-size:11.5px; }
.dtc-fail-field-label { flex:none; color:var(--dtc-faint); }
.dtc-fail-mono { font:11.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--dtc-ink); white-space:pre-wrap; overflow-wrap:anywhere; }
.dtc-fail-evi,.dtc-fail-verify { display:flex; flex-direction:column; gap:3px; padding-top:6px; border-top:1px dashed var(--dtc-line); }
.dtc-fail-col>.dtc-fail-evi:first-of-type,.dtc-fail-col>.dtc-fail-verify:first-of-type { padding-top:0; border-top:0; }
.dtc-fail-evi-head { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
.dtc-fail-ok,.dtc-fail-bad { font-size:10.5px; padding:0 4px; border-radius:4px; border:1px solid currentColor; }
.dtc-fail-ok { color:var(--dtc-success); }
.dtc-fail-bad { color:var(--dtc-danger); }
.dtc-fail-dur { margin-left:auto; font:10.5px/1.4 ui-monospace,Menlo,monospace; color:var(--dtc-faint); }
.dtc-fail-note { margin:0; font-size:11.5px; color:var(--dtc-faint); line-height:1.5; }
.dtc-pol { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(280px,1fr); gap:14px; align-items:start; }
@media (max-width:1000px) { .dtc-pol { grid-template-columns:minmax(0,1fr); } }
.dtc-pol-col { display:flex; flex-direction:column; gap:10px; min-width:0; }
.dtc-pol-card { display:flex; flex-direction:column; gap:9px; padding:12px 14px; border:1px solid var(--dtc-line); border-radius:10px; background:var(--dtc-surface); }
.dtc-pol-h { margin:0; font:600 12px/1.3 ui-sans-serif,system-ui,sans-serif; letter-spacing:.06em; text-transform:uppercase; color:var(--dtc-muted); }
.dtc-pol-sub { margin:0; font-size:11.5px; color:var(--dtc-faint); line-height:1.5; }
.dtc-pol-tpl-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:10px; }
.dtc-pol-tpl { display:flex; flex-direction:column; gap:6px; padding:10px 11px; border:1px solid var(--dtc-line); border-radius:9px; background:var(--dtc-raise); }
.dtc-pol-tpl-head { display:flex; align-items:center; gap:7px; }
.dtc-pol-kind { font:600 10.5px/1.6 ui-monospace,Menlo,monospace; color:var(--dtc-primary); border:1px solid var(--dtc-border); border-radius:4px; padding:0 4px; }
.dtc-pol-tpl-name { font-size:12.5px; font-weight:600; color:var(--dtc-ink); }
.dtc-pol-tpl-field { margin:0; font-size:11.5px; color:var(--dtc-ink); line-height:1.5; }
.dtc-pol-tpl-label { color:var(--dtc-faint); }
.dtc-pol-timeout { font:10.5px/1.4 ui-monospace,Menlo,monospace; color:var(--dtc-faint); }
.dtc-pol-layers { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
.dtc-pol-layer { display:flex; align-items:baseline; gap:8px; font-size:11.5px; color:var(--dtc-ink); }
.dtc-pol-layer-name { flex:none; width:74px; font:600 11px/1.5 ui-monospace,Menlo,monospace; }
.dtc-pol-layer.is-ok .dtc-pol-layer-name { color:var(--dtc-success); }
.dtc-pol-layer.is-fail .dtc-pol-layer-name { color:var(--dtc-danger); }
.dtc-pol-layer.is-unknown .dtc-pol-layer-name { color:#6D5DA8; }
body[data-ds-dark-theme] .dtc-pol-layer.is-unknown .dtc-pol-layer-name { color:#C4B5FD; }
.dtc-pol-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
@media (max-width:620px) { .dtc-pol-fields { grid-template-columns:minmax(0,1fr); } }
.dtc-pol-field { display:flex; flex-direction:column; gap:4px; }
.dtc-pol-label { font-size:11.5px; color:var(--dtc-muted); }
.dtc-pol-input { width:100%; box-sizing:border-box; padding:6px 8px; border-radius:7px; font:12px/1.4 ui-monospace,Menlo,monospace; color:var(--dtc-ink); background:var(--dtc-surface); border:1px solid var(--dtc-border); outline:none; }
.dtc-pol-input:focus { border-color:var(--dtc-primary); }
.dtc-pol-checks { display:flex; flex-direction:column; gap:8px; }
.dtc-pol-check { display:flex; align-items:flex-start; gap:7px; font-size:12px; color:var(--dtc-ink); cursor:pointer; }
.dtc-pol-check input { flex:none; margin:2px 0 0; }
.dtc-pol-check-hint { display:block; margin-top:2px; font-size:11px; color:var(--dtc-faint); line-height:1.5; }
.dtc-pol-save-row { display:flex; align-items:center; gap:9px; }
.dtc-pol-save { padding:7px 14px; border-radius:8px; font-size:12.5px; font-weight:600; cursor:pointer; border:1px solid var(--dtc-primary); color:#FFFFFF; background:var(--dtc-primary); }
.dtc-pol-save:disabled { opacity:.45; cursor:default; }
.dtc-pol-loading { margin:10px 0; font-size:12px; color:var(--dtc-muted); }
`
