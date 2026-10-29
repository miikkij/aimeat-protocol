/**
 * @file atelier/ornament-geo.js
 * @description THE ORNAMENT GEOMETRY: pure functions that turn a few numbers into SVG path data for
 *   the ornament figures (ornament.js). Nothing here touches the DOM, so the same code runs in the
 *   kit, in a unit test and in a worker.
 *
 *   Three ideas carry every figure:
 *   - A TURTLE CURVE grows from a point and a heading, bending by kappa(u) at fraction u of its
 *     length. A bend that grows towards the end is a scroll that curls into a spiral; a bend that
 *     changes sign is an S-curve. Mirroring a curve is (x0 -> -x0, heading -> PI - heading,
 *     kappa -> -kappa).
 *   - A BASE is a curve a strand twines round: a line, an arc or a rounded rectangle, each giving
 *     at(s) = point, tangent and outward normal at arc length s.
 *   - A HELIX is a strand offset from its base by amp * sin(k s + phase). It is split where it
 *     passes behind (cos < 0), so the caller draws the back segments, then the base, then the front
 *     segments over it: the strand reads as wound round the base. Two strands half a turn apart
 *     always cross with one in front and one behind, which is why a rope of n strands needs no
 *     crossing logic.
 * @structure R · pathOf · lengthOf · turtle · at · leafPath · line · arc · rrect · roundedRectPath ·
 *   helix · helixLeaves · rosettePetals
 * @usage
 *   import { turtle, helix, line } from './ornament-geo.js';
 *   const curl = turtle(0, 0, 0, 120, (u) => 0.25 * u ** 4);
 *   const strands = helix(line(0, 0, 400, 0).at, 400, 12, 60, 0);
 * @version-history
 *   v0.1.0 — 2026-10-29 — Initial: ported from the accepted ornament canvas (wish-kasvavat-koristeet-atelieriin-ja-design-bookiin).
 */

/** One decimal place: enough for a screen, and it keeps a path string short. */
export function R(n) { return Math.round(n * 10) / 10; }

/**
 * Points to an SVG path of straight segments.
 * @param {number[][]} pts  [x, y] pairs
 * @returns {string}
 */
export function pathOf(pts) {
  if (!pts.length) return '';
  let d = 'M' + R(pts[0][0]) + ' ' + R(pts[0][1]);
  for (let i = 1; i < pts.length; i++) d += 'L' + R(pts[i][0]) + ' ' + R(pts[i][1]);
  return d;
}

/**
 * The length of a polyline, rounded up and padded so a dash of this length covers the whole stroke.
 * @param {number[][]} pts  [x, y] pairs
 * @returns {number}
 */
export function lengthOf(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return Math.ceil(l) + 2;
}

/**
 * @typedef {{ pts: number[][], hs: number[], d: string, len: number,
 *   end: { x: number, y: number, h: number } }} Turtle
 */

/**
 * A curve grown from (x, y) with heading h (radians, y down), bending kappa(u) per unit length.
 * @param {number} x
 * @param {number} y
 * @param {number} h
 * @param {number} len
 * @param {(u: number) => number} kappa
 * @param {number} [ds] step length
 * @returns {Turtle}
 */
export function turtle(x, y, h, len, kappa, ds) {
  const step = ds || 1.5;
  const n = Math.max(2, Math.ceil(len / step));
  const pts = [[x, y]];
  const hs = [h];
  for (let i = 0; i < n; i++) {
    h += kappa(i / n) * step;
    x += Math.cos(h) * step;
    y += Math.sin(h) * step;
    pts.push([x, y]);
    hs.push(h);
  }
  return { pts, hs, d: pathOf(pts), len: lengthOf(pts), end: { x, y, h } };
}

/**
 * The point and heading at fraction u of a turtle curve.
 * @param {Turtle} t
 * @param {number} u
 * @returns {{ x: number, y: number, h: number }}
 */
export function at(t, u) {
  const i = Math.min(t.pts.length - 1, Math.max(0, Math.round(u * (t.pts.length - 1))));
  return { x: t.pts[i][0], y: t.pts[i][1], h: t.hs[i] };
}

