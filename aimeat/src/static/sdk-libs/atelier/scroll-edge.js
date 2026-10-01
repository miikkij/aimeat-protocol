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
 *
 *   THE CHOSEN ITEM IS IN VIEW. revealInStrip() scrolls a strip so one child is fully visible,
 *   clear of the edge fade, by setting the strip's own scrollLeft: scrollIntoView() also scrolls
 *   every scrolling ancestor, the page included, and a tab pick must never move the page up or
 *   down. keepInView() runs it for a strip whose chosen child changes (the tab row), once per
 *   frame, and again when the strip's box changes size (its first layout, a phone turned
 *   sideways). A change of choice may travel smoothly; reduced motion and the first draw jump.
 * @structure SCROLLERS (the selector every kit scroller answers to) · stamp() · scrollEdge() ·
 *   watch()/unwatch() · the module's own auto-start · fadeInset() · revealInStrip() · keepInView()
 * @usage  import { scrollEdge } from './scroll-edge.js';
 *   scrollEdge(myOwnScroller);           // or, from markup: <div data-ak-scroll-edge>
 *   const follow = keepInView(strip, '.is-chosen'); follow.request(true); follow.destroy();
 * @version-history
 *   v0.2.0 — 2026-10-01 — revealInStrip() and keepInView(): the tab row scrolls its chosen tab
 *     into view at 390px, where it stayed off to the side after a pick or set({ value }).
 *   v0.1.0 — 2026-09-05 — Initial, for the measured review's third finding.
 */
import { reducedMotion } from './dom.js';

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

/**
 * How far in from each edge a revealed child must sit: the edge fade's width (--ak-scroll-fade),
 * so a child that is "in view" is not half under the fade. Only a px value is read; any other unit
 * counts as no fade, and the child then sits at the very edge.
 * @param {Element} strip
 * @returns {number}
 */
function fadeInset(strip) {
  let raw;
  try { raw = String(getComputedStyle(strip).getPropertyValue('--ak-scroll-fade') || '').trim(); } catch { return 0; }
  const v = parseFloat(raw);
  return /px$/.test(raw) && v > 0 ? v : 0;
}

/**
 * Scroll a sideways strip so one of its children is fully in view. Only the strip's own
 * scrollLeft changes, never an ancestor's and never the page's. A child wider than the strip
 * shows its left edge. Right to left works because scrollLeft and the boxes share one axis.
 * @param {Element|null|undefined} strip
 * @param {Element|null|undefined} child
 * @param {{ smooth?: boolean }} [opts]  travel smoothly, unless the viewer asked for less motion
 * @returns {number|null} the scrollLeft it set, or null when nothing had to move
 */
export function revealInStrip(strip, child, opts) {
  if (!strip || !child || !strip.contains(child)) return null;
  const s = /** @type {HTMLElement} */ (strip);
  const box = s.getBoundingClientRect();
  const r = child.getBoundingClientRect();
  if (!(box.width > 0) || !(r.width > 0)) return null;
  // The inset never squeezes the child: what is left beside it is split between the two edges.
  const inset = Math.min(fadeInset(s), Math.max(0, (box.width - r.width) / 2));
  let delta = 0;
  if (r.width >= box.width || r.left < box.left + inset) delta = r.left - (box.left + inset);
  else if (r.right > box.right - inset) delta = r.right - (box.right - inset);
  if (Math.abs(delta) < 1) return null;
  const room = Math.max(0, s.scrollWidth - s.clientWidth);
  let rtl = false;
  try { rtl = getComputedStyle(s).direction === 'rtl'; } catch { /* no computed style: left to right */ }
  const left = Math.round(Math.max(rtl ? -room : 0, Math.min(rtl ? 0 : room, s.scrollLeft + delta)));
  if (left === Math.round(s.scrollLeft)) return null;
  if (opts && opts.smooth && !reducedMotion() && typeof s.scrollTo === 'function') s.scrollTo({ left: left, behavior: 'smooth' });
  else s.scrollLeft = left;
  return left;
}

/**
 * Keep the child a selector names in view inside a strip: on request (after the strip redrew or
 * its choice changed), and whenever the strip's own box changes size, which covers a strip built
 * before it was attached and a phone turned sideways. Requests in one frame are one scroll, and
 * the scroll is smooth when any of them asked for it.
 * @param {Element} strip
 * @param {string} selector  the child to keep in view, e.g. '.ak-tab--active'
 * @returns {{ request: (smooth?: boolean) => void, destroy: () => void }}
 */
export function keepInView(strip, selector) {
  let frame = 0;
  let smooth = false;
  let dead = false;
  /** @type {ResizeObserver|null} */
  let box = null;
  function run() {
    frame = 0;
    if (dead) return;
    const glide = smooth;
    smooth = false;
    revealInStrip(strip, strip.querySelector(selector), { smooth: glide });
  }
  /** @param {boolean} [wantSmooth] */
  function request(wantSmooth) {
    if (dead) return;
    if (wantSmooth) smooth = true;
    if (frame) return;
    if (typeof requestAnimationFrame !== 'function') { run(); return; }
    frame = requestAnimationFrame(run);
  }
  if (typeof ResizeObserver === 'function') {
    box = new ResizeObserver(function () { request(false); });
    box.observe(strip);
  }
  return {
    request: request,
    destroy() {
      dead = true;
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      frame = 0;
      if (box) box.disconnect();
      box = null;
    },
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
}
