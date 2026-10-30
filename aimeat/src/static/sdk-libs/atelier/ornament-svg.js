/**
 * @file atelier/ornament-svg.js
 * @description THE ORNAMENT DRAWING CONTEXT: builds the SVG nodes the ornament figures need and
 *   times how they grow. A figure asks for a stroke, a leaf, a bead or a rosette with a start time
 *   and a duration; this module writes the geometry and the timing as inline properties and leaves
 *   every colour to ornaments.css (the class names below), so a look recolours an ornament without
 *   a line of script.
 *
 *   Growth is finite CSS animation: a stroke draws itself by its dash offset, a leaf or a bead
 *   scales up from where it sits, a fill fades in. Nothing loops. With reduced motion, or with
 *   `animate: false`, the same nodes are written settled and no animation class is set.
 * @structure NS · svgEl · drawing(parent, w, h, opts) → { svg, group, stroke, leaf, bead, rosette,
 *   fade, chain }
 * @usage
 *   const g = drawing(host, 400, 120, { animate: true, speed: 1, delay: 0 });
 *   g.stroke(g.svg, d, 'ln', 1.6, len, 0.2, 1.8);
 * @version-history
 *   v0.1.0 — 2026-10-29 — Initial (wish-kasvavat-koristeet-atelieriin-ja-design-bookiin).
 */
import { R, leafPath } from './ornament-geo.js';

export const NS = 'http://www.w3.org/2000/svg';

/**
 * One SVG element with attributes, appended to parent when given.
 * @param {string} tag
 * @param {Record<string, string | number>} [attrs]
 * @param {Element} [parent]
 * @returns {SVGElement}
 */
export function svgEl(tag, attrs, parent) {
  const el = /** @type {SVGElement} */ (document.createElementNS(NS, tag));
  if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(el);
  return el;
}

/** The colour roles ornaments.css paints; a figure names one per node. */
const ROLE = {
  ln: 'ak-orn-ln', dim: 'ak-orn-dim', hi: 'ak-orn-hi', vine: 'ak-orn-vine', vback: 'ak-orn-vback',
  gap: 'ak-orn-gap', gapc: 'ak-orn-gapc', band: 'ak-orn-band', hatch: 'ak-orn-hatch',
  leaf: 'ak-orn-leaf', rib: 'ak-orn-rib', petal: 'ak-orn-petal', prib: 'ak-orn-prib',
  dot: 'ak-orn-dot', vdot: 'ak-orn-vdot', card: 'ak-orn-card', solid: 'ak-orn-solid',
  tail: 'ak-orn-tail', crease: 'ak-orn-crease', ring: 'ak-orn-ring',
};

/**
 * @typedef {{ animate?: boolean, speed?: number, delay?: number, cls?: string, viewBox?: boolean,
 *   view?: { x: number, y: number, w: number, h: number } }} DrawOpts
 *   `viewBox: true` leaves the size to CSS; `view` shows only that window of the drawing at that
 *   size, and the rest paints outside the element as ink overflow, which never widens the page.
 */

/**
 * A drawing of w x h user units inside parent. The svg is aria-hidden: an ornament never carries
 * meaning a screen reader needs.
 * @param {Element} parent
 * @param {number} w
 * @param {number} h
 * @param {DrawOpts} [opts]
 */
