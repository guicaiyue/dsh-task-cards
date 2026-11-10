// 面板样式（记录屏样式。）
//
// 由宿主作为静态资源提供（GET {{API_PREFIX}}/css），不进客户端 bundle：
// 样式是文本资产，跟着 JS 一起发只会把 150KB 的预算吃掉三分之一。
// 面板通过 <link> 挂上来，宿主卸载路由即失效。

export const RECORDS_CSS = `
.dtc-rec { display: flex; flex-direction: column; gap: 8px; }
.dtc-rec-head { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dtc-muted); }
.dtc-rec-hint { color: var(--dtc-faint); }
.dtc-rec-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.dtc-rec-row { display: flex; align-items: center; gap: 9px; padding: 7px 10px;
  background: var(--dtc-surface); border: 1px solid var(--dtc-line); border-radius: 8px; }
.dtc-rec-time { font: 11px/1 ui-monospace, Menlo, monospace; color: var(--dtc-faint); flex: none; }
.dtc-rec-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.dtc-rec-title { font-size: 12.5px; font-weight: 600; color: var(--dtc-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dtc-rec-reason { font-size: 11.5px; color: var(--dtc-muted); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.dtc-rec-trace { font: 11px/1.4 ui-monospace, Menlo, monospace; color: var(--dtc-faint); flex: none; }
.dtc-rec-empty { margin: 8px 0; font-size: 12px; color: var(--dtc-muted); }
`
