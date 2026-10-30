/**
 * @file atelier/ornament-sets-b.js
 * @description FOUR ORNAMENT SETS: emotional, dramatic, symmetrical and chaotic, each the five
 *   figures of a set (frame, rule, bar, bullets, strip), ported from the accepted set canvas
 *   (wish-kymmenen-koristesetti-eri-tyyleiss) the same way as ornament-sets-a.js: lengths along an
 *   edge follow the element, lengths across it stay as drawn.
 *
 *   The chaotic set takes one knob of its own, `mess` (0.5 to 2): how far its scribbles wander.
 *   Its randomness is seeded, so the same scribble is drawn every time.
 * @structure emotional · dramatic · symmetrical · chaotic · SETS_B
 * @usage  Reached through AIMEAT.atelier.ornament(el, '<set>-<frame|rule|bar|bullets|strip>') or ornamentSet().
 * @version-history
 *   v0.1.0 — 2026-10-30 — Initial: ported from the set canvas boards 5 to 8.
 */
import { poly, circ, bz } from './ornament-set-pen.js';

const PI = Math.PI;

/** A hand: the polyline resampled every 4 px and pushed sideways by a slow wobble of its own. */
function hand(P, pts, amp) {
  const p1 = P.rnd() * 6, p2 = P.rnd() * 6, o = [];
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    for (let u = 0; u < len; u += 4) { const w = amp * (0.6 * Math.sin((s + u) / 23 + p1) + 0.4 * Math.sin((s + u) / 9 + p2)); o.push([a[0] + dx * u / len + nx * w, a[1] + dy * u / len + ny * w]); }
    s += len;
  }
  o.push(pts[pts.length - 1]);
  return o;
}

/** A petal: a teardrop with its tip at angle a. */
function petal(x, y, s, a) {
  const raw = bz([0, -s], [s * 0.6, -s * 0.3], [s * 0.5, s * 0.5], [0, s * 0.5], 10).concat(bz([0, s * 0.5], [-s * 0.5, s * 0.5], [-s * 0.6, -s * 0.3], [0, -s], 10));
  const c = Math.cos(a), sn = Math.sin(a);
  return poly(raw.map((p) => [x + p[0] * c - p[1] * sn, y + p[0] * sn + p[1] * c]));
}

