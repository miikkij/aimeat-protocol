/**
 * @file atelier/arrive.js
 * @description MOTION WITHOUT BEING ASKED. Everything an Atelier app builds arrives, changes and
 *   leaves with the look's own motion, and no app writes a line of it. This module is the engine
 *   the components call; an app calls none of it.
 *
 *   THREE MOVES, ALL FINITE, ALL ON THE WEB ANIMATIONS API and nothing else — no library is
 *   loaded, nothing idles, and every one of them is a no-op when the viewer asked for less:
 *
 *     settle(container, run)       the CHANGE: rows that are new rise in, rows that moved glide
 *                                  from where they stood, rows that left fade out where they
 *                                  were standing instead of blinking out of the page
 *     keyedRows(container, items)  the RECONCILER the rebuild-shaped components adopt: rows are
 *                                  kept by their id across a re-render, so an entrance runs ONCE
 *                                  per row rather than on every repaint of the list
 *     viewSwap(run)                the VIEW change: a tab, a bottom-bar item, a flow step and a
 *                                  detail pane cross into the next one through the View
 *                                  Transitions API, and through the kit's own curtain where the
 *                                  browser has none
 *
 *   THE AMOUNT OF MOTION BELONGS TO THE LOOK, never to this file: `--ak-motion` is the pace,
 *   `--ak-ease` the curve, `--ak-enter-distance` how far a row rises and `--ak-enter-stagger` the
 *   beat between two of them. A look that declares 0 and 0 (flat, and every still-hands genre)
 *   moves nothing here, and that is the whole opt-out at the design end.
 *
 *   AND THE WHOLE ENTRANCE IS OVER WITHIN ONE CAP. A stagger is a beat times an index, which on a
 *   200-row table is eleven seconds of rows trickling in. `ARRIVE_SPAN_CAP` is the ceiling on the
 *   LAST row's delay whatever the look's beat, so a long list finishes inside it and a short one
 *   is unchanged.
 * @structure motionOff · paceOf · settle · keyedRows · viewSwap · fadeIn
 * @usage
 *   import { settle, keyedRows } from './arrive.js';
 *   keyedRows(tbody, rows, { key: r => r.id, build: r => rowEl(r), update: (el, r) => fill(el, r) });
 * @version-history
 *   v0.50.0 — 2026-09-05 — Initial (wish-atelier-always-excellent, part 2: motion by default).
 */
import { resolve, motionOff, reducedMotion } from './dom.js';
import { screenTransition } from './transitions.js';

/** The ceiling on the last row's entrance delay, whatever the look's beat and however many rows. */
const ARRIVE_SPAN_CAP = 500;

/** How far past its own place a leaving row shrinks while it fades. */
const EXIT_SCALE = 0.96;

/** The class the stylesheet pins a leaving row's stand-in with (motion-show.css owns the rule). */
const GHOST = 'ak-layout__ghost';

/**
 * The look's own hand, read off the element that is about to move: the pace, the curve, how far a
 * row rises and the beat between two of them. A bare document with no kit stylesheet gets the
 * house numbers rather than nothing, so a component still moves outside an Atelier page.
 * @param {Element} node
 * @returns {{ span: number, ease: string, dist: number, step: number }}
 */
export function paceOf(node) {
  let cs;
  try { cs = getComputedStyle(node); } catch { cs = null; }
  const num = function (name, floor) {
    if (!cs) return floor;
    const v = parseFloat(cs.getPropertyValue(name));
    return isFinite(v) ? v : floor;
  };
  const ease = cs ? (cs.getPropertyValue('--ak-ease') || '').trim() : '';
  return {
    span: num('--ak-motion', 200) || 200,
    ease: ease || 'cubic-bezier(0.2, 0.7, 0.3, 1)',
    dist: num('--ak-enter-distance', 14),
    step: num('--ak-enter-stagger', 40),
  };
}

/**
 * Whether this element may move at all: the viewer's answer (the operating system's setting or
 * the bar's Less-motion switch), the app's or the block's opt-out, a browser with no Web
 * Animations, and a look that declares no entrance at all.
 * @param {Element|null} node
 * @returns {boolean}
 */
function still(node) {
  if (!node || motionOff(node)) return true;
  return typeof (/** @type {any} */ (node).animate) !== 'function';
}

