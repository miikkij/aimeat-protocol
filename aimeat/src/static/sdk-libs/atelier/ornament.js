/**
 * @file atelier/ornament.js
 * @description THE ORNAMENTS: animated SVG decoration that grows round an element of the page — an
 *   engraved frame round a card, a vine twining round a progress bar or a card's border, a wreath
 *   round a badge, a rope or a braid, guilloche, flourishes either side of a heading, a drop cap, a
 *   ribbon behind a title, ivy up a column (wish-kasvavat-koristeet-atelieriin-ja-design-bookiin).
 *
 *   ONE CALL: `AIMEAT.atelier.ornament(el, id, opts)`. The figure measures the element and draws to
 *   its size, and redraws (settled, without growing again) when the element changes size. Every
 *   colour comes from the look through ornaments.css; this file writes geometry and timing only.
 *
 *   TWO WAYS ONTO THE PAGE. An OVERLAY figure (frame, border, wreath…) sits in one or two layers
 *   positioned over the element's box: the UNDER layer paints above the element's own background
 *   and below its content, the OVER layer above the content (the front of a strand wound round a
 *   column). The element gets `position: relative` and `isolation: isolate` through the
 *   `ak-orn-host` class unless it is positioned already. An INLINE figure (flourish, drop cap,
 *   divider…) puts its own nodes into the element. Either way the ornament is aria-hidden: the
 *   element keeps the meaning.
 *
 *   FINITE MOTION. A figure grows once (strokes drawn by their dash, leaves scaled up, fills faded
 *   in) and then holds still. Reduced motion, `data-ak-motion="less"` or `animate: false` draw it
 *   settled. `handle.replay()` grows it again.
 *
 *   ONE CLAMP, TWO CONSUMERS. ORN_PARAMS here and src/data/atelier-ornaments.ts declare the same
 *   bounds; a unit test holds them equal.
 * @structure ORN_PARAMS · ORNAMENT_IDS · ornamentParams(id, given) · ornament(target, id, opts)
 * @usage
 *   const h = AIMEAT.atelier.ornament('#card', 'frame');
 *   const bar = AIMEAT.atelier.ornament(el, 'vine-bar', { value: 0.4 }); bar.set(0.8);
 *   h.replay(); h.destroy();
 * @version-history
 *   v0.1.0 — 2026-10-29 — Initial: 23 figures ported from the accepted ornament canvas.
 */
import { reducedMotion } from './dom.js';
import { drawing } from './ornament-svg.js';
import { FRAME_FIGURES } from './ornament-frames.js';
import { ROUND_FIGURES } from './ornament-rounds.js';
import { LINE_FIGURES } from './ornament-lines.js';
import { TEXT_FIGURES } from './ornament-text.js';

/** Every knob a figure may take, with its bounds and default. */
export const ORN_PARAMS = {
  speed: { min: 0.25, max: 3, default: 1 },
  delay: { min: 0, max: 5, default: 0 },
  leaves: { min: 0, max: 2, default: 1 },
  value: { min: 0, max: 1, default: 0.64 },
  strands: { min: 2, max: 4, default: 3 },
};

/**
 * @typedef {{ speed: number, delay: number, leaves: number, value: number, strands: number }} OrnParams
 * @typedef {{ x: number, y: number }} Pad
 * @typedef {ReturnType<typeof drawing>} Drawing
 * @typedef {{ params: string[], overlay: { pad: (w: number, h: number) => Pad, under?: boolean, over?: boolean,
 *   draw: (layers: { under: Drawing | null, over: Drawing | null }, w: number, h: number, pad: Pad, p: OrnParams, host: HTMLElement) => void } }} OverlayFigure
 * @typedef {{ render: (animate: boolean) => void, set?: (v: number) => void, teardown: () => void }} InlineMount
 * @typedef {{ params: string[], mount: (host: HTMLElement, p: OrnParams, opts: { speed: number, delay: number }) => InlineMount }} InlineFigure
 */

/** @type {Record<string, OverlayFigure | InlineFigure>} */
const FIGURES = { ...FRAME_FIGURES, ...ROUND_FIGURES, ...LINE_FIGURES, ...TEXT_FIGURES };

/** The ornament ids this kit draws, in registry order. */
export const ORNAMENT_IDS = Object.keys(FIGURES);

/**
 * The knobs a figure takes, clamped to their bounds; anything it does not take is dropped.
 * @param {string} id
 * @param {Record<string, unknown>} [given]
 * @returns {OrnParams}
 */
