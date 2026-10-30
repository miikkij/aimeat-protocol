/**
 * @file atelier/ornament-set-pen.js
 * @description THE SET PEN: the small drawing vocabulary the eleven ornament sets
 *   (ornament-sets-*.js) are written in, ported from the accepted set canvas
 *   (wish-kymmenen-koristesetti-eri-tyyleiss). A set figure is a list of polylines and filled
 *   shapes, each with a colour role, a start time and a duration:
 *
 *     line(pts, role, width, delay, duration)   a stroke that draws itself by its dash
 *     shape(d, role, delay, duration, how)       a filled path that pops, shoots, spins, fades or drifts in
 *     rect(x, y, w, h, role, opts)               a bar's track or fill, a fill wiping in from the left
 *
 *   Every colour is a ROLE (s1, s2, s3, s4, ink, mute, pale, paper, ground, deep, d1, h1, t1, t2,
 *   t3) that ornaments.css resolves over the look's tokens, so a look recolours a set without a
 *   line of script. Timing is the figure's own clock, shifted by the delay knob and scaled by the
 *   speed knob; with `animate: false` the nodes are written settled.
 *
 *   SEEDED. A set that scatters (confetti, scribbles, speed lines) draws from rnd(), reset to the
 *   set's seed for every drawing, so a figure looks the same on every render and every redraw.
 * @structure f · dOf · lenOf · poly · circ · arc · bz · hex · pen(svg, opts) → { line, shape, stroke, rect, rnd }
 * @usage
 *   const P = pen(svg, { animate: true, speed: 1, delay: 0, shift: 0, ease: null, seed: 7 });
 *   P.line([[0, 0], [100, 0]], 's1', 1.5, 0.2, 0.8);
 * @version-history
 *   v0.1.0 — 2026-10-30 — Initial: the canvas boards' line/shape helpers, painting by role.
 */
import { svgEl } from './ornament-svg.js';

/** One decimal: enough for a path, short enough to keep the markup small. */
export const f = (n) => Math.round(n * 10) / 10;

/** @param {number[][]} pts */
export const dOf = (pts) => 'M' + pts.map((p) => f(p[0]) + ' ' + f(p[1])).join(' L');

/** @param {number[][]} pts */
export const lenOf = (pts) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return Math.ceil(L) + 2;
};

/** @param {number[][]} pts */
export const poly = (pts) => dOf(pts) + ' Z';

/** A circle as one path. */
export const circ = (x, y, r) => 'M' + f(x - r) + ' ' + f(y) + ' a' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(2 * r) + ' 0 a' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(-2 * r) + ' 0 Z';

/** n + 1 points on an arc from a0 to a1 (radians). */
export const arc = (cx, cy, r, a0, a1, n) => {
  const o = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return o;
};

/** n + 1 points on a cubic Bezier. */
export const bz = (a, b, c, d, n) => {
  const o = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const v = 1 - u;
    o.push([v * v * v * a[0] + 3 * v * v * u * b[0] + 3 * v * u * u * c[0] + u * u * u * d[0],
      v * v * v * a[1] + 3 * v * v * u * b[1] + 3 * v * u * u * c[1] + u * u * u * d[1]]);
  }
  return o;
};

