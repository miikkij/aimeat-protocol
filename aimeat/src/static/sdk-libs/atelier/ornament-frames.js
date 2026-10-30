/**
 * @file atelier/ornament-frames.js
 * @description THE FRAME FIGURES: ornaments that go round a block's whole box — the engraved frame
 *   (double rules, hatching, corner scrolls, mid-edge palmettes), the vine twining round the box's
 *   border, the rope of two to four strands, the Jugend panel with stems rising either side, and the
 *   ribbon banner behind a title. Each is an OVERLAY figure for ornament.js: it says how far it
 *   reaches outside the box (pad) and draws into the under layer at the box's own size.
 * @structure FRAME_FIGURES = { frame, 'vine-border', rope, jugend, ribbon }
 * @usage  Reached through AIMEAT.atelier.ornament(el, 'frame' | 'vine-border' | 'rope' | 'jugend' | 'ribbon').
 * @version-history
 *   v0.1.0 — 2026-10-29 — Initial: ported from the accepted ornament canvas.
 */
import { R, turtle, at, rrect, roundedRectPath, helix, helixLeaves } from './ornament-geo.js';

const PI = Math.PI;

/** The corner radius an element draws with, so a border hugs a rounded card. */
function radiusOf(host, fallback) {
  const r = host ? parseFloat(getComputedStyle(host).borderTopLeftRadius) : NaN;
  return Number.isFinite(r) && r > 0 ? r : fallback;
}

/** A small flower of n leaves round (x, y), with a bead at its heart. */
function flower(d, parent, x, y, n, r0, size, del) {
  for (let i = 0; i < n; i++) {
    const a = 2 * PI * i / n;
    d.leaf(parent, x + Math.cos(a) * r0, y + Math.sin(a) * r0, a, size, del + 0.04 * i);
  }
  d.bead(parent, x, y, Math.max(2, size * 0.32), del + 0.2);
}

