/**
 * @file atelier/scroll-edge.js
 * @description THE SIDEWAYS STRIP SAYS SO. A dozen places in this kit hide content behind a
 *   horizontal scroller — the tab strip, the data table, the comparison matrix, the mosaic deck
 *   and rail, the carousel viewport, the checkout rail, the kanban board and the folded reading
 *   rail — and a strip that is cut off looks exactly like a strip that ended. The measured review
 *   found the tab bar on the dashboard bench page 585px of content in a 374px box at a phone
 *   width, with nothing on the screen saying so.
 *
 *   This module supplies the one thing CSS cannot work out for itself: WHICH SIDE has more. It
 *   stamps `data-ak-scroll` on every scroller it knows about — "start" (nothing hidden to the
 *   left), "middle" (both sides), "end" (nothing hidden to the right), "none" (nothing hidden at
 *   all) — and shell.css paints the fade. An app opts its own scroller in with one attribute,
 *   `data-ak-scroll-edge`, and needs no script of its own.
 *
 *   IT REPAINTS NOTHING AT IDLE. The attribute is written only when its value CHANGES, the scroll
 *   listener is passive and coalesced into one animation frame, and the fade is a mask, not an
 *   animation — so a resting surface still repaints zero times and reduced motion has nothing to
 *   collapse. Three observers do the watching, all shared: one ResizeObserver over every known
 *   scroller (its box changed), one MutationObserver over the document (a scroller arrived, or
 *   its content grew), and one capturing scroll listener (scroll does not bubble, capture does).
 *
 *   RIGHT-TO-LEFT reads scrollLeft as a negative number in every current engine, so the distance
 *   is taken as an absolute value and "start"/"end" mean the reading start and the reading end.
 *   The fade itself is painted with logical directions in the stylesheet.
 * @structure SCROLLERS (the selector every kit scroller answers to) · stamp() · scrollEdge() ·
 *   watch()/unwatch() · the module's own auto-start
 * @usage  import { scrollEdge } from './scroll-edge.js';
 *   scrollEdge(myOwnScroller);           // or, from markup: <div data-ak-scroll-edge>
 * @version-history
 *   v0.1.0 — 2026-09-05 — Initial, for the measured review's third finding.
 */

/**
 * Every scroller this kit builds, plus the app's opt-in attribute. A class joins this list at the
 * same time as the `overflow-x: auto` that makes it a scroller — the two belong together, and a
 * scroller nothing here names is one nobody is told about.
 */
const SCROLLERS = [
  '.ak-tabs',
  '.ak-table',
  '.ak-matrix__scroll',
  '.ak-mosaic__deck',
  '.ak-mosaic__rail',
  '.ak-carousel__viewport',
  '.ak-checkout__rail',
  '.ak-kanban',
  '.ak-reading__list',
  '[data-ak-scroll-edge]',
].join(', ');

/** Under this many pixels of hidden content there is nothing worth saying. */
const SLACK = 2;

/** @type {Set<Element>} every element currently watched. */
const known = new Set();
/** @type {ResizeObserver|null} */
let sizes = null;
/** @type {MutationObserver|null} */
let tree = null;
let frame = 0;
let started = false;

/**
 * Write the state of one scroller, and only when it changed.
 * @param {Element} node
 */
function stamp(node) {
  const el = /** @type {HTMLElement} */ (node);
  const hidden = el.scrollWidth - el.clientWidth;
  let state;
  if (hidden <= SLACK) {
    state = 'none';
  } else {
    const left = Math.abs(el.scrollLeft);
    const atStart = left <= SLACK;
    const atEnd = left >= hidden - SLACK;
    state = atStart ? 'start' : (atEnd ? 'end' : 'middle');
  }
  if (el.dataset.akScroll !== state) el.dataset.akScroll = state;
}

/** Re-stamp everything known, once, on the next frame. */
function stampAll() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    for (const node of known) {
      if (node.isConnected) stamp(node);
      else unwatch(node);
    }
  });
}

/**
 * Start watching one element. Safe to call again for the same element.
 * @param {Element|null|undefined} node
 * @returns {boolean} true when it is now watched
 */
export function scrollEdge(node) {
  if (!node || node.nodeType !== 1 || known.has(node)) return !!(node && known.has(node));
  known.add(node);
  if (sizes) sizes.observe(node);
  stamp(node);
  return true;
}

/**
 * Stop watching one element and take its mark off.
 * @param {Element} node
 */
export function unwatch(node) {
  if (!known.delete(node)) return;
  if (sizes) sizes.unobserve(node);
  delete /** @type {HTMLElement} */ (node).dataset.akScroll;
}

/** Find every scroller in a subtree and watch it. */
function sweep(root) {
  const scope = root && root.nodeType === 1 ? root : document;
  if (scope !== document && /** @type {Element} */ (scope).matches(SCROLLERS)) scrollEdge(scope);
  for (const node of scope.querySelectorAll(SCROLLERS)) scrollEdge(node);
}

/**
 * Begin watching the document. Called once when this module loads; calling it again is a no-op,
 * so an app that imports the kit twice pays for one set of observers.
 * @returns {boolean} true when the browser has what this needs
 */
export function watch() {
  if (started) return true;
  if (typeof document === 'undefined' || typeof ResizeObserver === 'undefined') return false;
  started = true;

  sizes = new ResizeObserver(stampAll);
  // Content that grows inside a scroller changes its scrollWidth without changing its own box,
  // so the tree is watched as well: a new tab, a new column, a new card all land here.
  tree = new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) sweep(n);
    stampAll();
  });
  tree.observe(document.documentElement, { childList: true, subtree: true });
  // scroll does not bubble; capture reaches it wherever it happens.
  document.addEventListener('scroll', (e) => {
    const t = /** @type {Element|null} */ (/** @type {unknown} */ (e.target));
    if (t && t.nodeType === 1 && known.has(t)) stamp(t);
  }, { capture: true, passive: true });
  window.addEventListener('resize', stampAll, { passive: true });

  sweep(document);
  return true;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
}
