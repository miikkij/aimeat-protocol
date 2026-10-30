/**
 * @file atelier/ornament-rounds.js
 * @description THE ROUND AND WOUND FIGURES: a laurel wreath round a badge, a guilloche rosette that
 *   fills a square, a guilloche band behind a block's content, ivy climbing a column, a tight
 *   ribbon wrap round a rod, and scroll brackets either side of a button. OVERLAY figures for
 *   ornament.js; ivy and the wrap draw their front into the OVER layer, because the front of a
 *   strand wound round a thing passes in front of it.
 * @structure ROUND_FIGURES = { wreath, guilloche, 'guilloche-band', ivy, wrap, brackets }
 * @usage  Reached through AIMEAT.atelier.ornament(el, 'wreath' | 'guilloche' | 'guilloche-band' | 'ivy' | 'wrap' | 'brackets').
 * @version-history
 *   v0.1.0 — 2026-10-29 — Initial: ported from the accepted ornament canvas.
 */
import { R, pathOf, lengthOf, turtle, line, arc, helix, helixLeaves } from './ornament-geo.js';

const PI = Math.PI;
const TAU = 2 * PI;
const D = PI / 180;

/** Two branches round a round badge, crossing under it; engraved rings on the badge's edge. */
function drawWreath(layers, w, h, pad, p) {
  const d = layers.under;
  if (!d) return;
  const r = Math.min(w, h) / 2;
  const k = r / 84;
  const cx = pad.x + w / 2;
  const cy = pad.y + h / 2;
  const Rw = 118 * k;
  const t0 = 1.1;
  const T = 2.6;
  // The badge's edge, engraved: two rings, the hatch between them, a ring of dots inside.
  d.stroke(d.svg, 'M' + R(cx + r) + ' ' + R(cy) + 'A' + R(r) + ' ' + R(r) + ' 0 1 1 ' + R(cx - r) + ' ' + R(cy) + 'A' + R(r) + ' ' + R(r) + ' 0 1 1 ' + R(cx + r) + ' ' + R(cy), 'ln', 1.6, Math.ceil(TAU * r) + 4, 0, 1.4);
  const r2 = r - 7 * k;
  d.stroke(d.svg, 'M' + R(cx + r2) + ' ' + R(cy) + 'A' + R(r2) + ' ' + R(r2) + ' 0 1 1 ' + R(cx - r2) + ' ' + R(cy) + 'A' + R(r2) + ' ' + R(r2) + ' 0 1 1 ' + R(cx + r2) + ' ' + R(cy), 'ln', 0.8, Math.ceil(TAU * r2) + 4, 0.15, 1.4);
  let hatch = '';
  for (let a = 0; a < 360; a += 4) {
    const c = Math.cos(a * D);
    const s = Math.sin(a * D);
    hatch += 'M' + R(cx + (r - 5.4 * k) * c) + ' ' + R(cy + (r - 5.4 * k) * s) + 'L' + R(cx + (r - 1.6 * k) * c) + ' ' + R(cy + (r - 1.6 * k) * s);
  }
  d.fade(d.stroke(d.svg, hatch, 'hatch', 0.8), 0.8);

  const back = d.group(d.svg);
  const stems = d.group(d.svg);
  const front = d.group(d.svg);
  const leaves = d.group(d.svg);
  [[95, 250, 1], [85, -70, -1]].forEach(([a0, a1, sx], bi) => {
    const br = arc(cx, cy, Rw, a0 * D, a1 * D);
    const pts = [];
    for (let s = 0; s <= br.L; s += 2) { const q = br.at(s); pts.push([q.x, q.y]); }
    d.stroke(stems, pathOf(pts), 'vine', 2 * Math.max(0.6, k), lengthOf(pts), t0, T, true);
    d.chain(back, front, helix(br.at, br.L, 3.5 * k, 24 * k, 0, 1.5), br.L, t0 + 0.35, T, [['gap', 3], ['vine', 1]], ['vback', 0.8]);
    if (p.leaves > 0) {
      const step = (p.leaves > 1.5 ? 10 : 14) * k;
      for (let i = 0, s2 = 12 * k; s2 < br.L - 8 * k; i++, s2 += step) {
        const u = s2 / br.L;
        const size = 16 * k * (1 - 0.45 * u);
        const q2 = br.at(s2);
        const q3 = br.at(Math.min(br.L, s2 + 6 * k));
        const al = 0.8;
        const del = t0 + T * u + 0.1;
        d.leaf(leaves, q2.x, q2.y, Math.atan2(q2.ty * Math.cos(al) + q2.ny * Math.sin(al), q2.tx * Math.cos(al) + q2.nx * Math.sin(al)), size, del);
        d.leaf(leaves, q3.x, q3.y, Math.atan2(q3.ty * Math.cos(al) - q3.ny * Math.sin(al), q3.tx * Math.cos(al) - q3.nx * Math.sin(al)), size * 0.9, del + 0.08);
        if (i % 3 === 1) {
          const qm = br.at(Math.min(br.L, s2 + 9 * k));
          d.bead(leaves, qm.x + qm.nx * 7 * k, qm.y + qm.ny * 7 * k, 2.3 * k, del + 0.25, 'vdot');
          d.bead(leaves, qm.x + qm.nx * 11 * k + qm.tx * 3 * k, qm.y + qm.ny * 11 * k + qm.ty * 3 * k, 1.8 * k, del + 0.32, 'vdot');
        }
      }
    }
    const e = br.at(br.L);
    d.leaf(leaves, e.x, e.y, Math.atan2(e.ty, e.tx), 11 * k, t0 + T);
    // The stalk under the branch curves down and crosses the other one below the badge.
    const s0 = br.at(0);
    const tl = turtle(s0.x, s0.y, Math.atan2(-s0.ty, -s0.tx), 46 * k, () => sx * 0.028 / k);
    const tp = tl.pts.slice().reverse();
    if (bi === 1) d.stroke(stems, pathOf(tp), 'gap', 6, tl.len, 0.6, 0.5);
    d.stroke(stems, pathOf(tp), 'vine', 2 * Math.max(0.6, k), tl.len, 0.6, 0.5);
    d.bead(stems, tp[0][0], tp[0][1], 2.6 * k, 0.5);
  });
}