/** A closed hexagon (7 points), its first corner at angle a0. */
export const hex = (cx, cy, r, a0) => {
  const o = [];
  for (let i = 0; i <= 6; i++) { const a = (a0 || 0) + i * Math.PI / 3; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return o;
};

/** The colour roles ornaments.css paints. */
export const SET_ROLES = ['s1', 's2', 's3', 's4', 'ink', 'mute', 'pale', 'paper', 'ground', 'deep', 'd1', 'h1', 't1', 't2', 't3'];

/** How a filled shape arrives: each is a class in ornaments.css. */
const HOW = { pop: 'ak-orn-spop', turn: 'ak-orn-sturn', shoot: 'ak-orn-sshoot', spin: 'ak-orn-sspin', fade: 'ak-orn-sfade', drift: 'ak-orn-sdrift', wipe: 'ak-orn-swipe' };

/**
 * @typedef {{ animate: boolean, speed: number, delay: number, shift?: number, ease?: string | null,
 *   popEase?: string | null, seed?: number }} PenOpts
 *   `shift` is subtracted from every start time, so a part drawn on its own starts when it is shown.
 */

/**
 * A pen that draws into svg.
 * @param {Element} svg
 * @param {PenOpts} o
 */
export function pen(svg, o) {
  const speed = Math.max(0.25, Math.min(3, Number(o.speed) || 1));
  const base = Math.max(0, Number(o.delay) || 0);
  const shift = o.shift || 0;
  const sec = (t) => ((base + Math.max(0, t - shift)) / speed).toFixed(2) + 's';
  const span = (t) => (Math.max(0.05, t) / speed).toFixed(2) + 's';
  let seed = o.seed || 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  /** @param {Element} el @param {string} cls @param {number} dl @param {number} du @param {string | null | undefined} ease */
  const timed = (el, cls, dl, du, ease) => {
    el.classList.add(cls);
    const s = /** @type {any} */ (el).style;
    s.animationDelay = sec(dl);
    s.animationDuration = span(du);
    if (ease) s.animationTimingFunction = ease;
  };

  /**
   * A stroke that draws itself.
   * @param {number[][]} pts
   * @param {string} role
   * @param {number} width
   * @param {number} dl
   * @param {number} du
   */
  const line = (pts, role, width, dl, du) => {
    if (pts.length < 2) return null;
    const el = svgEl('path', { d: dOf(pts), class: 'ak-orn-k ak-orn-r-' + role, 'stroke-width': width }, svg);
    if (o.animate) {
      const len = lenOf(pts);
      const s = /** @type {any} */ (el).style;
      s.strokeDasharray = String(len);
      s.strokeDashoffset = String(len);
      timed(el, 'ak-orn-grow', dl, du, o.ease);
    }
    return el;
  };

  /**
   * A filled shape.
   * @param {string} d
   * @param {string} role
   * @param {number} dl
   * @param {number} [du]
   * @param {keyof HOW} [how]
   */
  const shape = (d, role, dl, du, how) => {
    const el = svgEl('path', { d, class: 'ak-orn-f ak-orn-r-' + role }, svg);
    if (o.animate) timed(el, HOW[how || 'pop'], dl, du || 0.5, !how || how === 'pop' || how === 'turn' || how === 'spin' ? o.popEase : null);
    return el;
  };

  /**
   * A stroked path that arrives whole (fades or pops in) rather than drawing itself: a set of
   * stripes or hatching given as one path.
   * @param {string} d
   * @param {string} role
   * @param {number} width
   * @param {number} dl
   * @param {number} du
   * @param {keyof HOW} [how]
   */
  const stroke = (d, role, width, dl, du, how) => {
    const el = svgEl('path', { d, class: 'ak-orn-k ak-orn-r-' + role, 'stroke-width': width }, svg);
    if (o.animate) timed(el, HOW[how || 'fade'], dl, du, null);
    return el;
  };

  /**
   * A rectangle: a bar's track (stroke: true) or its fill; `wipe` grows a fill in from the left.
   * @param {number} x @param {number} y @param {number} w @param {number} h @param {string} role
   * @param {{ rx?: number, stroke?: boolean, sw?: number, wipe?: [number, number, string?] }} [opts]
   *   wipe is [delay, duration, timing function?]
   */
  const rect = (x, y, w, h, role, opts) => {
    const r = opts || {};
    if (w <= 0 || h <= 0) return null;
    const el = svgEl('rect', {
      x: f(x), y: f(y), width: f(w), height: f(h), rx: r.rx || 0,
      class: (r.stroke ? 'ak-orn-k' : 'ak-orn-f') + ' ak-orn-r-' + role,
      'stroke-width': r.sw || 1,
    }, svg);
    if (o.animate && r.wipe) timed(el, HOW.wipe, r.wipe[0], r.wipe[1], r.wipe[2] || o.ease);
    return el;
  };

  return { line, shape, stroke, rect, rnd, poly, circ, arc, bz, hex, f };
}

/**
 * @typedef {ReturnType<typeof pen>} Pen
 * @typedef {{ x: number, y: number, w: number, h: number }} Box  the element's box inside the drawing
 * @typedef {{ x0: number, x1: number, y: number }} Run  a horizontal run: a rule or a strip
 * @typedef {{ x: number, y: number, w: number, h: number, v: number }} BarBox  a bar's track and its value
 * @typedef {{ mess: number, value: number }} SetParams
 * @typedef {{ id: string, seed?: number, ease?: string, popEase?: string, barH?: number,
 *   frame: (P: Pen, C: Box, p: SetParams) => void, rule: (P: Pen, D: Run, p: SetParams) => void,
 *   bar: (P: Pen, B: BarBox, p: SetParams) => void, bullet: (P: Pen, pt: number[], i: number, p: SetParams) => void,
 *   strip: (P: Pen, S: Run, p: SetParams) => void }} SetStyle
 *   One set: the five figures in one style. Times are the set canvas's own, so the five drawn
 *   together on one screen grow in the order the canvas showed.
 */