/** @type {import('./ornament-set-pen.js').SetStyle} */
const emotional = {
  id: 'emotional',
  seed: 13,
  ease: 'cubic-bezier(.35,0,.25,1)',
  popEase: 'cubic-bezier(.3,1.4,.55,1)',
  // The outline twice by hand, each pass a little off the other; a curl at the top left, petals falling at the lower right.
  frame(P, C) {
    const x0 = C.x - 14, y0 = C.y - 14, x1 = C.x + C.w + 14, y1 = C.y + C.h + 14;
    P.line(hand(P, [[x0 + 30, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0], [x0 + 60, y0 + 1]], 1.8), 's1', 1.6, 0.1, 2.2);
    P.line(hand(P, [[x0 + 4, y0 + 3], [x1 - 3, y0 - 2], [x1 + 3, y1 - 4], [x0 - 2, y1 + 3], [x0 + 3, y0 - 3], [x0 + 30, y0 - 2]], 2.4), 's2', 1, 0.5, 2.2);
    P.line(bz([x0 + 30, y0], [x0 - 4, y0 - 2], [x0 - 26, y0 - 4], [x0 - 22, y0 + 14], 16).concat(bz([x0 - 22, y0 + 14], [x0 - 18, y0 + 30], [x0 + 4, y0 + 22], [x0 - 4, y0 + 10], 14)), 's1', 1.6, 2.1, 0.6);
    [[x1 - 8, y1 + 20, 9, 2.4, 's1'], [x1 + 18, y1 + 6, 7, 3.1, 's3'], [x1 - 40, y1 + 34, 6, 1.9, 's2'], [x1 + 12, y1 + 38, 8, 2.7, 's3']]
      .forEach((q, i) => P.shape(petal(/** @type {number} */ (q[0]), /** @type {number} */ (q[1]), /** @type {number} */ (q[2]), /** @type {number} */ (q[3])), /** @type {string} */ (q[4]), 2.0 + i * 0.25, 0.9, 'drift'));
  },
  // A handwritten line that ties one loop in the middle.
  rule(P, D) {
    const mid = (D.x0 + D.x1) / 2;
    const loop = bz([mid - 34, D.y], [mid + 12, D.y + 2], [mid + 14, D.y - 24], [mid, D.y - 24], 16).concat(bz([mid, D.y - 24], [mid - 14, D.y - 24], [mid - 10, D.y + 2], [mid + 34, D.y], 16));
    P.line(hand(P, [[D.x0, D.y + 2], [mid - 34, D.y]], 1.2).concat(loop).concat(hand(P, [[mid + 34, D.y], [D.x1, D.y - 2]], 1.2)), 's1', 1.8, 0.3, 1.6);
  },
  // A soft pencil track, a thicker stroke over the value, a petal where it stops.
  bar(P, B) {
    const vx = B.x + B.w * B.v, my = B.y + B.h / 2;
    P.line(hand(P, [[B.x, my], [B.x + B.w, my]], 1), 'pale', 2, 0.3, 1.0);
    if (vx > B.x + 6) P.line(hand(P, [[B.x + 2, my], [vx, my]], 1.4), 's1', 6, 0.7, 1.2);
    P.shape(petal(vx + 10, my - 8, 7, 2.2), 's3', 1.9, 0.9, 'drift');
  },
  // Petals in the three soft colours.
  bullet(P, p, i) {
    P.shape(petal(p[0], p[1], 8, -0.5 + (i % 3) * 0.3), ['s1', 's2', 's3'][i % 3], 0.9 + i * 0.2, 0.7, 'drift');
  },
  // A quiet line that beats once in the middle.
  strip(P, S) {
    const sm = (S.x0 + S.x1) / 2, y = S.y;
    const beat = [[S.x0, y], [sm - 60, y]]
      .concat(bz([sm - 60, y], [sm - 44, y], [sm - 40, y + 8], [sm - 30, y + 6], 6))
      .concat(bz([sm - 30, y + 6], [sm - 18, y + 4], [sm - 16, y - 26], [sm - 4, y - 24], 8))
      .concat(bz([sm - 4, y - 24], [sm + 8, y - 22], [sm + 8, y + 14], [sm + 22, y + 12], 8))
      .concat(bz([sm + 22, y + 12], [sm + 34, y + 10], [sm + 40, y], [sm + 60, y], 6))
      .concat([[S.x1, y]]);
    P.line(hand(P, beat, 0.6), 's1', 2, 0.6, 2.4);
  },
};

/** A diamond, taller than wide. */
const diamond = (x, y, r) => poly([[x, y - r], [x + r * 0.7, y], [x, y + r], [x - r * 0.7, y]]);

/** A tapered stroke as a filled outline: the width follows wf(u) for u from 0 to 1 along the points. */
function taper(pts, wf) {
  let tot = 0;
  for (let i = 1; i < pts.length; i++) tot += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const left = [], right = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, w = wf(s / (tot || 1)) / 2;
    left.push([pts[i][0] - dy / len * w, pts[i][1] + dx / len * w]);
    right.push([pts[i][0] + dy / len * w, pts[i][1] - dx / len * w]);
  }
  return poly(left.concat(right.reverse()));
}

/** n + 1 points along a straight run. */
const seg = (a, b, n) => { const o = []; for (let i = 0; i <= n; i++) o.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); return o; };

