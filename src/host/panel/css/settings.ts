// 面板样式（设置六组 + 会话屏样式。）
//
// 由宿主作为静态资源提供（GET {{API_PREFIX}}/css），不进客户端 bundle：
// 样式是文本资产，跟着 JS 一起发只会把 150KB 的预算吃掉三分之一。
// 面板通过 <link> 挂上来，宿主卸载路由即失效。

export const SETTINGS_CSS = `
.dtc-set { display: flex; flex-direction: column; gap: 12px; padding-bottom: 8px; }
.dtc-set-group { display: flex; flex-direction: column; gap: 9px; padding: 13px 15px;
  border: 1px solid var(--dtc-line); border-radius: 10px; background: var(--dtc-surface); }
.dtc-set-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.dtc-set-title { margin: 0; font: 600 13px/1.3 ui-sans-serif, system-ui, sans-serif; color: var(--dtc-ink); }
.dtc-set-badge { font-size: 10.5px; line-height: 17px; padding: 0 7px; border-radius: 999px;
  color: var(--dtc-muted); border: 1px dashed var(--dtc-line); }
.dtc-set-note { margin: 0; font-size: 11.5px; line-height: 1.6; color: var(--dtc-muted); }
.dtc-set-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.dtc-set-label { font-size: 12.5px; font-weight: 600; color: var(--dtc-ink); }
.dtc-set-toggle { display: flex; flex-direction: column; gap: 3px; }
.dtc-set-check { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.dtc-set-check input { margin: 0; flex: none; }
.dtc-set-input { box-sizing: border-box; padding: 6px 9px; border-radius: 7px; font-size: 12.5px;
  color: var(--dtc-ink); background: var(--dtc-surface); border: 1px solid var(--dtc-line); }
.dtc-set-input:focus { outline: none; border-color: var(--dtc-primary); }
.dtc-set-num { width: 132px; font-family: ui-monospace, Menlo, monospace; }
.dtc-set-prompt { box-sizing: border-box; width: 100%; min-height: 84px; resize: vertical;
  padding: 8px 10px; border-radius: 7px; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--dtc-ink); background: var(--dtc-surface); border: 1px solid var(--dtc-line); }
.dtc-set-prompt:focus { outline: none; border-color: var(--dtc-primary); }
.dtc-set-static { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.dtc-set-static-item { display: flex; align-items: baseline; gap: 7px; font-size: 12px;
  line-height: 1.55; color: var(--dtc-ink); }
.dtc-set-static-item::before { content: ''; width: 5px; height: 5px; border-radius: 50%; flex: none;
  background: var(--dtc-faint); transform: translateY(-2px); }
.dtc-set-group.is-danger { border-color: var(--dtc-danger); }
.dtc-set-group.is-danger .dtc-set-title { color: var(--dtc-danger); }
.dtc-set-danger-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding-top: 8px; border-top: 1px dashed var(--dtc-line); }
.dtc-set-danger-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 200px; }
.dtc-set-danger-btn { padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;
  cursor: pointer; color: var(--dtc-danger); background: var(--dtc-surface);
  border: 1px solid var(--dtc-danger); }
.dtc-set-danger-btn.is-confirm { color: var(--dtc-surface); background: var(--dtc-danger); }
.dtc-set-danger-btn:disabled { opacity: .45; cursor: default; }
.dtc-set-cancel { padding: 5px 9px; border-radius: 6px; font-size: 12px; cursor: pointer;
  color: var(--dtc-muted); background: var(--dtc-surface); border: 1px solid var(--dtc-line); }
.dtc-set-savebar { position: sticky; bottom: 0; z-index: 2; display: flex; align-items: center; gap: 10px;
  padding: 10px 0 6px; background: var(--dtc-bg); border-top: 1px solid var(--dtc-line); }
.dtc-set-state { font-size: 11.5px; color: var(--dtc-warn, #D97706); }
.dtc-set-savebar .dtc-save { margin-left: auto; }
.dtc-ses { display: flex; flex-direction: column; gap: 12px; }
.dtc-ses-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dtc-ses-label { font-size: 12px; color: var(--dtc-muted); }
.dtc-ses-select { max-width: 360px; }
.dtc-ses-stat { font: 11.5px/1.4 ui-monospace, Menlo, monospace; color: var(--dtc-faint); }
.dtc-ses-note { margin: 0; font-size: 12px; line-height: 1.65; color: var(--dtc-muted); }
.dtc-ses-timeline { position: relative; display: flex; flex-direction: column; gap: 15px;
  padding-left: 20px; }
.dtc-ses-timeline::before { content: ''; position: absolute; left: 5px; top: 4px; bottom: 4px;
  width: 1px; background: var(--dtc-line); }
.dtc-ses-turn { position: relative; display: flex; flex-direction: column; gap: 7px; }
.dtc-ses-turn::before { content: ''; position: absolute; left: -18px; top: 5px; width: 7px; height: 7px;
  border-radius: 50%; background: var(--dtc-surface); border: 2px solid var(--dtc-primary); }
.dtc-ses-turn-head { display: flex; align-items: baseline; gap: 8px; font-size: 11px; color: var(--dtc-faint); }
.dtc-ses-turn-head b { font-weight: 600; color: var(--dtc-muted); }
.dtc-ses-msg { display: flex; flex-direction: column; gap: 3px; }
.dtc-ses-role { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--dtc-faint); }
.dtc-ses-text { margin: 0; padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word; color: var(--dtc-ink);
  background: var(--dtc-surface); border: 1px solid var(--dtc-line); }
.dtc-ses-text.is-user { background: var(--dtc-raise); color: var(--dtc-text); }
.dtc-ses-clamp { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.dtc-ses-card { box-sizing: border-box; width: 100%; display: flex; flex-direction: column; gap: 4px;
  margin-top: 2px; padding: 9px 11px; text-align: left; font-family: inherit; cursor: pointer;
  border: 1px solid var(--dtc-line); border-radius: 9px; background: var(--dtc-raise); }
.dtc-ses-card:hover { border-color: var(--dtc-primary); }
.dtc-ses-card-head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.dtc-ses-chip { font-size: 10.5px; line-height: 17px; padding: 0 6px; border-radius: 5px;
  border: 1px solid var(--dtc-line); color: var(--dtc-muted); }
.dtc-ses-chip.is-wait { color: #8a5300; background: #fdf5e7; border-color: #ecd8b0; }
.dtc-ses-chip.is-run { color: #1746a8; background: #eaf0fd; border-color: #c7d7f8; }
.dtc-ses-chip.is-ok { color: #136c3b; background: #e9f6ee; border-color: #bfe2cd; }
.dtc-ses-chip.is-fail { color: #b0251c; background: #fdeeec; border-color: #f3c8c2; }
.dtc-ses-chip.is-unknown { color: #55489b; background: #efedfa; border-color: #d6d1ef; }
.dtc-ses-chip.is-neutral { color: #3f4650; background: #eef0f2; border-color: #d8dce1; }
.dtc-ses-node-title { min-width: 0; font-size: 12.5px; font-weight: 600; color: var(--dtc-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dtc-ses-wait { font-size: 11.5px; color: var(--dtc-warn, #D97706); }
.dtc-ses-detail { font-size: 11.5px; line-height: 1.55; color: var(--dtc-muted); }
.dtc-ses-meta { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap;
  font-size: 11px; color: var(--dtc-faint); }
.dtc-ses-trace { font: 11px/1.3 ui-monospace, Menlo, monospace; }
.dtc-ses-other-head { margin: 2px 0 0; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
  color: var(--dtc-faint); }
body[data-ds-dark-theme] .dtc-set-savebar { background: var(--dtc-bg); }
body[data-ds-dark-theme] .dtc-set-danger-btn.is-confirm { color: #0B1220; }
body[data-ds-dark-theme] .dtc-ses-chip.is-wait { color: #e3ae63; background: rgba(227,174,99,.13); border-color: rgba(227,174,99,.3); }
body[data-ds-dark-theme] .dtc-ses-chip.is-run { color: #8fb0ff; background: rgba(143,176,255,.13); border-color: rgba(143,176,255,.3); }
body[data-ds-dark-theme] .dtc-ses-chip.is-ok { color: #63d18e; background: rgba(99,209,142,.13); border-color: rgba(99,209,142,.3); }
body[data-ds-dark-theme] .dtc-ses-chip.is-fail { color: #ff8b82; background: rgba(255,139,130,.13); border-color: rgba(255,139,130,.3); }
body[data-ds-dark-theme] .dtc-ses-chip.is-unknown { color: #b5a9f0; background: rgba(181,169,240,.13); border-color: rgba(181,169,240,.3); }
body[data-ds-dark-theme] .dtc-ses-chip.is-neutral { color: #a9b1bb; background: rgba(169,177,187,.12); border-color: rgba(169,177,187,.28); }
`