/** The engraved frame: drawn for the top-left corner and mirrored to the others. */
function drawFrame(layers, w, h, _pad, p) {
  const d = layers.under;
  if (!d) return;
  const k = Math.max(0.55, Math.min(1, Math.min(w, h) / 420));
  const rect = (i) => 'M' + R(i) + ' ' + R(i) + 'H' + R(w - i) + 'V' + R(h - i) + 'H' + R(i) + 'Z';
  const rlen = (i) => Math.ceil(2 * (w + h - 4 * i)) + 4;
  let hatch = '';
  const hs = 10 * k;
  for (let x = 3 * k; x <= w - hs - 2; x += 5 * k) hatch += 'M' + R(x) + ' ' + R(hs - 1) + 'l' + R(hs * 0.7) + ' ' + R(-hs * 0.8) + 'M' + R(x) + ' ' + R(h - 1) + 'l' + R(hs * 0.7) + ' ' + R(-hs * 0.8);
  for (let y = hs + 1; y <= h - 3; y += 5 * k) hatch += 'M1 ' + R(y) + 'l' + R(hs * 0.8) + ' ' + R(-hs * 0.8) + 'M' + R(w - hs + 1) + ' ' + R(y) + 'l' + R(hs * 0.8) + ' ' + R(-hs * 0.8);
  d.fade(d.stroke(d.svg, hatch, 'hatch', 0.8), 1.2);
  d.stroke(d.svg, rect(0), 'ln', 1, rlen(0), 0, 1.8);
  d.stroke(d.svg, rect(10 * k), 'ln', 1.6, rlen(10 * k), 0.15, 1.8);
  d.stroke(d.svg, rect(15 * k), 'ln', 0.8, rlen(15 * k), 0.3, 1.8);

  // The corner scroll, in the top-left corner's own units; it shortens on a small box.
  const t0 = 1.2;
  const T = 2.0;
  const Lc = Math.max(50, Math.min(135, (Math.min(w, h) / k) * 0.27));
  const m = turtle(46, 34, 0, Lc, (u) => -0.0015 + (0.27 * 135 / Lc) * Math.pow(u, 4));
  const pa = at(m, 0.42);
  const b = turtle(pa.x, pa.y, pa.h + 0.8, 62 * Lc / 135, (u) => (0.012 + 0.32 * u * u) * 135 / Lc);
  const lush = p.leaves;
  const corner = (g) => {
    d.stroke(g, 'M15 58A43 43 0 0 0 58 15', 'ln', 1.2, 72, 0.9, 0.8);
    d.stroke(g, 'M15 64A49 49 0 0 0 64 15', 'ln', 0.8, 80, 1, 0.8);
    for (const view of ['translate(0 0)', 'matrix(0 1 1 0 0 0)']) {
      const v = d.group(g, { transform: view });
      d.stroke(v, m.d, 'ln', 1.6, m.len, t0, T);
      d.stroke(v, b.d, 'ln', 1.2, b.len, t0 + 0.85, 1.3);
      if (lush > 0) {
        /** @type {Array<[number, number, number]>} where on the scroll (u), which side, how big */
        const onM = [[0.14, -1, 10], [0.3, 1, 12], [0.56, -1, 9], [0.7, 1, 11]];
        if (lush > 1.5) onM.push([0.44, -1, 8], [0.82, 1, 8]);
        for (const [u, side, s] of onM) {
          const q = at(m, u);
          d.leaf(v, q.x, q.y, q.h + side * 0.95, s, t0 + T * u * 0.9 + 0.2);
        }
        const qb = at(b, 0.3);
        d.leaf(v, qb.x, qb.y, qb.h - 0.95, 9, t0 + 1.05 + 1.3 * 0.3);
      }
      d.bead(v, m.end.x, m.end.y, 2.2, t0 + T);
      d.bead(v, b.end.x, b.end.y, 1.8, t0 + 2.15);
    }
    d.rosette(g, 34, 34, 8, 4, 7.5, 12, 0.7);
  };
  for (const [x, y, sx, sy] of [[0, 0, 1, 1], [w, 0, -1, 1], [0, h, 1, -1], [w, h, -1, -1]]) {
    corner(d.group(d.svg, { transform: 'translate(' + R(x) + ' ' + R(y) + ') scale(' + R(sx * k * 100) / 100 + ' ' + R(sy * k * 100) / 100 + ')' }));
  }

  // The middle of an edge: a hanging leaf between two mirrored scrolls, where the edge has room.
  const mid = (tf, len, gain, s0) => {
    const g = d.group(d.svg, { transform: tf });
    for (const sx of [1, -1]) {
      const s = turtle(sx * 4, 24, sx > 0 ? 0.35 : PI - 0.35, len, (u) => sx * (-0.02 + gain * u * u * u));
      d.stroke(g, s.d, 'ln', 1.4, s.len, s0, 1.6);
      if (lush > 0) {
        const p1 = at(s, 0.25);
        const p2 = at(s, 0.5);
        d.leaf(g, p1.x, p1.y, p1.h + sx * 0.95, 11, s0 + 0.5);
        d.leaf(g, p2.x, p2.y, p2.h - sx * 0.95, 8, s0 + 0.9);
      }
      d.bead(g, s.end.x, s.end.y, 2, s0 + 1.6);
    }
    d.leaf(g, 0, 27, PI / 2, 20, s0 + 0.1);
    d.bead(g, 0, 23, 3.2, s0);
  };
  const ks = R(k * 100) / 100;
  if (w / k >= 2 * (46 + Lc) + 200) {
    mid('translate(' + R(w / 2) + ' 0) scale(' + ks + ')', 95, 0.28, 1.8);
    mid('translate(' + R(w / 2) + ' ' + R(h) + ') scale(' + ks + ' ' + -ks + ')', 95, 0.28, 1.8);
  }
  if (h / k >= 2 * (46 + Lc) + 140) {
    mid('translate(0 ' + R(h / 2) + ') rotate(-90) scale(' + ks + ')', 64, 0.42, 1.9);
    mid('translate(' + R(w) + ' ' + R(h / 2) + ') rotate(90) scale(' + ks + ')', 64, 0.42, 1.9);
  }
}

/** Two strands twining round the box's border, closing the loop in a flower. */
function drawVineBorder(layers, w, h, pad, p, host) {
  const d = layers.under;
  if (!d) return;
  const r = radiusOf(host, 18);
  const x = pad.x;
  const y = pad.y;
  const base = rrect(x, y, w, h, r);
  const L = base.L;
  const per = L / Math.max(4, Math.round(L / 72));
  const t0 = 1.0;
  const T = Math.max(2.5, Math.min(6, L / 400));
  d.fade(d.stroke(d.svg, roundedRectPath(x + 9, y + 9, w - 18, h - 18, Math.max(0, r - 9)), 'dim', 0.8), 0.8);
  const back = d.group(d.svg);
  d.stroke(d.svg, roundedRectPath(x, y, w, h, r), 'ln', 3, Math.ceil(L) + 4, 0, 1.2);
  const front = d.group(d.svg);
  d.chain(back, front, helix(base.at, L, 9, per, 0, 2), L, t0, T, [['gap', 6], ['vine', 2.4]], ['vback', 1.6]);
  d.chain(back, front, helix(base.at, L, 7, per, PI, 2), L, t0 + 0.25, T, [['gap', 4], ['vine', 1.2]], ['vback', 1]);
  if (p.leaves > 0) {
    const every = p.leaves > 1.5 ? 1 : 2;
    for (const q of helixLeaves(base.at, L, 9, per, 0, { size: 13, alpha: 0.9, every, from: 6 })) {
      d.leaf(front, q.x, q.y, q.ang, q.size, t0 + T * q.s / L + 0.1);
    }
  }
  const s0 = base.at(0);
  flower(d, front, s0.x, s0.y, 5, 3, 11, t0 + T + 0.2);
}

