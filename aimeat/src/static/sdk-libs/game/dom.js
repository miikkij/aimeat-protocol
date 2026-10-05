/**
 * @file game/dom.js
 * @description The small DOM layer every aimeat-game component is built from: element building,
 *   selection, the stylesheet injector, and the two answer-instantly helpers (`busy`, `guardButtons`).
 *   Signatures follow the TDR kit so an author who uses both libraries writes the same code twice.
 *
 *   NO CSS LIVES HERE. Components never write colours, spacing or typography from JavaScript;
 *   they set class names, and where a value is genuinely dynamic (a fill percentage, a marker
 *   position) they set a CUSTOM PROPERTY that the stylesheet consumes — so the rule stays in CSS
 *   and only the number comes from JS.
 * @structure el · txt · $ · $$ · clear · uid · reducedMotion · injectStyle · busy · guardButtons
 * @usage  import { el, $, injectStyle } from './dom.js';
 *   el('div', { class: 'ag-card', vars: { '--ag-fill': '42%' }, on: { click: fn } }, ['text']);
 * @version-history
 *   v1.0.1 — 2026-10-05 — el and append come from _core/dom.js, shared with the Atelier kit
 *     (secaudit 2026-10, M7).
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 01).
 */

/** The element builder, shared with the Atelier kit. */
export { el, append } from '../_core/dom.js';

let seq = 0;

/**
 * First match, like `document.querySelector` but rooted where you say.
 * @param {string} sel
 * @param {ParentNode} [root]
 * @returns {HTMLElement|null}
 */
export function $(sel, root) {
  return /** @type {HTMLElement|null} */ ((root || document).querySelector(sel));
}

/**
 * Every match, as a real array.
 * @param {string} sel
 * @param {ParentNode} [root]
 * @returns {HTMLElement[]}
 */
export function $$(sel, root) {
  return Array.prototype.slice.call((root || document).querySelectorAll(sel));
}

/**
 * Empty a node (children only — the node itself stays).
 * @param {Node} node
 * @returns {Node} the same node
 */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * A unique id for aria wiring.
 * @param {string} [prefix]
 * @returns {string}
 */
export function uid(prefix) {
  seq += 1;
  return (prefix || 'ag') + '-' + seq;
}

/**
 * Does the viewer ask for less motion? Animated components check this and jump to the end state.
 * @returns {boolean}
 */
export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Resolve a target that may be a selector, an element, or nothing.
 * @param {string|Element|null|undefined} target
 * @param {Element} [fallback]
 * @returns {Element}
 */
export function resolve(target, fallback) {
  if (!target) return fallback || document.body;
  if (typeof target === 'string') return $(target) || fallback || document.body;
  return target;
}

/**
 * Add the kit's stylesheet, and optionally the host's own overriding CSS.
 *
 * The `<link>` goes FIRST in `<head>` so anything the host already wrote outranks it; `extraCss`
 * is the HOST's css and is appended LAST so it outranks both. Calling this twice is a no-op for
 * the link and replaces the extra style block.
 *
 * @param {{ href?: string, extraCss?: string }} [opts]
 * @returns {{ link: HTMLLinkElement, style: HTMLStyleElement|null }}
 */
export function injectStyle(opts) {
  const o = opts || {};
  const head = document.head || document.getElementsByTagName('head')[0];
  let link = /** @type {HTMLLinkElement|null} */ (document.getElementById('ag-style'));
  if (!link) {
    link = document.createElement('link');
    link.id = 'ag-style';
    link.rel = 'stylesheet';
    link.href = o.href || '/lib/aimeat-game.css';
    head.insertBefore(link, head.firstChild);
  }
  let style = /** @type {HTMLStyleElement|null} */ (document.getElementById('ag-style-extra'));
  if (o.extraCss) {
    if (!style) {
      style = document.createElement('style');
      style.id = 'ag-style-extra';
      head.appendChild(style);
    }
    style.textContent = o.extraCss;
  }
  return { link: link, style: style };
}

/** Elements currently marked busy, with the function that ends it. */
const busyMap = new WeakMap();

/**
 * Mark a control as working. It answers instantly (spinner + aria-busy) and refuses further
 * clicks until the returned release is called. Calling it twice on one element is a no-op.
 * @param {Element|null} node
 * @returns {() => void}  release
 */
export function busy(node) {
  if (!node) return function () { /* nothing to release */ };
  const known = busyMap.get(node);
  if (known) return known;
  node.classList.add('ag-busy');
  node.setAttribute('aria-busy', 'true');
  const wasDisabled = /** @type {HTMLButtonElement} */ (node).disabled;
  if ('disabled' in node) /** @type {HTMLButtonElement} */ (node).disabled = true;
  const release = function () {
    busyMap.delete(node);
    node.classList.remove('ag-busy');
    node.removeAttribute('aria-busy');
    if ('disabled' in node) /** @type {HTMLButtonElement} */ (node).disabled = !!wasDisabled;
  };
  busyMap.set(node, release);
  return release;
}

/**
 * Guard every button under a root against double-fire. One listener, capture phase: the first
 * click marks the button busy, a repeat inside the window is swallowed before any handler sees
 * it, and the mark clears when the handler's promise settles or after `ms`.
 *
 * A handler that returns a promise is awaited (return it from your onClick and the spinner lasts
 * exactly as long as the work). Opt one control out with `data-ag-noguard`.
 *
 * @param {string|Element} [target]  Root to delegate from (default: the document).
 * @param {{ ms?: number }} [opts]   Fallback window when no promise is returned (default 700ms).
 * @returns {() => void}  stop guarding
 */
export function guardButtons(target, opts) {
  const root = resolve(/** @type {any} */ (target), document.body) || document.body;
  const ms = (opts && opts.ms) || 700;
  /** @param {Event} ev */
  const onClick = function (ev) {
    const start = /** @type {Element|null} */ (ev.target);
    if (!start || !start.closest) return;
    const btn = start.closest('button, [role="button"], .ag-btn');
    if (!btn || btn.hasAttribute('data-ag-noguard')) return;
    if (busyMap.has(btn)) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
    const release = busy(btn);
    setTimeout(release, ms);
  };
  root.addEventListener('click', onClick, true);
  return function () { root.removeEventListener('click', onClick, true); };
}

/**
 * Hold a control busy for exactly as long as a promise takes. The pairing for an async onClick.
 * @param {Element|null} node
 * @param {Promise<any>|any} work
 * @returns {Promise<any>}
 */
export function whileBusy(node, work) {
  const release = busy(node);
  return Promise.resolve(work).then(
    function (v) { release(); return v; },
    function (e) { release(); throw e; },
  );
}
