// 面板样式（案卷样式：清单、证据、验收结论。）
//
// 由宿主作为静态资源提供（GET {{API_PREFIX}}/css），不进客户端 bundle：
// 样式是文本资产，跟着 JS 一起发只会把 150KB 的预算吃掉三分之一。
// 面板通过 <link> 挂上来，宿主卸载路由即失效。

export const CASE_CSS = `
.dtc-case { border: 1px solid var(--dtc-line); border-radius: 10px; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 7px; background: var(--dtc-surface); }
.dtc-case-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dtc-case-reason { font-size: 11.5px; color: var(--dtc-danger); }
.dtc-case-progress { margin-left: auto; font: 600 11.5px/1 ui-monospace, Menlo, monospace; color: var(--dtc-muted); }
.dtc-case-h { margin: 2px 0 0; font-size: 11px; letter-spacing: .04em; color: var(--dtc-faint); text-transform: uppercase; }
.dtc-case-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.dtc-case-item { display: flex; align-items: center; gap: 7px; font-size: 12px; flex-wrap: wrap; }
.dtc-case-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--dtc-faint); }
.dtc-case-item.is-done .dtc-case-dot { background: var(--dtc-success); }
.dtc-case-item.is-doing .dtc-case-dot { background: var(--dtc-primary); }
.dtc-case-item.is-blocked .dtc-case-dot { background: var(--dtc-danger); }
.dtc-case-item.is-skipped .dtc-case-dot { background: var(--dtc-warn, #D97706); }
.dtc-case-text { color: var(--dtc-ink); }
.dtc-case-tag { font-size: 10.5px; color: var(--dtc-danger); border: 1px solid var(--dtc-danger);
  border-radius: 4px; padding: 0 4px; }
.dtc-case-tag.is-warn { color: var(--dtc-warn, #D97706); border-color: var(--dtc-warn, #D97706); }
.dtc-case-evi { margin-left: auto; font: 11px/1.3 ui-monospace, Menlo, monospace; color: var(--dtc-faint); }
.dtc-case-empty { margin: 0; font-size: 11.5px; color: var(--dtc-faint); }
.dtc-chip.is-ok { color: var(--dtc-success); border-color: var(--dtc-success); }
.dtc-chip.is-progress { color: var(--dtc-muted); border-color: var(--dtc-line);
  font: 600 10.5px/1.4 ui-monospace, Menlo, monospace; }
`
