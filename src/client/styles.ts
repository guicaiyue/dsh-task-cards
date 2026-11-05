// 面板样式：本页自带的 CSS 变量，深色主题一组覆盖（DSH 在 body[data-ds-dark-theme] 上切）。
//
// 不用 CSS-in-JS 库：一个 <style> 标签就够，卸载时摘掉即可。

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
.dtc-tree-caret { cursor: pointer; width: 16px; color: var(--dtc-muted); font-size: 11px; user-select: none;
  background: none; border: none; padding: 0; font-family: inherit; }
.dtc-tree-title { font-size: 13px; font-weight: 600; color: var(--dtc-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;
  background: none; border: none; padding: 0; text-align: left; cursor: pointer; font-family: inherit; }
.dtc-tree-meta { font-size: 11px; color: var(--dtc-faint); white-space: nowrap; }
.dtc-tree-pending { font-size: 11px; color: var(--dtc-accent); border: 1px solid var(--dtc-accent); border-radius: 999px; padding: 1px 7px; white-space: nowrap; }
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

/** 注入样式；返回卸载函数。重复调用只会留一个 <style>。 */
export function injectStyles(): () => void {
  const existing = document.querySelector('style[data-plugin="dsh-task-cards"]')
  if (existing) existing.remove()
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-task-cards'
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => {
    try {
      tag.remove()
    } catch {
      /* 已经摘掉 */
    }
  }
}

export { CSS }
