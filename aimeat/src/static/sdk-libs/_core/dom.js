/**
 * @file dom.js
 * @description Shared SDK-libs core: the element builder the Atelier and game kits build every
 *   component from. The two kits carried the same el() and append() word for word; this is that
 *   code, once. Nothing here writes a colour or a size: a component sets class names, and a value
 *   that is truly dynamic goes on a CSS custom property through `vars`.
 * @structure el(tag, attrs, kids) · append(parent, kids)
 * @usage import { el, append } from '../_core/dom.js';
 *   el('div', { class: 'ak-card', vars: { '--ak-fill': '42%' }, on: { click: fn } }, ['text']);
 * @version-history
 *   v1.0.0 — 2026-10-05 — Moved here from atelier/dom.js and game/dom.js, unchanged
 *     (secaudit 2026-10, M7).
 */

/** Attribute names handled specially by `el` rather than being set as attributes. */
const SPECIAL = { text: 1, on: 1, vars: 1, children: 1 };

/**
 * Build an element.
 * @param {string} tag
 * @param {Record<string, any>} [attrs]  Attributes, plus `text` (textContent), `on`
 *   (event map), `vars` (CSS custom properties). A null/undefined/false value is skipped.
 * @param {any} [kids]  A string, a Node, or an array of either (nullish entries skipped).
 * @returns {HTMLElement}
 */
export function el(tag, attrs, kids) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') { node.textContent = String(v); continue; }
      if (k === 'on') { for (const type in v) node.addEventListener(type, v[type]); continue; }
      if (k === 'vars') { for (const name in v) node.style.setProperty(name, String(v[name])); continue; }
      if (SPECIAL[k]) continue;
      node.setAttribute(k, v === true ? '' : String(v));
    }
    if (attrs.children != null) append(node, attrs.children);
  }
  if (kids != null) append(node, kids);
  return node;
}

/**
 * Append a string / Node / array of them to a parent.
 * @param {Node} parent
 * @param {any} kids
 */
export function append(parent, kids) {
  const list = Array.isArray(kids) ? kids : [kids];
  for (const c of list) {
    if (c == null || c === false) continue;
    parent.appendChild(typeof c === 'object' ? /** @type {Node} */ (c) : document.createTextNode(String(c)));
  }
}
