/** The panel's CSS. Only the app's CSS custom properties, so it follows the theme. */
export const CSS = `
.phs { display: flex; flex-direction: column; gap: 12px; padding: 4px 2px 8px; color: var(--text); font-size: 12.5px; line-height: 1.45; }
.phs * { box-sizing: border-box; }
.phs-status { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: var(--radius-md, 10px); background: var(--bg-850); border: 1px solid var(--border); }
.phs-dot { flex: none; width: 9px; height: 9px; margin-top: 5px; border-radius: 99px; background: var(--text-faint); }
.phs-status[data-state=online] .phs-dot { background: var(--success, #3ecf8e); box-shadow: 0 0 0 3px color-mix(in srgb, var(--success, #3ecf8e) 22%, transparent); }
.phs-status[data-state=syncing] .phs-dot { background: var(--accent); animation: phs-pulse 1s ease-in-out infinite alternate; }
.phs-status[data-state=offline] .phs-dot, .phs-status[data-state=error] .phs-dot { background: var(--danger, #e5484d); }
@keyframes phs-pulse { from { opacity: .35; } to { opacity: 1; } }
.phs-status-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.phs-status-text b { font-size: 13px; font-weight: 600; }
.phs-status-text span { color: var(--text-muted); font-size: 12px; overflow-wrap: anywhere; }
.phs-facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0; padding: 0 4px; }
.phs-facts dt { color: var(--text-faint); }
.phs-facts dd { margin: 0; color: var(--text); min-width: 0; overflow-wrap: anywhere; }
.phs-error { margin: 0; padding: 10px 12px; border-radius: var(--radius-md, 10px); background: color-mix(in srgb, var(--danger, #e5484d) 12%, transparent); color: var(--text); font-size: 12px; }
.phs-error b { display: block; color: var(--danger, #e5484d); font-weight: 600; margin-bottom: 2px; }
.phs-note { margin: 0; padding: 0 4px; color: var(--text-muted); font-size: 12px; }
.phs-note[data-tone=ok] { color: var(--success, #3ecf8e); }
.phs-note[data-tone=bad] { color: var(--danger, #e5484d); }
.phs-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.phs-btn { height: 30px; padding: 0 12px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 99px; background: var(--bg-850); color: var(--text); font: inherit; font-size: 12.5px; text-decoration: none; cursor: pointer; transition: border-color var(--dur-fast, 120ms), background var(--dur-fast, 120ms); }
.phs-btn:hover:not(:disabled) { border-color: var(--border-strong); background: var(--bg-800); }
.phs-btn:disabled { opacity: .45; cursor: default; }
.phs-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft); }
.phs-btn[data-primary] { background: var(--accent); border-color: var(--accent); color: var(--accent-fg, #fff); }
.phs-btn[data-primary]:hover:not(:disabled) { background: var(--accent); filter: brightness(1.08); }
.phs-btn svg { width: 14px; height: 14px; }
.phs-problems { margin: 0; padding: 0 4px; color: var(--text-faint); font-size: 11.5px; }
`