/** The container's real children — a stand-in mid-fade is scenery, never a row. */
function kidsOf(node, sel) {
  const all = sel
    ? Array.prototype.slice.call(node.querySelectorAll(sel))
    : Array.prototype.slice.call(node.children);
  return /** @type {HTMLElement[]} */ (all.filter(function (k) { return !k.classList.contains(GHOST); }));
}

/** A row's identity: the keyed attribute, or the element itself for a container that MOVES its
 *  rows rather than rebuilding them. @returns {string|HTMLElement} */
function keyOf(kid, attr) {
  const k = kid.getAttribute(attr);
  return k == null ? kid : k;
}

/**
 * ONE ROW ARRIVES: a fade and a short rise on the look's own distance, the nth row a beat after
 * the one before it, and the whole set inside the cap however long the set is.
 * @param {Element} kid
 * @param {{ span: number, ease: string, dist: number, step: number }} pace
 * @param {number} [index]  which arrival this is in the current change
 * @returns {void}
 */
export function fadeIn(kid, pace, index) {
  if (still(kid)) return;
  if (!pace.dist && !pace.step) return;   // the look means "no entrance", and it wins
  const delay = Math.min((index || 0) * pace.step, ARRIVE_SPAN_CAP);
  kid.animate(
    [
      { opacity: 0, transform: 'translateY(' + pace.dist + 'px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: pace.span, delay: delay, easing: pace.ease, fill: 'backwards' },
  );
}

/** The row that is no longer here, held where it stood for one fade. The clone is pinned to the
 *  box it was measured in through four custom properties the stylesheet reads, so no geometry is
 *  written from here and the page below it has already closed the gap. */
function fadeOut(kid, box, pace) {
  const ghost = /** @type {HTMLElement} */ (kid.cloneNode(true));
  ghost.className = kid.className + ' ' + GHOST;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.removeAttribute('id');
  ghost.style.setProperty('--ak-ghost-x', box.left + 'px');
  ghost.style.setProperty('--ak-ghost-y', box.top + 'px');
  ghost.style.setProperty('--ak-ghost-w', box.width + 'px');
  ghost.style.setProperty('--ak-ghost-h', box.height + 'px');
  document.body.appendChild(ghost);
  const drop = function () { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); };
  if (typeof ghost.animate !== 'function') { drop(); return; }
  const anim = ghost.animate(
    [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(' + EXIT_SCALE + ')' },
    ],
    { duration: pace.span, easing: 'ease-in' },
  );
  anim.onfinish = drop;
  anim.oncancel = drop;
}

/** The row that ended up somewhere else, carried from where it was standing to where it is. */
function glide(kid, dx, dy, pace) {
  kid.animate(
    [
      { transform: 'translate(' + dx + 'px, ' + dy + 'px)' },
      { transform: 'translate(0, 0)' },
    ],
    { duration: pace.span * 1.4, easing: pace.ease },
  );
}

/**
 * THE CHANGE, AROUND ANY DOM WORK. Measure every row by its identity, hand control to `run` —
 * where the component adds, removes, reorders or repaints rows however it already does — measure
 * again, and give each row the move its own change earned: a row that appeared rises in, a row
 * that ended up elsewhere glides there, and a row that is gone fades out where it stood.
 *
 * Under reduced motion, under an app's or a block's opt-out, and under a look with no entrance,
 * `run` simply runs and the result is correct with no travel at all.
 * @param {Element|string} container
 * @param {() => void} run
 * @param {{ keyed?: string, rows?: string, enter?: boolean, exit?: boolean, move?: boolean }} [opts]
 * @returns {void}
 */
export function settle(container, run, opts) {
  if (typeof run !== 'function') return;
  const node = /** @type {HTMLElement} */ (resolve(container));
  if (still(node)) { run(); return; }
  const o = opts || {};
  const attr = o.keyed || 'data-ak-id';
  const pace = paceOf(node);

  /** @type {Map<string|HTMLElement, { el: HTMLElement, box: DOMRect }>} */
  const before = new Map();
  kidsOf(node, o.rows).forEach(function (kid) {
    before.set(keyOf(kid, attr), { el: kid, box: kid.getBoundingClientRect() });
  });

  run();

  const seen = new Set();
  let arrivals = 0;
  kidsOf(node, o.rows).forEach(function (kid) {
    const key = keyOf(kid, attr);
    seen.add(key);
    const was = before.get(key);
    if (!was) {
      if (o.enter !== false) fadeIn(kid, pace, arrivals++);
      return;
    }
    if (o.move === false) return;
    const now = kid.getBoundingClientRect();
    const dx = was.box.left - now.left;
    const dy = was.box.top - now.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    glide(kid, dx, dy, pace);
  });

  if (o.exit === false) return;
  before.forEach(function (was, key) {
    if (seen.has(key)) return;
    if (was.el.parentNode === node) return;   // still here, under another identity
    fadeOut(was.el, was.box, pace);
  });
}

/** Where a container's kept rows live between renders, so the component does not have to hold
 *  them itself. One map per container, dropped with the container. */
const KEPT = new WeakMap();

/**
 * THE KEYED RECONCILER the rebuild-shaped components adopt. Rows are kept by their id across a
 * re-render: a row that was already on screen keeps its element (and so does not re-enter), a row
 * that is new is built and rises in, a row that is gone leaves, and a row that changed places
 * glides. This is what makes an entrance run ONCE per row rather than on every repaint — the
 * failure the rebuild shape produced, where a list of twenty re-animated every time one figure
 * moved.
 *
 * `update` is optional: without it a kept row is left exactly as it was, which is right for a
 * component whose row content is fixed by its id.
 * @template T
 * @param {Element|string} container
 * @param {T[]} items
 * @param {{
 *   key: (item: T, index: number) => string,
 *   build: (item: T, index: number) => HTMLElement,
 *   update?: (el: HTMLElement, item: T, index: number) => void,
 *   keyed?: string, rows?: string,
 * }} spec
 * @returns {HTMLElement[]}  the rows now on screen, in order
 */
export function keyedRows(container, items, spec) {
  const node = /** @type {HTMLElement} */ (resolve(container));
  const attr = spec.keyed || 'data-ak-id';
  let kept = KEPT.get(node);
  if (!kept) { kept = new Map(); KEPT.set(node, kept); }
  /** @type {HTMLElement[]} */
  const order = [];

  settle(node, function () {
    const next = new Map();
    (items || []).forEach(function (item, i) {
      const key = String(spec.key(item, i));
      let row = kept.get(key);
      if (!row || row.parentNode !== node) {
        row = spec.build(item, i);
        row.setAttribute(attr, key);
      } else if (spec.update) {
        spec.update(row, item, i);
      }
      next.set(key, row);
      order.push(row);
    });
    // Rows nobody claimed leave the container first, so the reorder below measures a clean box.
    kept.forEach(function (row, key) {
      if (next.has(key)) return;
      if (row.parentNode === node) node.removeChild(row);
    });
    // Put the rows in order with as few moves as the DOM allows: a row already in the right
    // place is left alone, which is what keeps a repaint from looking like a rebuild.
    let at = node.firstChild;
    order.forEach(function (row) {
      if (at === row) { at = row.nextSibling; return; }
      node.insertBefore(row, at);
    });
    kept.clear();
    next.forEach(function (row, key) { kept.set(key, row); });
  }, { keyed: attr, rows: spec.rows });

  return order;
}

/**
 * THE VIEW CHANGES. A tab, a bottom-bar item, a flow step and a detail pane all mean the same
 * thing — what is on the screen is being replaced — and they all get the same move: the browser's
 * View Transitions where it has them, the kit's own curtain where it does not, and the plain swap
 * under reduced motion or an opt-out. `run` is whatever the app or the component already does to
 * change the screen; nothing about it changes.
 * @param {() => void|Promise<any>} run
 * @param {{ kind?: 'fade'|'wipe'|'curtain'|'zoom'|'iris'|'slide', from?: { x: number, y: number },
 *   direction?: 'left'|'right'|'up'|'down', node?: Element|null }} [opts]
 * @returns {Promise<void>}
 */
export function viewSwap(run, opts) {
  const o = opts || {};
  if (o.node && motionOff(o.node)) return Promise.resolve(run()).then(function () { /* swapped */ });
  return screenTransition(o.kind || 'fade', run, { from: o.from, direction: o.direction });
}

/**
 * The wait a component makes before it treats a swap as over: one of the look's beats, or nothing
 * at all when nothing is going to move.
 * @param {Element} node
 * @returns {number}
 */
export function pauseFor(node) {
  return reducedMotion() ? 0 : paceOf(node).span;
}
