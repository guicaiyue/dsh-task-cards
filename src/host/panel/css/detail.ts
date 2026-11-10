// 面板样式（详情五段样式：段头、键值、事件流。）
//
// 由宿主作为静态资源提供（GET {{API_PREFIX}}/css），不进客户端 bundle：
// 样式是文本资产，跟着 JS 一起发只会把 150KB 的预算吃掉三分之一。
// 面板通过 <link> 挂上来，宿主卸载路由即失效。

export const DETAIL_CSS = `
.dtc-detail { display: flex; flex-direction: column; gap: 12px; }
.dtc-dhead { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.dtc-dtitle { margin: 0; font: 650 17px/1.3 ui-sans-serif, system-ui, sans-serif; color: var(--dtc-ink); }
.dtc-seg { border: 1px solid var(--dtc-line); border-radius: 10px; background: var(--dtc-surface); }
.dtc-seg-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--dtc-line); }
.dtc-seg-title { font: 600 11px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--dtc-muted); }
.dtc-seg-aside { margin-left: auto; font: 11px/1.4 ui-monospace, Menlo, monospace; color: var(--dtc-faint); }
.dtc-seg-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.dtc-kv { margin: 0; display: grid; grid-template-columns: 96px 1fr; gap: 6px 10px; font-size: 12px; }
.dtc-kv dt { color: var(--dtc-muted); }
.dtc-kv dd { margin: 0; color: var(--dtc-ink); overflow-wrap: anywhere; }
.dtc-events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.dtc-event { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.dtc-event-time { font: 11px/1.4 ui-monospace, Menlo, monospace; color: var(--dtc-faint); }
.dtc-event-actor { color: var(--dtc-muted); font-size: 11px; }
.dtc-event-reason { color: var(--dtc-ink); }
`