/** @type {import('./ornament-set-pen.js').SetStyle} */
const dramatic = {
  id: 'dramatic',
  ease: 'cubic-bezier(.7,0,.2,1)',
  // A heavy rule opened from the top centre both ways, a fine inner rule, swashes and a diamond on top, rays under the card.
  frame(P, C) {
    const cx = C.x + C.w / 2, x0 = C.x - 18, y0 = C.y - 18, x1 = C.x + C.w + 18, y1 = C.y + C.h + 18;
    const reach = Math.min(150, C.w / 2 - 10);
    P.line([[cx, y0], [x1, y0], [x1, y1], [cx, y1]], 's2', 3, 0.1, 1.1);
    P.line([[cx, y0], [x0, y0], [x0, y1], [cx, y1]], 's2', 3, 0.1, 1.1);
    P.line([[C.x - 8, C.y - 8], [C.x + C.w + 8, C.y - 8], [C.x + C.w + 8, C.y + C.h + 8], [C.x - 8, C.y + C.h + 8], [C.x - 8, C.y - 8]], 's2', 0.8, 0.9, 1.3);
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach((q, i) => P.shape(diamond(q[0], q[1], 7), 's1', 1.1 + i * 0.05));
    for (const sx of [-1, 1]) {
      P.line(seg([cx + sx * 12, y0 - 6], [cx + sx * reach, y0 - 6], 20), 's2', 0.8, 1.2, 0.5);
      P.shape(taper(seg([cx + sx * 12, y0 - 6], [cx + sx * reach, y0 - 6], 30), (u) => 6 * (1 - u)), 's2', 1.5, 0.7, 'fade');
    }
    P.shape(diamond(cx, y0 - 6, 14), 's1', 1.0, 0.6);
    for (let i = 0; i < 11; i++) {
      const a = PI * (0.18 + 0.64 * i / 10), r1 = i % 2 ? 16 : 30;
      P.line([[cx + 6 * Math.cos(a), y1 + 6 * Math.sin(a)], [cx + r1 * Math.cos(a), y1 + r1 * Math.sin(a)]], 's2', 1, 1.4 + Math.abs(i - 5) * 0.05, 0.3);
    }
  },
  // A blade, thickest in the middle, a hairline under it and a diamond at its heart.
  rule(P, D) {
    const mid = (D.x0 + D.x1) / 2, inset = Math.min(50, (D.x1 - D.x0) / 6);
    P.line(seg([D.x0, D.y], [D.x1, D.y], 2), 's2', 0.8, 0.3, 0.8);
    P.shape(taper(seg([D.x0, D.y], [D.x1, D.y], 60), (u) => 7 * Math.sin(PI * u)), 's1', 0.9, 0.8, 'fade');
    P.line(seg([D.x0 + inset, D.y + 9], [D.x1 - inset, D.y + 9], 2), 's2', 0.8, 1.1, 0.6);
    P.line([[mid, D.y - 10], [mid + 7, D.y], [mid, D.y + 10], [mid - 7, D.y], [mid, D.y - 10]], 's2', 1.5, 1.4, 0.4);
  },
  // A dark track in a fine rule, a mark at the value with a diamond, a hairline under the track.
  bar(P, B) {
    const vx = B.x + B.w * B.v;
    P.rect(B.x, B.y, B.w, B.h, 'deep');
    P.rect(B.x + 0.5, B.y + 0.5, B.w - 1, B.h - 1, 's2', { stroke: true });
    P.rect(B.x + 1, B.y + 1, (B.w - 2) * B.v, B.h - 2, 's1', { wipe: [0.5, 1.6] });
    P.line([[vx, B.y - 12], [vx, B.y + B.h + 12]], 's2', 1.5, 2.0, 0.25);
    P.shape(diamond(vx, B.y - 16, 6), 's2', 2.1);
    P.line(seg([B.x, B.y + B.h + 6], [B.x + B.w, B.y + B.h + 6], 2), 's2', 0.6, 0.6, 1.0);
  },
  // Diamonds inside fine outlines.
  bullet(P, p, i) {
    P.line([[p[0], p[1] - 9], [p[0] + 6, p[1]], [p[0], p[1] + 9], [p[0] - 6, p[1]], [p[0], p[1] - 9]], 's2', 1.2, 0.9 + i * 0.15, 0.35);
    P.shape(diamond(p[0], p[1], 4.5), 's1', 1.15 + i * 0.15);
  },
  // Two swords drawn out from a centre diamond.
  strip(P, S) {
    const sm = (S.x0 + S.x1) / 2;
    P.line(seg([sm - 16, S.y], [S.x0, S.y], 2), 's2', 0.8, 0.5, 0.9); P.line(seg([sm + 16, S.y], [S.x1, S.y], 2), 's2', 0.8, 0.5, 0.9);
    P.shape(taper(seg([sm - 16, S.y], [S.x0 + 20, S.y], 50), (u) => 5 * (1 - u)), 's2', 1.2, 0.7, 'fade');
    P.shape(taper(seg([sm + 16, S.y], [S.x1 - 20, S.y], 50), (u) => 5 * (1 - u)), 's2', 1.2, 0.7, 'fade');
    P.shape(diamond(sm, S.y, 12), 's1', 0.4, 0.6);
    P.shape(diamond(S.x0, S.y, 5), 's1', 1.4); P.shape(diamond(S.x1, S.y, 5), 's1', 1.4);
  },
};

