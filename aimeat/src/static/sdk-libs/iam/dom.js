/**
 * @file iam/dom.js
 * @description The small DOM helpers the panel is built from, and the one stylesheet it injects.
 *
 *   The panel renders into a host page whose design the library does not know, so it emits neutral
 *   `aim-*` class hooks and a deliberately plain stylesheet built on `currentColor` and inheritable
 *   properties: it takes the host's colours and font rather than imposing its own. An app that wants
 *   the panel to look native in its own framework passes `classMap` and gets its classes on the same
 *   elements. Nothing here hardcodes a brand colour.
 * @structure el() · injectPanelStyle() · fmtDate()
 * @usage import { el, injectPanelStyle } from './dom.js';
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 1).
 */

const STYLE_ID = 'aimeat-iam-style';

/**
 * Create an element. `cls` accepts the neutral hook plus whatever the app mapped onto it.
 * @param {string} tag
 * @param {{ cls?: string, text?: string, attrs?: Record<string, string>, on?: Record<string, EventListener> }} [opts]
 * @param {Array<Node|null>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, opts, children) {
  const node = document.createElement(tag);
  const o = opts || {};
  if (o.cls) node.className = o.cls;
  if (o.text != null) node.textContent = o.text;
  if (o.attrs) for (const k of Object.keys(o.attrs)) node.setAttribute(k, o.attrs[k]);
  if (o.on) for (const k of Object.keys(o.on)) node.addEventListener(k, o.on[k]);
  for (const c of children || []) if (c) node.appendChild(c);
  return node;
}

/**
 * Inject the panel's default stylesheet once. Skipped entirely when the app passes `styles: false`,
 * for a host that would rather dress every hook itself.
 * @param {boolean} [enabled]
 */
export function injectPanelStyle(enabled) {
  if (enabled === false) return;
  if (document.getElementById(STYLE_ID)) return;
  const css = [
    '.aim-iam{display:flex;flex-direction:column;gap:1rem;color:inherit;font:inherit}',
    '.aim-iam-sec{display:flex;flex-direction:column;gap:.5rem}',
    '.aim-iam-h{font-weight:600;margin:0}',
    '.aim-iam-lead{opacity:.75;font-size:.9em;margin:0;max-width:66ch}',
    '.aim-iam-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;padding:.4rem 0;' +
      'border-bottom:1px solid currentColor;border-bottom-color:color-mix(in srgb,currentColor 15%,transparent)}',
    '.aim-iam-id{font-family:ui-monospace,monospace;font-size:.85em;word-break:break-all;min-width:0;flex:1 1 12rem}',
    '.aim-iam-badge{font-size:.75em;padding:.1rem .5rem;border:1px solid currentColor;border-radius:999px;opacity:.85;white-space:nowrap}',
    '.aim-iam-muted{opacity:.65;font-size:.85em}',
    '.aim-iam-warn{opacity:1;font-weight:600}',
    '.aim-iam-note{opacity:.8;font-size:.85em;font-style:italic;flex-basis:100%}',
    // The panel is often narrow inside an app tab, so the controls wrap instead of forcing the page
    // to scroll sideways. A horizontal scrollbar on an admin panel reads as a broken layout.
    '.aim-iam-form{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}',
    '.aim-iam-form input,.aim-iam-form select{min-width:0;flex:1 1 12rem;font:inherit;padding:.35rem .5rem}',
    '.aim-iam-form button,.aim-iam-row button{font:inherit;padding:.3rem .7rem;cursor:pointer}',
    '.aim-iam-empty{opacity:.65;font-size:.9em;padding:.4rem 0}',
  ].join('');
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
}

/**
 * A date as the owner reads it, or the raw value when it is not a date. Never throws on bad input:
 * a malformed timestamp should show as itself, not blank the row it sits in.
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 10);
}
