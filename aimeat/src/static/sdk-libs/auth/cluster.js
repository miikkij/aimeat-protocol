/**
 * @file auth/cluster.js
 * @description The shared stylesheet for the platform control cluster — language, light/dark mode
 *   and palette — that travels inside the login pill. One injected sheet, class-based (no inline
 *   layout/colour styles on the controls), themed through currentColor + the aimeat-theme.css
 *   tokens with safe fallbacks, so the same markup reads correctly on the golden pill, on a bare
 *   signed-out header, and in the compact mobile popover. The controls are SEGMENTED: every option
 *   visible, the active one marked, one click to any — never a blind cycle. Pickers with more
 *   options than fit a segment (palettes, 4+ languages) use a small anchored popover whose width
 *   is capped at the viewport, which is the deliberate 390px form.
 * @structure ensureClusterStyles() — idempotent <style> injector.
 * @usage import { ensureClusterStyles } from './cluster.js';   (pill.js calls it once per render)
 * @version-history
 *   v1.2.0 — 2026-09-05 — `.aimeat-seg--fixed` and the disabled segment: how a control that has
 *     stood down looks, for the light/dark switch on a page that keeps its own palette.
 *   v1.1.1 — 2026-08-29 — The pressed segment reads --aimeat-ink / --aimeat-paper (defined on the pill's
 *     roots by ink.js), so its fallback follows the theme instead of assuming a light page.
 *   v1.1.0 — 2026-08-29 — The segments and the popover trigger wear the pill's new frame: a 2px
 *     currentColor border, square unless --aimeat-pill-radius says otherwise, the pressed option
 *     filled with the page's text colour. Matches pill.js v1.4.0.
 *   v1.0.0 — 2026-07-25 — Born with the control cluster (theme system v2): replaces the per-button
 *     inline styles of the old cycling language button + lone theme toggle.
 */

