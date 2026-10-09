/**
 * The creator's stylesheet. It is rendered by the component itself (React 19
 * hoists and de-duplicates `<style href precedence>`), so applications need no
 * CSS import or bundler setup. Every colour and size is a `--hk-*` custom
 * property on `.hk-creator`, so an application can theme it from its own CSS.
 */
export const CREATOR_CSS = /* css */ `
.hk-creator {
  --hk-bg: #141b22;
  --hk-panel: rgba(16, 22, 29, 0.94);
  --hk-raised: rgba(255, 255, 255, 0.04);
  --hk-border: rgba(255, 255, 255, 0.08);
  --hk-text: #e9eef3;
  --hk-muted: #8e9cab;
  --hk-accent: #e4b07a;
  --hk-accent-ink: #1a1208;
  --hk-track: rgba(255, 255, 255, 0.1);
  --hk-radius: 14px;
  --hk-touch: 44px;
  --hk-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 392px);
  height: 100%;
  min-height: 0;
  background: var(--hk-bg);
  color: var(--hk-text);
  font: 14px/1.4 var(--hk-font);
  -webkit-font-smoothing: antialiased;
}
.hk-creator *, .hk-creator *::before, .hk-creator *::after { box-sizing: border-box; }
.hk-stage { position: relative; min-width: 0; min-height: 0; }
.hk-stage canvas { touch-action: none; }
.hk-status {
  position: absolute; inset: 0; display: grid; place-items: center;
  color: var(--hk-muted); pointer-events: none; letter-spacing: 0.02em;
}
.hk-panel {
  display: flex; flex-direction: column; min-height: 0;
  background: var(--hk-panel);
  border-left: 1px solid var(--hk-border);
  backdrop-filter: blur(18px);
}
.hk-toolbar {
  display: flex; align-items: center; gap: 4px;
  padding: 10px 10px 6px 16px;
}
.hk-title {
  flex: 1; min-width: 0; margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hk-icon-button {
  display: inline-grid; place-items: center;
  width: var(--hk-touch); height: var(--hk-touch);
  padding: 0; border: 0; border-radius: 10px;
  background: transparent; color: var(--hk-text); cursor: pointer;
}
.hk-icon-button:hover:not(:disabled) { background: var(--hk-raised); }
.hk-icon-button:disabled { opacity: 0.32; cursor: default; }
.hk-icon-button:focus-visible, .hk-tab:focus-visible, .hk-swatch:focus-visible,
.hk-group-title:focus-visible, .hk-search:focus-visible {
  outline: 2px solid var(--hk-accent); outline-offset: 1px;
}
.hk-icon-button svg {
  width: 20px; height: 20px; fill: none; stroke: currentColor;
  stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
}
.hk-search-row { padding: 4px 16px 8px; }
.hk-search {
  width: 100%; height: var(--hk-touch); padding: 0 14px;
  border: 1px solid var(--hk-border); border-radius: 12px;
  background: var(--hk-raised); color: var(--hk-text); font: inherit;
}
.hk-search::placeholder { color: var(--hk-muted); }
.hk-tabs {
  display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none;
  padding: 2px 12px 10px; border-bottom: 1px solid var(--hk-border);
}
.hk-tabs::-webkit-scrollbar { display: none; }
.hk-tab {
  flex: none; min-height: 36px; padding: 0 14px;
  border: 0; border-radius: 999px;
  background: transparent; color: var(--hk-muted);
  font: inherit; font-weight: 500; cursor: pointer; white-space: nowrap;
}
.hk-tab:hover { color: var(--hk-text); background: var(--hk-raised); }
.hk-tab[aria-selected="true"] { background: var(--hk-accent); color: var(--hk-accent-ink); }
.hk-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 8px 24px; overscroll-behavior: contain; }
.hk-groups { display: grid; gap: 6px; }
.hk-group { border-radius: var(--hk-radius); background: var(--hk-raised); }
.hk-group-title {
  display: flex; align-items: center; justify-content: space-between;
  min-height: var(--hk-touch); padding: 0 14px;
  list-style: none; cursor: pointer; font-weight: 600; border-radius: var(--hk-radius);
}
.hk-group-title::-webkit-details-marker { display: none; }
.hk-group-title::after {
  content: ""; width: 7px; height: 7px; margin-left: 10px;
  border-right: 1.6px solid var(--hk-muted); border-bottom: 1.6px solid var(--hk-muted);
  transform: rotate(-45deg); transition: transform 0.15s;
}
.hk-group[open] > .hk-group-title::after { transform: rotate(45deg); }
.hk-group-title > :first-child { flex: 1; }
.hk-group-count { color: var(--hk-muted); font-weight: 500; font-variant-numeric: tabular-nums; }
.hk-group-body { display: grid; gap: 2px; padding: 0 14px 12px; }
.hk-slider {
  display: grid; grid-template-columns: 1fr auto var(--hk-touch);
  grid-template-rows: auto var(--hk-touch);
  align-items: center; column-gap: 6px;
}
.hk-slider-label { grid-column: 1; padding-top: 6px; color: var(--hk-text); }
.hk-slider-value {
  grid-column: 2; padding-top: 6px; color: var(--hk-muted);
  font-variant-numeric: tabular-nums; font-size: 13px;
}
.hk-slider-reset { grid-column: 3; grid-row: 1 / span 2; align-self: end; color: var(--hk-muted); }
.hk-slider-reset[hidden] { display: inline-grid; visibility: hidden; }
.hk-slider-reset svg { width: 17px; height: 17px; }
.hk-range { grid-column: 1 / span 2; grid-row: 2; }
.hk-slider[data-disabled] .hk-slider-label, .hk-slider[data-disabled] .hk-slider-value { opacity: 0.45; }
.hk-slider-note { grid-column: 1 / -1; margin: -4px 0 6px; color: var(--hk-muted); font-size: 12px; }
.hk-range {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: var(--hk-touch); margin: 0; background: transparent; cursor: pointer;
}
.hk-range:disabled { cursor: not-allowed; opacity: 0.45; }
.hk-range::-webkit-slider-runnable-track {
  height: 6px; border-radius: 999px;
  background: linear-gradient(90deg, transparent var(--hk-from), var(--hk-accent) var(--hk-from),
    var(--hk-accent) var(--hk-to), transparent var(--hk-to)), var(--hk-track);
}
.hk-range::-moz-range-track {
  height: 6px; border-radius: 999px;
  background: linear-gradient(90deg, transparent var(--hk-from), var(--hk-accent) var(--hk-from),
    var(--hk-accent) var(--hk-to), transparent var(--hk-to)), var(--hk-track);
}
.hk-range[data-custom-track]::-webkit-slider-runnable-track { height: 10px; background: var(--hk-track); }
.hk-range[data-custom-track]::-moz-range-track { height: 10px; background: var(--hk-track); }
.hk-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 22px; height: 22px; margin-top: -8px; border-radius: 50%;
  background: #fff; border: 0; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  transition: transform 0.1s;
}
.hk-range[data-custom-track]::-webkit-slider-thumb { margin-top: -6px; }
.hk-range::-moz-range-thumb {
  width: 22px; height: 22px; border-radius: 50%;
  background: #fff; border: 0; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
}
.hk-range:active::-webkit-slider-thumb { transform: scale(1.12); }
.hk-range:focus-visible { outline: none; }
.hk-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--hk-accent); }
.hk-range:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 3px var(--hk-accent); }
.hk-note { margin: 4px 6px 4px; color: var(--hk-muted); font-size: 13px; }
.hk-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 2px 4px 6px; border: 0; min-width: 0; }
.hk-chip {
  position: relative; min-height: var(--hk-touch); padding: 0 14px;
  border: 1px solid var(--hk-border); border-radius: 999px;
  background: var(--hk-raised); color: var(--hk-text); font: inherit; cursor: pointer;
}
.hk-chip[aria-pressed="true"] { background: var(--hk-accent); border-color: var(--hk-accent); color: var(--hk-accent-ink); }
.hk-chip[data-overridden]::after {
  content: ""; position: absolute; top: 7px; right: 7px; width: 7px; height: 7px;
  border-radius: 50%; background: var(--hk-accent); box-shadow: 0 0 0 2px var(--hk-panel);
}
.hk-chip[aria-pressed="true"][data-overridden]::after { background: var(--hk-accent-ink); }
.hk-chip:focus-visible { outline: 2px solid var(--hk-accent); outline-offset: 1px; }
.hk-hit-path { margin: 8px 0 0; color: var(--hk-muted); font-size: 12px; }
.hk-empty { padding: 24px 16px; color: var(--hk-muted); text-align: center; }
.hk-swatches {
  display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 8px; padding: 0; border: 0;
}
.hk-swatches legend { padding: 6px 0 8px; }
.hk-swatch {
  position: relative; width: var(--hk-touch); height: var(--hk-touch);
  border: 2px solid transparent; border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18); cursor: pointer;
}
.hk-swatch[aria-pressed="true"] { border-color: var(--hk-accent); }
.hk-swatch-custom {
  display: grid; place-items: center; overflow: hidden;
  background: conic-gradient(#c33, #cc3, #3c3, #3cc, #33c, #c3c, #c33);
}
.hk-swatch-custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.hk-error { margin: 0 16px 8px; padding: 10px 12px; border-radius: 10px;
  background: rgba(220, 80, 70, 0.14); color: #ffb4ab; font-size: 13px; }
.hk-error ul { margin: 4px 0 0; padding-left: 18px; }
.hk-visually-hidden {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
}
@media (max-width: 760px) {
  .hk-creator { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 48%); }
  .hk-panel { min-width: 0; }
  .hk-panel {
    border-left: 0; border-top: 1px solid var(--hk-border);
    border-radius: 20px 20px 0 0; margin-top: -20px; z-index: 1;
  }
  .hk-toolbar { padding-top: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .hk-group-title::after, .hk-range::-webkit-slider-thumb { transition: none; }
}
`;