/**
 * A pointed leaf of length s along +x from the origin; wf is its width as a share of the length.
 * @param {number} s
 * @param {number} [wf]
 * @returns {string}
 */
export function leafPath(s, wf) {
  const w = s * (wf || 0.34);
  return 'M0 0C' + R(s * 0.18) + ' ' + R(-w) + ' ' + R(s * 0.62) + ' ' + R(-w * 0.8) + ' ' + R(s) + ' 0C'
    + R(s * 0.62) + ' ' + R(w * 0.8) + ' ' + R(s * 0.18) + ' ' + R(w) + ' 0 0Z';
}

/**
 * @typedef {{ x: number, y: number, tx: number, ty: number, nx: number, ny: number }} BasePoint
 * @typedef {{ L: number, at: (s: number) => BasePoint }} Base
 */

/**
 * A straight base from (x0, y0) to (x1, y1). The normal points left of travel; flip turns it over,
 * which is how a line drawn the other way stays the mirror image of its twin.
 * @returns {Base}
 */
export function line(x0, y0, x1, y1, flip) {
  const L = Math.max(1e-6, Math.hypot(x1 - x0, y1 - y0));
  const tx = (x1 - x0) / L;
  const ty = (y1 - y0) / L;
  const nx = flip ? -ty : ty;
  const ny = flip ? tx : -tx;
  return { L, at: (s) => ({ x: x0 + tx * s, y: y0 + ty * s, tx, ty, nx, ny }) };
}

/**
 * A circular base from angle a0 to a1 (radians). The normal points outward.
 * @returns {Base}
 */
export function arc(cx, cy, r, a0, a1) {
  const dir = a1 > a0 ? 1 : -1;
  return {
    L: Math.abs(a1 - a0) * r,
    at: (s) => {
      const a = a0 + dir * s / r;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      return { x: cx + r * c, y: cy + r * sn, tx: -sn * dir, ty: c * dir, nx: c, ny: sn };
    },
  };
}

/**
 * The outline of a rounded rectangle, clockwise from the end of the top-left corner. The normal
 * points outward.
 * @returns {Base}
 */
export function rrect(x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  const P = Math.PI;
  /** @type {Array<{ len: number, f: (t: number) => BasePoint }>} */
  const segs = [];
  const edge = (x0, y0, tx, ty, len) => segs.push({ len, f: (t) => ({ x: x0 + tx * t, y: y0 + ty * t, tx, ty, nx: ty, ny: -tx }) });
  const bend = (cx, cy, a0) => segs.push({
    len: P * rad / 2,
    f: (t) => {
      const a = a0 + (rad > 0 ? t / rad : 0);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      return { x: cx + rad * c, y: cy + rad * sn, tx: -sn, ty: c, nx: c, ny: sn };
    },
  });
  edge(x + rad, y, 1, 0, w - 2 * rad); bend(x + w - rad, y + rad, -P / 2);
  edge(x + w, y + rad, 0, 1, h - 2 * rad); bend(x + w - rad, y + h - rad, 0);
  edge(x + w - rad, y + h, -1, 0, w - 2 * rad); bend(x + rad, y + h - rad, P / 2);
  edge(x, y + h - rad, 0, -1, h - 2 * rad); bend(x + rad, y + rad, P);
  let L = 0;
  for (const g of segs) L += g.len;
  return {
    L,
    at: (s) => {
      let rest = Math.max(0, Math.min(L, s));
      for (let i = 0; i < segs.length - 1; i++) {
        if (rest <= segs[i].len) return segs[i].f(rest);
        rest -= segs[i].len;
      }
      const last = segs[segs.length - 1];
      return last.f(Math.min(rest, last.len));
    },
  };
}

/**
 * The same rounded rectangle as SVG path data, for drawing the base itself.
 * @returns {string}
 */