/** A rope of two to four strands round the box's border. */
function drawRope(layers, w, h, pad, p, host) {
  const d = layers.under;
  if (!d) return;
  const base = rrect(pad.x, pad.y, w, h, radiusOf(host, 14));
  const L = base.L;
  const per = L / Math.max(4, Math.round(L / 34));
  const n = Math.round(p.strands);
  const T = Math.max(2, Math.min(5, L / 400));
  const back = d.group(d.svg);
  const front = d.group(d.svg);
  for (let j = 0; j < n; j++) {
    d.chain(back, front, helix(base.at, L, 6, per, j * 2 * PI / n, 1.5), L, 0.3, T, [['gapc', 7], ['ln', 4], ['hi', 1]], ['dim', 3]);
  }
}

/** The Jugend panel: rules round the box, three stems rising each side, a lily, a cup, a bud. */
function drawJugend(layers, w, h, pad, p) {
  const d = layers.under;
  if (!d) return;
  const k = Math.max(0.45, Math.min(1.4, h / 520));
  const x0 = pad.x;
  const yB = pad.y + h;
  const ground = yB + 62 * k;
  d.stroke(d.svg, roundedRectPath(x0, pad.y, w, h, 14 * k), 'ln', 1.6, Math.ceil(2 * (w + h)) + 8, 0, 1.6);
  d.stroke(d.svg, roundedRectPath(x0 + 8 * k, pad.y + 8 * k, w - 16 * k, h - 16 * k, 8 * k), 'ln', 0.8, Math.ceil(2 * (w + h)) + 8, 0.15, 1.6);
  d.fade(d.stroke(d.svg, 'M' + R(x0 - 160 * k) + ' ' + R(ground) + 'H' + R(x0 + w + 160 * k), 'dim', 1), 0.2);
  const UP = -PI / 2;
  const TAU = 2 * PI;
  const sx = x0 - 64 * k;
  const stems = [
    { dx: 0, h: UP, L: 540, t0: 0.6, k: (u) => 0.0035 * Math.cos(TAU * 1.2 * u) + 0.012 * Math.pow(u, 8), flower: 'lily', lv: [[0.2, 1, 36], [0.34, -1, 30], [0.55, 1, 22], [0.7, -1, 16]] },
    { dx: -14, h: UP - 0.12, L: 430, t0: 0.8, k: (u) => -0.004 * Math.cos(TAU * u + 0.6) - 0.02 * Math.pow(u, 6), flower: 'cup', lv: [[0.25, -1, 30], [0.5, 1, 22]] },
    { dx: 4, h: UP + 0.02, L: 300, t0: 1.0, k: (u) => 0.006 * Math.cos(TAU * 0.8 * u + 1) + 0.025 * Math.pow(u, 6), flower: 'bud', lv: [[0.35, 1, 24]] },
  ];
  for (const tf of ['translate(0 0)', 'translate(' + R(2 * (x0 + w / 2)) + ' 0) scale(-1 1)']) {
    const g = d.group(d.svg, { transform: tf });
    [[-0.38, 110], [-0.16, 88], [0.22, 96]].forEach(([a, s], i) => d.leaf(g, sx - 4 * k, ground, UP + a, s * k, 0.3 + i * 0.12, 0.13));
    for (const st of stems) {
      const dur = 2.6;
      const t = turtle(sx + st.dx * k, ground, st.h, st.L * k, (u) => st.k(u) / k, 2);
      const e = t.end;
      const bloom = st.t0 + dur + 0.1;
      d.stroke(g, t.d, 'vine', 2, t.len, st.t0, dur);
      if (p.leaves > 0) {
        for (const [u, side, s] of st.lv) {
          const q = at(t, u);
          d.leaf(g, q.x, q.y, q.h + side * 0.45, s * k, st.t0 + dur * u * 0.85 + 0.1, 0.22);
        }
      }
      if (st.flower === 'lily') {
        for (const a of [-1.5, 1.5]) d.leaf(g, e.x, e.y, e.h + a, 10 * k, bloom, 0.3, 'petal');
        for (const a of [-0.6, 0.6, 0]) d.leaf(g, e.x, e.y, e.h + a, 26 * k, bloom + 0.1, 0.42, 'petal');
        [-0.22, 0, 0.22].forEach((a, i) => {
          const len = (30 + (i % 2) * 6) * k;
          const x2 = e.x + Math.cos(e.h + a) * len;
          const y2 = e.y + Math.sin(e.h + a) * len;
          d.stroke(g, 'M' + R(e.x) + ' ' + R(e.y) + 'L' + R(x2) + ' ' + R(y2), 'ln', 1, Math.ceil(len) + 2, bloom + 0.5, 0.5);
          d.bead(g, x2, y2, 2.2 * k, bloom + 0.9);
        });
      } else if (st.flower === 'cup') {
        const cx = e.x + Math.cos(e.h) * 9 * k;
        const cy = e.y + Math.sin(e.h) * 9 * k;
        for (let i = 0; i < 6; i++) d.leaf(g, cx, cy, e.h + i * TAU / 6, 15 * k, bloom + 0.05 * i, 0.5, 'petal');
        d.bead(g, cx, cy, 3.4 * k, bloom + 0.4);
      } else {
        for (const a of [-0.5, 0.5]) d.leaf(g, e.x, e.y, e.h + a, 9 * k, bloom, 0.3, 'petal');
        d.leaf(g, e.x, e.y, e.h, 17 * k, bloom + 0.1, 0.5, 'petal');
      }
    }
  }
}