/** Reflections: x about mx, y about my. */
const mirX = (pts, mx) => pts.map((p) => [2 * mx - p[0], p[1]]);
const mirY = (pts, my) => pts.map((p) => [p[0], 2 * my - p[1]]);

/** A rosette: n lens-shaped petals round a centre, turning in together, and a core in the ground colour. */
function rosette(P, x, y, r, n, role, dl) {
  for (let i = 0; i < n; i++) {
    const a = i * 2 * PI / n, c = Math.cos(a), s = Math.sin(a);
    const lens = bz([0, 0], [r * 0.3, -r * 0.36], [r * 0.75, -r * 0.3], [r, 0], 8).concat(bz([r, 0], [r * 0.75, r * 0.3], [r * 0.3, r * 0.36], [0, 0], 8));
    P.shape(poly(lens.map((p) => [x + p[0] * c - p[1] * s, y + p[0] * s + p[1] * c])), role, dl, 0.6, 'turn');
  }
  P.shape(circ(x, y, r * 0.22), 'ground', dl + 0.15, 0.4);
}

/** @type {import('./ornament-set-pen.js').SetStyle} */
const symmetrical = {
  id: 'symmetrical',
  popEase: 'cubic-bezier(.3,1.4,.55,1)',
  // Both halves drawn from the top centre and meeting at the bottom centre, an inner rule the same way, rosettes on the corners, mirrored scrolls.
  frame(P, C) {
    const cx = C.x + C.w / 2, cy = C.y + C.h / 2, x0 = C.x - 14, y0 = C.y - 14, x1 = C.x + C.w + 14, y1 = C.y + C.h + 14;
    const half = [[cx, y0], [x1, y0], [x1, y1], [cx, y1]];
    P.line(half, 's1', 1.5, 0.1, 1.4); P.line(mirX(half, cx), 's1', 1.5, 0.1, 1.4);
    const inner = [[cx, y0 + 7], [x1 - 7, y0 + 7], [x1 - 7, y1 - 7], [cx, y1 - 7]];
    P.line(inner, 's2', 0.8, 0.5, 1.4); P.line(mirX(inner, cx), 's2', 0.8, 0.5, 1.4);
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach((q) => rosette(P, q[0], q[1], 11, 8, 's1', 1.4));
    const curl = bz([cx, y0], [cx - 14, y0 - 16], [cx - 40, y0 - 14], [cx - 40, y0 - 4], 16).concat(bz([cx - 40, y0 - 4], [cx - 40, y0 + 1], [cx - 32, y0 + 1], [cx - 32, y0 - 5], 8));
    for (const c of [curl, mirX(curl, cx), mirY(curl, cy), mirX(mirY(curl, cy), cx)]) P.line(c, 's2', 1.4, 1.0, 0.6);
    const side = bz([x0, cy], [x0 - 14, cy - 10], [x0 - 14, cy - 30], [x0 - 5, cy - 34], 14);
    for (const c of [side, mirY(side, cy), mirX(side, cx), mirX(mirY(side, cy), cx)]) P.line(c, 's2', 1.4, 1.1, 0.5);
    P.shape(circ(cx, y0, 3), 's2', 1.5); P.shape(circ(cx, y1, 3), 's2', 1.5);
  },
  // A rosette in the middle, lines growing out to both ends, a scroll at each end.
  rule(P, D) {
    const mid = (D.x0 + D.x1) / 2;
    rosette(P, mid, D.y, 10, 8, 's2', 0.2);
    P.line([[mid + 14, D.y], [D.x1 - 20, D.y]], 's1', 1.4, 0.5, 0.9); P.line([[mid - 14, D.y], [D.x0 + 20, D.y]], 's1', 1.4, 0.5, 0.9);
    const end = bz([D.x1 - 20, D.y], [D.x1 - 6, D.y], [D.x1, D.y - 12], [D.x1 - 10, D.y - 12], 10);
    P.line(end, 's1', 1.4, 1.35, 0.35); P.line(mirX(end, mid), 's1', 1.4, 1.35, 0.35);
    [0.33, 0.66].forEach((k) => { P.shape(circ(mid + (D.x1 - 20 - mid) * k, D.y, 2.5), 's2', 0.8 + k); P.shape(circ(mid - (mid - D.x0 - 20) * k, D.y, 2.5), 's2', 0.8 + k); });
  },
  // A rounded track, mirrored end brackets and a mark at the middle.
  bar(P, B) {
    const bm = B.x + B.w / 2, by = B.y + B.h / 2;
    P.rect(B.x + 0.5, B.y + 0.5, B.w - 1, B.h - 1, 's1', { stroke: true, rx: B.h / 2 });
    P.rect(B.x + 1, B.y + 1, (B.w - 2) * B.v, B.h - 2, 's1', { rx: (B.h - 2) / 2, wipe: [0.5, 1.4] });
    const cap = [[B.x + B.w + 6, B.y - 5], [B.x + B.w + 11, by], [B.x + B.w + 6, B.y + B.h + 5]];
    P.line(cap, 's2', 1.4, 0.4, 0.3); P.line(mirX(cap, bm), 's2', 1.4, 0.4, 0.3);
    P.line([[bm, B.y - 8], [bm, B.y - 2]], 's2', 1.4, 0.3, 0.2); P.line([[bm, B.y + B.h + 2], [bm, B.y + B.h + 8]], 's2', 1.4, 0.3, 0.2);
  },
  // Four-petal rosettes.
  bullet(P, p, i) { rosette(P, p[0], p[1], 8, 4, i === 0 ? 's1' : 's2', 0.9 + i * 0.15); },
  // From the middle outward: rosettes at the centre and the quarters, diamonds between, all in pairs.
  strip(P, S) {
    const sm = (S.x0 + S.x1) / 2, q = (S.x1 - S.x0) / 4;
    P.line([[sm + 14, S.y], [S.x1, S.y]], 's1', 1, 0.5, 1.2); P.line([[sm - 14, S.y], [S.x0, S.y]], 's1', 1, 0.5, 1.2);
    rosette(P, sm, S.y, 12, 8, 's1', 0.3);
    [1, 2].forEach((k) => { rosette(P, sm + q * k, S.y, k === 1 ? 8 : 6, 6, 's2', 0.6 + k * 0.5); rosette(P, sm - q * k, S.y, k === 1 ? 8 : 6, 6, 's2', 0.6 + k * 0.5); });
    [0.5, 1.5].forEach((k) => { const dl = 0.6 + k * 0.5; [sm + q * k, sm - q * k].forEach((x) => P.shape(poly([[x, S.y - 5], [x + 4, S.y], [x, S.y + 5], [x - 4, S.y]]), 's1', dl)); });
  },
};