/** Closed wavy circles, each turned a little further, woven into rings: the banknote rosette. */
function drawGuilloche(layers, w, h, pad) {
  const d = layers.under;
  if (!d) return;
  const half = Math.min(w, h) / 2;
  const k = half / 135;
  const cx = pad.x + w / 2;
  const cy = pad.y + h / 2;
  const circle = (rr, width, del) => d.stroke(d.svg,
    'M' + R(cx + rr) + ' ' + R(cy) + 'A' + R(rr) + ' ' + R(rr) + ' 0 1 1 ' + R(cx - rr) + ' ' + R(cy) + 'A' + R(rr) + ' ' + R(rr) + ' 0 1 1 ' + R(cx + rr) + ' ' + R(cy),
    'ln', width, Math.ceil(TAU * rr) + 4, del, 1.5);
  circle(128 * k, 1.4, 0);
  circle(133 * k, 0.8, 0.1);
  circle(84 * k, 1, 0.5);
  circle(88 * k, 0.6, 0.6);
  const ring = (rb, amp, kk, n, t0, width) => {
    for (let j = 0; j < n; j++) {
      const ph = j * TAU / (kk * n);
      const pts = [];
      for (let i = 0; i <= 360; i++) {
        const th = i * TAU / 360;
        const rr = (rb + amp * Math.cos(kk * (th + ph))) * k;
        pts.push([cx + rr * Math.cos(th), cy + rr * Math.sin(th)]);
      }
      d.stroke(d.svg, pathOf(pts), 'ln', width, lengthOf(pts), t0 + j * 0.12, 2.4);
    }
  };
  ring(108, 14, 12, 8, 0.2, 0.7);
  ring(62, 10, 9, 6, 0.9, 0.7);
  ring(24, 12, 8, 5, 1.6, 0.8);
  d.bead(d.svg, cx, cy, 3 * Math.max(0.6, k), 3.4);
}