export function drawing(parent, w, h, opts) {
  const o = opts || {};
  const animate = o.animate !== false;
  const speed = Math.max(0.25, Math.min(3, Number(o.speed) || 1));
  const base = Math.max(0, Number(o.delay) || 0);
  const v = o.view || { x: 0, y: 0, w, h };
  const svg = svgEl('svg', {
    viewBox: R(v.x) + ' ' + R(v.y) + ' ' + R(v.w) + ' ' + R(v.h),
    'aria-hidden': 'true',
    focusable: 'false',
    class: 'ak-orn-svg' + (o.cls ? ' ' + o.cls : ''),
  }, parent);
  if (o.viewBox !== true) { svg.setAttribute('width', String(R(v.w))); svg.setAttribute('height', String(R(v.h))); }

  /** Seconds on the page's clock: the figure's own time, shifted by the delay, scaled by the speed. */
  const sec = (t) => ((base + t) / speed).toFixed(2) + 's';
  const span = (t) => (Math.max(0.05, t) / speed).toFixed(2) + 's';

  /**
   * @param {Element} p
   * @param {Record<string, string | number>} [attrs]
   */
  const group = (p, attrs) => svgEl('g', attrs, p);

  /**
   * A stroke that draws itself from its start.
   * @param {Element} p
   * @param {string} d
   * @param {keyof ROLE} role
   * @param {number} width
   * @param {number} [len]  its length; without one the stroke is drawn settled
   * @param {number} [del]
   * @param {number} [dur]
   * @param {boolean} [lin] steady pace, for segments chained into one growing strand
   * @param {{ butt?: boolean }} [extra]
   */
  const stroke = (p, d, role, width, len, del, dur, lin, extra) => {
    const el = svgEl('path', { d, class: ROLE[role] + (extra && extra.butt ? ' ak-orn-butt' : ''), 'stroke-width': width }, p);
    if (animate && len) {
      el.classList.add('ak-orn-grow');
      if (lin) el.classList.add('ak-orn-lin');
      const s = /** @type {SVGElement & { style: CSSStyleDeclaration }} */ (el).style;
      s.strokeDasharray = String(len);
      s.strokeDashoffset = String(len);
      s.animationDelay = sec(del || 0);
      s.animationDuration = span(dur || 1);
    }
    return el;
  };

  /** A node that scales up from its own origin; the transform sits on an outer group. */
  const sprouting = (p, transform, del) => {
    const outer = group(p, { transform });
    const inner = group(outer);
    if (animate) {
      inner.classList.add('ak-orn-sprout');
      /** @type {any} */ (inner).style.animationDelay = sec(del || 0);
    }
    return inner;
  };

  /** A leaf at (x, y) pointing along ang (radians), with its midrib. */
  const leaf = (p, x, y, ang, size, del, wf, role) => {
    const g = sprouting(p, 'translate(' + R(x) + ' ' + R(y) + ') rotate(' + R(ang * 180 / Math.PI) + ')', del);
    svgEl('path', { d: leafPath(size, wf), class: ROLE[role || 'leaf'] }, g);
    svgEl('path', { d: 'M' + R(size * 0.12) + ' 0L' + R(size * 0.8) + ' 0', class: ROLE[role === 'petal' ? 'prib' : 'rib'] }, g);
    return g;
  };

  /** A round bead at (x, y). */
  const bead = (p, x, y, r, del, role) => {
    const g = sprouting(p, 'translate(' + R(x) + ' ' + R(y) + ')', del);
    svgEl('circle', { r, class: ROLE[role || 'dot'] }, g);
    return g;
  };

  /** A rosette at (cx, cy): a ring, n petals and a centre bead. */
  const rosette = (p, cx, cy, n, r0, size, ringR, del) => {
    const g = sprouting(p, 'translate(' + R(cx) + ' ' + R(cy) + ')', del);
    if (ringR) svgEl('circle', { r: ringR, class: ROLE.ln, 'stroke-width': 1.4 }, g);
    for (let i = 0; i < n; i++) {
      svgEl('path', { d: leafPath(size), class: ROLE.ln, 'stroke-width': 0.8, transform: 'rotate(' + R(360 * i / n) + ') translate(' + r0 + ' 0)' }, g);
    }
    svgEl('circle', { r: Math.max(1.6, r0 * 0.75), class: ROLE.dot }, g);
    return g;
  };

  /** An element that fades in. */
  const fade = (el, del) => {
    if (animate) {
      el.classList.add('ak-orn-fade');
      /** @type {any} */ (el).style.animationDelay = sec(del || 0);
    }
    return el;
  };

  /**
   * Helix segments grown one after another at a steady pace: base length L over T seconds from
   * t0. Back segments go to back, front segments to front, once per role in fronts (a gap stroke
   * under the strand first, so the crossing reads).
   * @param {Element} back
   * @param {Element} front
   * @param {Array<{ front: boolean, s0: number, s1: number, d: string, len: number }>} segs
   * @param {number} L
   * @param {number} t0
   * @param {number} T
   * @param {Array<[keyof ROLE, number]>} fronts
   * @param {[keyof ROLE, number] | null} backRole
   * @param {{ butt?: boolean }} [extra]
   */
  const chain = (back, front, segs, L, t0, T, fronts, backRole, extra) => {
    for (const g of segs) {
      const del = t0 + T * g.s0 / L;
      const dur = T * (g.s1 - g.s0) / L;
      if (g.front) for (const [role, width] of fronts) stroke(front, g.d, role, width, g.len, del, dur, true, extra);
      else if (backRole) stroke(back, g.d, backRole[0], backRole[1], g.len, del, dur, true, extra);
    }
  };

  return { svg, group, stroke, leaf, bead, rosette, fade, chain, animate };
}