/** A ribbon banner behind a title: an arched band, its ends folded back into swallowtails. */
function drawRibbon(layers, w, h, pad) {
  const d = layers.under;
  if (!d) return;
  const u = h / 54;
  const x0 = pad.x;
  const x1 = pad.x + w;
  const cx = pad.x + w / 2;
  const y0 = pad.y;
  const y1 = pad.y + h;
  const a = Math.min(12 * u, h * 0.22);
  const tails = d.group(d.svg);
  for (const tf of ['translate(0 0)', 'translate(' + R(2 * cx) + ' 0) scale(-1 1)']) {
    const g = d.group(tails, { transform: tf });
    const top = y0 + a + 20 * u;
    const bot = y1 + a + 22 * u;
    const inner = x1 - 14 * u;
    const outer = x1 + 86 * u;
    const tail = 'M' + R(inner) + ' ' + R(top) + 'H' + R(outer) + 'L' + R(outer - 20 * u) + ' ' + R((top + bot) / 2) + 'L' + R(outer) + ' ' + R(bot) + 'H' + R(inner) + 'Z';
    d.stroke(g, tail, 'tail', 1.2);
    d.stroke(g, 'M' + R(inner + 6 * u) + ' ' + R(top + 7 * u) + 'H' + R(outer - 7 * u) + 'M' + R(inner + 6 * u) + ' ' + R(bot - 7 * u) + 'H' + R(outer - 7 * u), 'dim', 0.8);
    d.stroke(g, 'M' + R(x1) + ' ' + R(y1 + a) + 'L' + R(x1) + ' ' + R(bot) + 'L' + R(inner) + ' ' + R(bot) + 'Z', 'crease', 1);
  }
  d.fade(tails, 0.7);
  const band = d.group(d.svg);
  if (d.animate) band.classList.add('ak-orn-unroll');
  const q = (yc) => 'Q' + R(cx) + ' ' + R(yc) + ' ';
  d.stroke(band, 'M' + R(x0) + ' ' + R(y0 + a) + q(y0 - a) + R(x1) + ' ' + R(y0 + a) + 'L' + R(x1) + ' ' + R(y1 + a) + q(y1 - a) + R(x0) + ' ' + R(y1 + a) + 'Z', 'solid', 1.4);
  d.stroke(band, 'M' + R(x0 + 7 * u) + ' ' + R(y0 + a + 6 * u) + q(y0 - a + 6 * u) + R(x1 - 7 * u) + ' ' + R(y0 + a + 6 * u)
    + 'M' + R(x0 + 7 * u) + ' ' + R(y1 + a - 6 * u) + q(y1 - a - 6 * u) + R(x1 - 7 * u) + ' ' + R(y1 + a - 6 * u), 'dim', 0.8);
}

/** @type {Record<string, import('./ornament.js').OverlayFigure>} */
export const FRAME_FIGURES = {
  frame: { params: ['leaves'], overlay: { pad: () => ({ x: 0, y: 0 }), draw: drawFrame } },
  'vine-border': { params: ['leaves'], overlay: { pad: () => ({ x: 26, y: 26 }), draw: drawVineBorder } },
  rope: { params: ['strands'], overlay: { pad: () => ({ x: 12, y: 12 }), draw: drawRope } },
  jugend: {
    params: ['leaves'],
    overlay: {
      pad: (_w, h) => { const k = Math.max(0.45, Math.min(1.4, h / 520)); return { x: Math.ceil(200 * k), y: Math.ceil(76 * k) }; },
      draw: drawJugend,
    },
  },
  ribbon: { params: [], overlay: { pad: (_w, h) => ({ x: Math.ceil(h * 1.7 + 4), y: Math.ceil(h * 0.9) }), draw: drawRibbon } },
};