export function ornamentParams(id, given) {
  const fig = FIGURES[id];
  const g = given || {};
  /** @type {Record<string, number>} */
  const out = {};
  for (const name of Object.keys(ORN_PARAMS)) {
    const b = ORN_PARAMS[/** @type {keyof typeof ORN_PARAMS} */ (name)];
    const takes = name === 'speed' || name === 'delay' || (fig && fig.params.indexOf(name) >= 0);
    const n = Number(g[name]);
    out[name] = takes && Number.isFinite(n) ? Math.max(b.min, Math.min(b.max, n)) : b.default;
  }
  return /** @type {OrnParams} */ (/** @type {unknown} */ (out));
}

/** Give an element the positioning an overlay needs, unless it has its own. */
function hostFor(el) {
  if (getComputedStyle(el).position === 'static') el.classList.add('ak-orn-host');
  else el.classList.add('ak-orn-host--placed');
}

/**
 * Mount an overlay figure: one or two layers over the element's box, redrawn settled on resize.
 * @param {HTMLElement} host
 * @param {OverlayFigure} fig
 * @param {OrnParams} p
 * @param {boolean} animate
 */
function mountOverlay(host, fig, p, animate) {
  hostFor(host);
  const spec = fig.overlay;
  const make = (cls) => {
    const box = document.createElement('span');
    box.className = 'ak-orn-layer ' + cls;
    box.setAttribute('aria-hidden', 'true');
    host.appendChild(box);
    return box;
  };
  const under = spec.under !== false ? make('ak-orn-layer--under') : null;
  const over = spec.over ? make('ak-orn-layer--over') : null;
  let lastW = -1;
  let lastH = -1;
  const render = (grow) => {
    const w = host.offsetWidth;
    const h = host.offsetHeight;
    lastW = w; lastH = h;
    if (w < 8 || h < 8) return;
    const pad = spec.pad(w, h);
    const W = w + 2 * pad.x;
    const H = h + 2 * pad.y;
    // The layer is the element's own box and shows the drawing's middle window; what reaches past
    // the box paints there as ink overflow, so an ornament never gives the page a sideways scroll.
    const opts = { animate: grow, speed: p.speed, delay: p.delay, view: { x: pad.x, y: pad.y, w, h } };
    /** @type {{ under: Drawing | null, over: Drawing | null }} */
    const layers = { under: null, over: null };
    for (const [key, box] of /** @type {Array<['under' | 'over', HTMLElement | null]>} */ ([['under', under], ['over', over]])) {
      if (!box) continue;
      box.textContent = '';
      box.style.left = '0px';
      box.style.top = '0px';
      box.style.width = w + 'px';
      box.style.height = h + 'px';
      layers[key] = drawing(box, W, H, opts);
    }
    spec.draw(layers, w, h, pad, p, host);
  };
  render(animate);
  let frame = 0;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (Math.abs(host.offsetWidth - lastW) < 2 && Math.abs(host.offsetHeight - lastH) < 2) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => render(false));
  }) : null;
  if (ro) ro.observe(host);
  return {
    render,
    teardown: () => {
      if (ro) ro.disconnect();
      cancelAnimationFrame(frame);
      if (under) under.remove();
      if (over) over.remove();
      host.classList.remove('ak-orn-host', 'ak-orn-host--placed');
    },
  };
}

/**
 * Put an ornament on an element.
 * @param {Element|string|null} target  The element, or a selector.
 * @param {string} id  One of ORNAMENT_IDS.
 * @param {Record<string, unknown> & { animate?: boolean }} [opts]  The figure's knobs (ORN_PARAMS) and `animate`.
 * @returns {{ id: string, el: HTMLElement, replay: () => void, set: (v: number) => void, destroy: () => void } | null}
 *   null when there is no such element or no such figure.
 */
export function ornament(target, id, opts) {
  const host = /** @type {HTMLElement | null} */ (typeof target === 'string' ? document.querySelector(target) : target);
  const fig = FIGURES[id];
  if (!host || !fig) return null;
  const prev = /** @type {any} */ (host).__akOrnament;
  if (prev && typeof prev.destroy === 'function') prev.destroy();
  const p = ornamentParams(id, opts);
  const animate = !(opts && opts.animate === false) && !reducedMotion();
  const mounted = 'overlay' in fig
    ? mountOverlay(host, fig, p, animate)
    : /** @type {InlineFigure} */ (fig).mount(host, p, { speed: p.speed, delay: p.delay });
  if (!('overlay' in fig)) mounted.render(animate);
  host.setAttribute('data-ak-ornament', id);
  const handle = {
    id,
    el: host,
    replay: () => mounted.render(!reducedMotion()),
    set: (v) => { if (typeof (/** @type {any} */ (mounted)).set === 'function') /** @type {any} */ (mounted).set(v); },
    destroy: () => {
      mounted.teardown();
      host.removeAttribute('data-ak-ornament');
      if (/** @type {any} */ (host).__akOrnament === handle) delete (/** @type {any} */ (host)).__akOrnament;
    },
  };
  /** @type {any} */ (host).__akOrnament = handle;
  return handle;
}