export function ensureClusterStyles() {
  if (document.getElementById('aimeat-cluster-css')) return;
  var st = document.createElement('style');
  st.id = 'aimeat-cluster-css';
  st.textContent = [
    /* The cluster row. Inherits text colour from its host (gold pill or page header). */
    '.aimeat-ctl{display:inline-flex;align-items:center;gap:6px}',

    /* Segmented group: one bordered pill, every option a button. */
    '.aimeat-seg{display:inline-flex;align-items:stretch;height:26px;flex:0 0 auto;',
      'border:2px solid currentColor;border-radius:var(--aimeat-pill-radius,0);',
      'overflow:hidden;background:transparent}',
    '.aimeat-seg button{appearance:none;border:0;background:transparent;color:currentColor;',
      'opacity:.6;font:700 11px/1 "Inter","Segoe UI",system-ui,sans-serif;letter-spacing:.4px;',
      'padding:0 10px;margin:0;cursor:pointer;display:inline-flex;align-items:center;gap:4px;',
      'transition:opacity var(--motion-fast,120ms) ease,background var(--motion-fast,120ms) ease}',
    '.aimeat-seg button:hover{opacity:.9}',
    '.aimeat-seg button:focus-visible{outline:2px solid currentColor;outline-offset:-2px;opacity:1}',
    '.aimeat-seg button[aria-pressed="true"]{opacity:1;',
      'background:var(--aimeat-ink);color:var(--aimeat-paper)}',
    '.aimeat-seg button+button{border-left:0}',
    '.aimeat-seg .seg-ico{font-size:13px;line-height:1}',
    /* A control that has stood down. The group keeps its frame so it still reads as an
       instrument that exists, and the whole thing dims and takes the arrow cursor so nobody
       aims at it twice — the reason is on the group's title, because a native tooltip on a
       disabled button never appears. Used by a page that keeps its own palette (a genre body). */
    '.aimeat-seg--fixed{opacity:.55;cursor:default}',
    '.aimeat-seg button[disabled]{cursor:default;opacity:.6}',
    '.aimeat-seg button[disabled]:hover{opacity:.6}',

    /* Popover trigger (palette picker; language picker when 4+ languages). */
    '.aimeat-pop-wrap{position:relative;display:inline-flex;flex:0 0 auto}',
    '.aimeat-pop-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;',
      'gap:5px;height:26px;min-width:26px;padding:0 6px;background:transparent;',
      'border:2px solid currentColor;border-radius:var(--aimeat-pill-radius,0);',
      'cursor:pointer;color:currentColor;font:700 11px/1 "Inter","Segoe UI",system-ui,sans-serif;letter-spacing:.4px;',
      'transition:background var(--motion-fast,120ms) ease}',
    '.aimeat-pop-btn:hover{background:color-mix(in oklab,currentColor 12%,transparent)}',
    '.aimeat-pop-btn:focus-visible{outline:2px solid currentColor;outline-offset:-2px}',

    /* The popover panel: a real themed surface (not the host pill), so swatches read true. */
    '.aimeat-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:1200;display:none;',
      'background:var(--color-base-200,#ffffff);color:var(--color-base-content,#1a1a2e);',
      'border:1px solid var(--color-base-300,#d9dbe1);border-radius:var(--radius-box,14px);',
      'box-shadow:var(--elev-pop,0 4px 10px rgb(15 18 25 / .1),0 18px 44px rgb(15 18 25 / .16));',
      'padding:8px;width:max-content;max-width:calc(100vw - 24px)}',
    '.aimeat-pop-wrap.aimeat-open .aimeat-pop{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}',
    '.aimeat-pop.aimeat-pop-list{grid-template-columns:minmax(0,1fr)}',
    '.aimeat-pop button{appearance:none;display:flex;align-items:center;gap:8px;padding:7px 9px;margin:0;',
      'background:transparent;border:1px solid transparent;border-radius:calc(var(--radius-box,14px) - 6px);',
      'cursor:pointer;color:inherit;font:600 12px/1.1 "Inter","Segoe UI",system-ui,sans-serif;text-align:left;',
      'transition:background var(--motion-fast,120ms) ease}',
    '.aimeat-pop button:hover{background:color-mix(in oklab,currentColor 8%,transparent)}',
    '.aimeat-pop button:focus-visible{outline:2px solid var(--color-primary,#e8564a);outline-offset:-2px}',
    '.aimeat-pop button[aria-pressed="true"]{border-color:var(--color-primary,#e8564a)}',

    /* Palette swatch chips: page/card/accent of the palette IN THE CURRENT MODE. The three
       colours are data (they vary per palette), so they arrive as inline background values on
       these spans — layout and everything else stays here. */
    '.aimeat-pal-chip{position:relative;flex:0 0 auto;width:26px;height:20px;border-radius:5px;',
      'border:1px solid color-mix(in oklab,currentColor 25%,transparent);overflow:hidden}',
    '.aimeat-pal-chip .pc-card{position:absolute;inset:5px 5px 3px 5px;border-radius:3px}',
    '.aimeat-pal-chip .pc-acc{position:absolute;right:3px;bottom:3px;width:7px;height:7px;border-radius:50%}',
    /* The trigger's miniature: the active palette's accent as a dot. */
    '.aimeat-pal-dot{width:12px;height:12px;border-radius:50%;flex:0 0 auto;',
      'border:1px solid color-mix(in oklab,currentColor 30%,transparent)}',

  ].join('');
  (document.head || document.documentElement).appendChild(st);
}

/**
 * Keep a just-opened popover inside the viewport: anchored right by default, nudged with a
 * transform when the left edge would leave the screen (the 390px case — a swatch grid opened
 * from a cluster that sits mid-header). Measurement-based, so it works inside the compact
 * pill popover too, where CSS alone cannot know where the anchor landed.
 * @param {HTMLElement} pop
 */
export function clampPopover(pop) {
  pop.style.transform = '';
  var r = pop.getBoundingClientRect();
  var pad = 12;
  var shift = 0;
  if (r.left < pad) shift = pad - r.left;
  else if (r.right > window.innerWidth - pad) shift = (window.innerWidth - pad) - r.right;
  if (shift) pop.style.transform = 'translateX(' + Math.round(shift) + 'px)';
}