export function roundedRectPath(x, y, w, h, r) {
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  const a = (ex, ey) => 'A' + R(q) + ' ' + R(q) + ' 0 0 1 ' + R(ex) + ' ' + R(ey);
  return 'M' + R(x + q) + ' ' + R(y) + 'H' + R(x + w - q) + a(x + w, y + q) + 'V' + R(y + h - q) + a(x + w - q, y + h)
    + 'H' + R(x + q) + a(x, y + h - q) + 'V' + R(y + q) + a(x + q, y) + 'Z';
}

/**
 * @typedef {{ front: boolean, s0: number, s1: number, d: string, len: number }} HelixSegment
 */

/**
 * A strand twining round a base, split into front and back segments.
 * @param {(s: number) => BasePoint} base
 * @param {number} L     base length to cover
 * @param {number} amp   distance from the base at the widest
 * @param {number} period base length of one full turn
 * @param {number} phase radians
 * @param {number} [ds]  sampling step
 * @returns {HelixSegment[]}
 */
export function helix(base, L, amp, period, phase, ds) {
  const step = ds || 2;
  const k = 2 * Math.PI / period;
  const n = Math.ceil(L / step);
  /** @type {Array<{ front: boolean, s0: number, s1: number, pts: number[][] }>} */
  const segs = [];
  let cur = null;
  for (let i = 0; i <= n; i++) {
    const s = Math.min(L, i * step);
    const b = base(s);
    const th = k * s + phase;
    const o = amp * Math.sin(th);
    const front = Math.cos(th) >= 0;
    const p = [b.x + b.nx * o, b.y + b.ny * o];
    if (!cur || cur.front !== front) {
      const last = cur ? cur.pts[cur.pts.length - 1] : null;
      cur = { front, s0: last ? Math.max(0, s - step) : s, s1: s, pts: last ? [last] : [] };
      segs.push(cur);
    }
    cur.pts.push(p);
    cur.s1 = s;
  }
  return segs.filter((g) => g.pts.length > 1).map((g) => ({ front: g.front, s0: g.s0, s1: g.s1, d: pathOf(g.pts), len: lengthOf(g.pts) }));
}

/**
 * Where leaves sit on a helix: on the front, a third of a turn either side of the base, turned
 * outward by alpha radians from the base's direction.
 * @param {(s: number) => BasePoint} base
 * @param {number} L
 * @param {number} amp
 * @param {number} period
 * @param {number} phase
 * @param {{ size: number, alpha?: number, every?: number, from?: number, endGap?: number }} opt
 * @returns {Array<{ s: number, x: number, y: number, ang: number, size: number }>}
 */
export function helixLeaves(base, L, amp, period, phase, opt) {
  const k = 2 * Math.PI / period;
  const a = opt.alpha || 0.9;
  const every = Math.max(1, Math.round(opt.every || 1));
  const from = opt.from || 0;
  const endGap = opt.endGap || 0;
  /** @type {Array<{ s: number, th: number }>} */
  const cand = [];
  for (let m = -1; m * period < L + period; m++) {
    for (const t0 of [Math.PI / 3, 5 * Math.PI / 3]) {
      const s = (t0 + 2 * Math.PI * m - phase) / k;
      if (s >= from && s <= L - endGap) cand.push({ s, th: t0 });
    }
  }
  cand.sort((p, q) => p.s - q.s);
  const out = [];
  cand.forEach((c, i) => {
    if (i % every) return;
    const b = base(c.s);
    const o = amp * Math.sin(c.th);
    const sg = o >= 0 ? 1 : -1;
    const dx = b.tx * Math.cos(a) + b.nx * sg * Math.sin(a);
    const dy = b.ty * Math.cos(a) + b.ny * sg * Math.sin(a);
    out.push({ s: c.s, x: b.x + b.nx * o, y: b.y + b.ny * o, ang: Math.atan2(dy, dx), size: opt.size * (0.82 + 0.06 * ((i * 5) % 4)) });
  });
  return out;
}

/**
 * The petals of a rosette: n leaves round the origin, starting r0 out.
 * @returns {Array<{ angle: number, r0: number, d: string }>}
 */
export function rosettePetals(n, r0, s, wf) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ angle: 360 * i / n, r0, d: leafPath(s, wf) });
  return out;
}
