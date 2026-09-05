/**
 * @file living/dom.js
 * @description THE FOUR DOM CALLS THIS LIBRARY MAKES, and no more than four. Everything a living
 *   document draws is a control row, a set formula, a sentence or the chain view, and all of it
 *   is built out of el() and clear(); the components themselves are the Atelier kit's, reached
 *   through the page rather than imported.
 *
 *   THE KIT IS A NEIGHBOUR, NOT A DEPENDENCY. AIMEAT.atelier is read off the window at the moment
 *   it is used, so this library bundles none of it — importing the kit's dom.js would have copied
 *   twenty kilobytes into every page that loads both. Each borrowed call has a fallback that does
 *   the plain thing, so a page carrying aimeat-living without the kit still renders and still
 *   works; it just does not move.
 * @structure el · clear · resolve · kit · countUp · reducedMotion
 * @usage  import { el, clear, kit } from './dom.js';
 * @version-history
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */

/**
 * One element: attributes, then children. `text` sets textContent, `on` binds listeners, and a
 * null attribute is left off rather than written as "null".
 * @param {string} tag @param {Record<string, any>} [attrs] @param {any} [kids]
 * @returns {HTMLElement}
 */
export function el(tag, attrs, kids) {
  const node = document.createElement(tag);
  for (const key of Object.keys(attrs || {})) {
    const v = attrs[key];
    if (v == null || v === false) continue;
    if (key === 'text') { node.textContent = String(v); continue; }
    if (key === 'on') { for (const ev of Object.keys(v)) node.addEventListener(ev, v[ev]); continue; }
    if (v === true) { node.setAttribute(key, ''); continue; }
    node.setAttribute(key, String(v));
  }
  const list = kids == null ? [] : (Array.isArray(kids) ? kids : [kids]);
  for (const kid of list) {
    if (kid == null || kid === false) continue;
    node.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  return node;
}

/** Empty an element. @param {Element} node */
export function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

/**
 * A target that may be a selector, an element or nothing.
 * @param {string|Element|null|undefined} target @param {Element} [fallback]
 * @returns {Element}
 */
export function resolve(target, fallback) {
  if (!target) return fallback || document.body;
  if (typeof target === 'string') return document.querySelector(target) || fallback || document.body;
  return target;
}

/** The Atelier kit, when the page carries it. Null otherwise, and every caller copes. */
export function kit() {
  const ns = /** @type {any} */ (window).AIMEAT;
  return ns && ns.atelier ? ns.atelier : null;
}

/** The viewer asked for less movement — the kit's answer when it is here, the browser's when not. */
export function reducedMotion() {
  const k = kit();
  if (k && typeof k.reducedMotion === 'function') return k.reducedMotion();
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch { return false; }
}

/**
 * Count a number up to its new value the way the kit's figures do, or set it when the kit is
 * absent or the viewer asked for stillness.
 * @param {HTMLElement} node @param {number} from @param {number} to @param {(n: number) => string} format
 */
export function countTo(node, from, to, format) {
  const k = kit();
  if (k && typeof k.countUp === 'function' && !reducedMotion() && Number.isFinite(from) && Number.isFinite(to)) {
    k.countUp(node, from, to, { format: format });
    return;
  }
  node.textContent = format(to);
}