/** A scribbled loop round a rectangle: a drifting sideways offset and an overshoot past the start. */
function loopRound(P, x0, y0, x1, y1, amp, over, mess) {
  const per = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0], [x0 + over, y0]], o = [];
  let v = 0;
  for (let i = 1; i < per.length; i++) {
    const a = per[i - 1], b = per[i], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    for (let u = 0; u < len; u += 7) { v = v * 0.8 + (P.rnd() - 0.5) * amp * mess; o.push([a[0] + dx * u / len + nx * v, a[1] + dy * u / len + ny * v]); }
  }
  return o;
}

/** A knot: a pen circling a point at a wandering radius. */
function knot(P, x, y, r, steps, mess) {
  const o = [];
  let a = P.rnd() * 6;
  for (let i = 0; i < steps; i++) { a += 0.6 + P.rnd() * 0.7; const q = r * (0.4 + P.rnd() * 0.6 * mess); o.push([x + q * Math.cos(a), y + q * Math.sin(a)]); }
  return o;
}

/** A walk from left to right, the height drifting and now and then turning a small loop. */
function walk(P, xa, xb, y, amp, loops, mess) {
  const o = [];
  let v = 0, x = xa;
  while (x < xb) {
    v = v * 0.85 + (P.rnd() - 0.5) * amp * mess;
    o.push([x, y + v]);
    if (loops && P.rnd() < 0.06) {
      const r = 4 + P.rnd() * 5;
      for (let k = 1; k <= 10; k++) { const a = PI / 2 + k * 2 * PI / 10; o.push([x + r * Math.cos(a), y + v - r + r * Math.sin(a)]); }
    }
    x += 5 + P.rnd() * 6;
  }
  o.push([xb, y]);
  return o;
}