/** Phase-shifted waves under a slowly breathing envelope, across the block behind its content. */
function drawGuillocheBand(layers, w, h, pad) {
  const d = layers.under;
  if (!d) return;
  const x0 = pad.x + 4;
  const x1 = pad.x + w - 4;
  const cy = pad.y + h / 2;
  const half = h / 2 - 12;
  d.stroke(d.svg, 'M' + R(x0) + ' ' + R(pad.y + 4) + 'H' + R(x1) + 'M' + R(x0) + ' ' + R(pad.y + 8) + 'H' + R(x1)
    + 'M' + R(x0) + ' ' + R(pad.y + h - 4) + 'H' + R(x1) + 'M' + R(x0) + ' ' + R(pad.y + h - 8) + 'H' + R(x1), 'ln', 0.8, Math.ceil(4 * (x1 - x0)) + 8, 0.3, 1.4);
  if (half < 6) return;
  const wl = Math.max(28, Math.min(72, half * 1.1));
  for (let j = 0; j < 16; j++) {
    const pts = [];
    for (let x = x0; x <= x1; x += 2) {
      const a = half * (0.72 + 0.28 * Math.cos(TAU * (x - (x0 + x1) / 2) / Math.max(120, (x1 - x0) / 2)));
      pts.push([x, cy + a * Math.sin(TAU * (x - x0) / wl + j * PI / 8)]);
    }
    d.stroke(d.svg, pathOf(pts), 'hatch', 0.6, lengthOf(pts), 0.6 + j * 0.06, 2.2);
  }
}

/** Ivy climbing a column from the foot: the part behind the column in the under layer, the rest over it. */
function drawIvy(layers, w, h, pad, p) {
  const back = layers.under;
  const over = layers.over;
  if (!back || !over) return;
  const cx = pad.x + w / 2;
  const amp = w / 2 + 4;
  const period = Math.max(60, Math.min(160, w * 4));
  const base = line(cx, pad.y + h - 2, cx, pad.y);
  const L = base.L;
  const t0 = 0.8;
  const T = Math.max(2, Math.min(5, L / 140));
  const size = Math.max(10, Math.min(20, w * 0.3));
  // The back segments land in the under layer, behind the column; both layers keep one clock.
  const fronts = over.group(over.svg);
  over.chain(back.svg, fronts, helix(base.at, L, amp, period, 0, 2), L, t0, T, [['gap', 6], ['vine', 2.4]], ['vback', 1.6]);
  over.chain(back.svg, fronts, helix(base.at, L, amp - 1, period, 2.4, 2), L, t0 + 0.3, T, [['gap', 4], ['vine', 1.2]], ['vback', 1]);
  if (p.leaves > 0) {
    for (const q of helixLeaves(base.at, L, amp, period, 0, { size, alpha: 0.9, from: 12, endGap: 4 })) {
      over.leaf(fronts, q.x, q.y, q.ang, q.size, t0 + T * q.s / L + 0.1, 0.42);
    }
    const top = base.at(L);
    [-2.2, -1.57, -0.9].forEach((a, i) => over.leaf(fronts, top.x, top.y + 2, a, size * 0.75 - i, t0 + T + 0.1 * i, 0.42));
  }
}