/** @type {import('./ornament-set-pen.js').SetStyle} */
const chaotic = {
  id: 'chaotic',
  seed: 2026,
  ease: 'cubic-bezier(.5,.1,.5,.9)',
  popEase: 'cubic-bezier(.2,2,.5,1)',
  // Three scribbled loops in three inks, a knot on the top-right corner, a splatter at the lower left.
  frame(P, C, p) {
    const x0 = C.x - 10, y0 = C.y - 10, x1 = C.x + C.w + 10, y1 = C.y + C.h + 10, m = p.mess;
    P.line(loopRound(P, x0, y0, x1, y1, 6, 40, m), 'ink', 1.4, 0.1, 1.6);
    P.line(loopRound(P, x0 - 4, y0 + 3, x1 + 5, y1 - 2, 9, 70, m), 's1', 2.2, 0.5, 1.4);
    P.line(loopRound(P, x0 + 3, y0 - 5, x1 - 2, y1 + 6, 7, 20, m), 's2', 1.1, 0.9, 1.3);
    P.line(knot(P, x1 + 2, y0 + 2, 16, 26, m), 'ink', 1.3, 1.6, 0.7);
    for (let i = 0; i < 14; i++) {
      const a = P.rnd() * PI * 2, q = 6 + P.rnd() * 34;
      P.shape(circ(x0 + 10 + q * Math.cos(a) * 0.9, y1 + 8 + q * Math.sin(a) * 0.5, 0.8 + P.rnd() * 3.2), ['ink', 's1', 's2'][i % 3], 1.5 + P.rnd() * 0.6);
    }
  },
  // A wandering line that ties a few small loops on its way, an echo under it.
  rule(P, D, p) {
    P.line(walk(P, D.x0, D.x1, D.y, 6, true, p.mess), 'ink', 1.6, 0.3, 1.5);
    P.line(walk(P, D.x0 + 20, D.x1 - 30, D.y + 5, 5, false, p.mess), 's2', 1, 0.7, 1.2);
  },
  // A scribbled outline and a zigzag hatched over the value.
  bar(P, B, p) {
    const vx = B.x + B.w * B.v, hz = [];
    P.line(loopRound(P, B.x - 2, B.y - 2, B.x + B.w + 2, B.y + B.h + 2, 2.5, 30, p.mess), 'ink', 1.2, 0.3, 1.1);
    for (let x = B.x + 2, k = 0; x < vx; x += 3 + P.rnd() * 3, k++) hz.push([x, k % 2 ? B.y + B.h - P.rnd() * 2 : B.y + P.rnd() * 2]);
    P.line(hz, 's1', 1.6, 0.8, 1.2);
  },
  // Small knots in the three inks.
  bullet(P, pt, i, p) { P.line(knot(P, pt[0], pt[1], 6, 12, p.mess), ['ink', 's1', 's2'][i % 3], 1.5, 0.9 + i * 0.15, 0.5); },
  // Three walks that cross one another along the foot.
  strip(P, S, p) {
    [['ink', 1.4], ['s1', 2], ['s2', 1.2]].forEach((q, i) => P.line(walk(P, S.x0, S.x1, S.y + (i - 1) * 4, 9, i === 0, p.mess), /** @type {string} */ (q[0]), /** @type {number} */ (q[1]), 0.5 + i * 0.2, 1.8));
  },
};

export const SETS_B = [emotional, dramatic, symmetrical, chaotic];