/** A wide band wound tight round a rod (the element), bound at both ends. */
function drawWrap(layers, w, h, pad) {
  const back = layers.under;
  const d = layers.over;
  if (!back || !d) return;
  const cy = pad.y + h / 2;
  const rr = h / 2;
  let hatch = '';
  for (const deg of [48, 60, 70, 80]) {
    for (const sg of [-1, 1]) hatch += 'M' + R(pad.x + 4) + ' ' + R(cy + sg * rr * Math.sin(deg * D)) + 'H' + R(pad.x + w - 4);
  }
  back.stroke(back.svg, hatch, 'hatch', 0.6);
  const x0 = pad.x + Math.min(w * 0.12, h * 1.5);
  const x1 = pad.x + w - Math.min(w * 0.12, h * 1.5);
  const base = line(x0, cy, x1, cy);
  const bw = h * 0.46;
  const front = d.group(d.svg);
  d.chain(front, front, helix(base.at, base.L, rr, h * 1.07, 0, 1), base.L, 0.6, Math.max(1, base.L / 200), [['ln', bw + 3], ['band', bw]], null, { butt: true });
  for (const x of [x0 - h * 0.36, x1]) {
    d.fade(d.stroke(d.svg, 'M' + R(x) + ' ' + R(cy - rr - 3) + 'h' + R(h * 0.36) + 'v' + R(h + 6) + 'h' + R(-h * 0.36) + 'Z', 'solid', 1.4), 0.4);
  }
}

/** Scroll brackets either side of a button, drawn for the left and mirrored. */
function drawBrackets(layers, w, h, pad, p) {
  const d = layers.over;
  if (!d) return;
  const k = h / 44;
  const cxc = pad.x + w / 2;
  for (const tf of ['translate(0 0)', 'translate(' + R(2 * cxc) + ' 0) scale(-1 1)']) {
    const g = d.group(d.svg, { transform: tf });
    const bx = pad.x - 12 * k;
    const top = pad.y + 2;
    const bot = pad.y + h - 2;
    d.stroke(g, 'M' + R(bx) + ' ' + R(top) + 'Q' + R(bx - 16 * k) + ' ' + R((top + bot) / 2) + ' ' + R(bx) + ' ' + R(bot), 'ln', 1.4, Math.ceil((bot - top) * 1.15) + 4, 0.2, 0.6);
    const tc = turtle(bx, top, -0.6, 20 * k, (u) => (0.3 + 0.2 * u) / k);
    const bc = turtle(bx, bot, 0.6, 20 * k, (u) => -(0.3 + 0.2 * u) / k);
    d.stroke(g, tc.d, 'ln', 1.2, tc.len, 0.7, 0.5);
    d.stroke(g, bc.d, 'ln', 1.2, bc.len, 0.7, 0.5);
    if (p.leaves > 0) d.leaf(g, bx - 9 * k, (top + bot) / 2, PI, 11 * k, 0.8);
  }
}

/** @type {Record<string, import('./ornament.js').OverlayFigure>} */
export const ROUND_FIGURES = {
  wreath: { params: ['leaves'], overlay: { pad: (w, h) => { const k = Math.min(w, h) / 168; return { x: Math.ceil(72 * k), y: Math.ceil(84 * k) }; }, draw: drawWreath } },
  guilloche: { params: [], overlay: { pad: () => ({ x: 0, y: 0 }), draw: drawGuilloche } },
  'guilloche-band': { params: [], overlay: { pad: () => ({ x: 0, y: 0 }), draw: drawGuillocheBand } },
  ivy: { params: ['leaves'], overlay: { pad: (w) => ({ x: Math.ceil(30 + Math.max(10, Math.min(20, w * 0.3))), y: 16 }), under: true, over: true, draw: drawIvy } },
  wrap: { params: [], overlay: { pad: (_w, h) => ({ x: Math.ceil(h * 0.5), y: 6 }), under: true, over: true, draw: drawWrap } },
  brackets: { params: ['leaves'], overlay: { pad: (_w, h) => ({ x: Math.ceil(30 * h / 44), y: 4 }), under: false, over: true, draw: drawBrackets } },
};
