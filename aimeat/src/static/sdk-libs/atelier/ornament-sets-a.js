/**
 * @file atelier/ornament-sets-a.js
 * @description FOUR ORNAMENT SETS: modern, futuristic, cyberpunk and vibrant, each the five
 *   figures of a set (frame round a card, rule under a heading, bar, list bullets, foot strip),
 *   ported from the accepted set canvas (wish-kymmenen-koristesetti-eri-tyyleiss). The canvas drew
 *   them on a 400 x 248 card, a 356-wide rule and bar and an 832-wide strip; here every length
 *   that ran along an edge is scaled to the element's own size, and every length across it stays.
 *
 *   Colours are roles (ornament-set-pen.js): s1 is the look's accent, s2 and s3 its spectrum.
 * @structure modern · futuristic · cyberpunk · vibrant · SETS_A
 * @usage  Reached through AIMEAT.atelier.ornament(el, '<set>-<frame|rule|bar|bullets|strip>') or ornamentSet().
 * @version-history
 *   v0.1.0 — 2026-10-30 — Initial: ported from the set canvas boards 1 to 4.
 */
import { poly, circ, arc, hex } from './ornament-set-pen.js';

const PI = Math.PI;

/** @type {import('./ornament-set-pen.js').SetStyle} */
const modern = {
  id: 'modern',
  // A hairline drawn all round, two corner brackets growing out of their corners, one accent square.
  frame(P, C) {
    const x0 = C.x - 14, y0 = C.y - 14, x1 = C.x + C.w + 14, y1 = C.y + C.h + 14;
    const arm = Math.min(64, C.w / 4, C.h / 3);
    P.line([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], 'mute', 0.75, 0.1, 1.8);
    P.line([[x0 - 10, y0 + arm], [x0 - 10, y0 - 10], [x0 + arm, y0 - 10]], 'ink', 2, 0.35, 0.6);
    P.line([[x1 + 10, y1 - arm], [x1 + 10, y1 + 10], [x1 - arm, y1 + 10]], 'ink', 2, 0.55, 0.6);
    P.shape(poly([[x1 + 4, y0 - 16], [x1 + 16, y0 - 16], [x1 + 16, y0 - 4], [x1 + 4, y0 - 4]]), 's1', 1.2);
    for (let i = 0; i < 5; i++) P.line([[x0 + 24 + i * 10, y1 + 4], [x0 + 24 + i * 10, y1 + 12]], 'mute', 1, 1.3 + i * 0.06, 0.2);
  },
  // An accent lead, a hairline, ticks every 44 px.
  rule(P, D) {
    const span = D.x1 - D.x0;
    P.line([[D.x0, D.y], [D.x1, D.y]], 'mute', 0.75, 0.3, 1.1);
    P.line([[D.x0, D.y], [D.x0 + Math.min(48, span / 4), D.y]], 's1', 3, 0.2, 0.45);
    for (let x = D.x0 + 88; x <= D.x1 + 0.1; x += 44) P.line([[x, D.y - 4], [x, D.y + 4]], 'ink', 1, 0.5 + (x - D.x0) / span * 0.8, 0.15);
  },
  // An outlined track, a ruler under it and a marker at the value.
  bar(P, B) {
    P.rect(B.x + 0.5, B.y + 0.5, B.w - 1, B.h - 1, 'ink', { stroke: true });
    P.rect(B.x + 1, B.y + 1, (B.w - 2) * B.v, B.h - 2, 's1', { wipe: [0.5, 1.4] });
    for (let i = 0; i <= 10; i++) {
      const x = B.x + B.w * i / 10, h = i % 5 === 0 ? 10 : 5;
      P.line([[x, B.y + B.h + 5], [x, B.y + B.h + 5 + h]], i % 5 === 0 ? 'ink' : 'mute', 1, 0.5 + i * 0.05, 0.15);
    }
    const vx = B.x + B.w * B.v;
    P.line([[vx, B.y - 10], [vx, B.y + B.h + 2]], 'ink', 1.5, 1.8, 0.3);
    P.shape(poly([[vx - 5, B.y - 18], [vx + 5, B.y - 18], [vx, B.y - 10]]), 's1', 1.9);
  },
  // Open squares, the first one filled with the accent.
  bullet(P, p, i) {
    P.line([[p[0] - 5, p[1] - 5], [p[0] + 5, p[1] - 5], [p[0] + 5, p[1] + 5], [p[0] - 5, p[1] + 5], [p[0] - 5, p[1] - 5]], 'ink', 1.5, 0.9 + i * 0.15, 0.4);
    if (i === 0) P.shape(poly([[p[0] - 2.5, p[1] - 2.5], [p[0] + 2.5, p[1] - 2.5], [p[0] + 2.5, p[1] + 2.5], [p[0] - 2.5, p[1] + 2.5]]), 's1', 1.4);
  },
  // A ruler along the foot.
  strip(P, S) {
    const span = S.x1 - S.x0;
    P.line([[S.x0, S.y], [S.x1, S.y]], 'mute', 0.75, 0.6, 1.4);
    for (let x = S.x0; x <= S.x1 + 0.1; x += 16) {
      const big = Math.round((x - S.x0) / 16) % 5 === 0;
      P.line([[x, S.y], [x, S.y - (big ? 10 : 5)]], big ? 'ink' : 'mute', 1, 0.7 + (x - S.x0) / span, 0.12);
    }
  },
};

/** @type {import('./ornament-set-pen.js').SetStyle} */
const futuristic = {
  id: 'futuristic',
  // A chamfered outline drawn from the top-left cut both ways at once, readout ticks, a segmented arc, a crosshair.
  frame(P, C) {
    const x0 = C.x - 12, y0 = C.y - 12, x1 = C.x + C.w + 12, y1 = C.y + C.h + 12, k = 18;
    P.line([[x0 + k, y0], [x1 - k, y0], [x1, y0 + k], [x1, y1 - k], [x1 - k, y1]], 's1', 1.5, 0.1, 1.2);
    P.line([[x0 + k, y0], [x0, y0 + k], [x0, y1 - k], [x0 + k, y1], [x1 - k, y1]], 's1', 1.5, 0.1, 1.2);
    P.line([[x0 - 6, y0 + k + 6], [x0 + k + 6, y0 - 6]], 's2', 3, 1.1, 0.25);
    P.line([[x1 - k - 6, y1 + 6], [x1 + 6, y1 - k - 6]], 's2', 3, 1.25, 0.25);
    const ticks = Math.max(4, Math.min(12, Math.floor((C.w - 2 * k) / 16)));
    for (let i = 0; i < ticks; i++) { const x = x1 - k - 10 - i * 8; P.line([[x, y0 - 4], [x, y0 - (i % 3 === 0 ? 11 : 7)]], i % 3 === 0 ? 's1' : 'pale', 1.2, 1.0 + i * 0.04, 0.15); }
    for (let s = 0; s < 4; s++) { const a0 = PI / 2 + s * PI / 8 + 0.05; P.line(arc(x0, y1, 26, a0, a0 + PI / 8 - 0.1, 6), s === 3 ? 's2' : 's1', 2, 1.2 + s * 0.1, 0.2); }
    const hx = x1 - 34, hy = y1 + 22;
    P.line(arc(hx, hy, 7, 0, PI * 2, 28), 's1', 1.2, 1.5, 0.4);
    P.line([[hx - 14, hy], [hx - 4, hy]], 'pale', 1, 1.7, 0.15); P.line([[hx + 4, hy], [hx + 14, hy]], 'pale', 1, 1.7, 0.15);
    P.line([[hx, hy - 14], [hx, hy - 4]], 'pale', 1, 1.75, 0.15); P.line([[hx, hy + 4], [hx, hy + 14]], 'pale', 1, 1.75, 0.15);
  },
  // Two lines run to a centre diamond, brackets close the ends.
  rule(P, D) {
    const mid = (D.x0 + D.x1) / 2;
    P.line([[D.x0 + 10, D.y], [mid - 16, D.y]], 's1', 1.2, 0.3, 0.6);
    P.line([[D.x1 - 10, D.y], [mid + 16, D.y]], 's1', 1.2, 0.3, 0.6);
    P.line([[mid, D.y - 8], [mid + 8, D.y], [mid, D.y + 8], [mid - 8, D.y], [mid, D.y - 8]], 's2', 1.5, 0.8, 0.4);
    P.shape(poly([[mid, D.y - 3.5], [mid + 3.5, D.y], [mid, D.y + 3.5], [mid - 3.5, D.y]]), 's2', 1.1);
    P.line([[D.x0 + 6, D.y - 6], [D.x0, D.y - 6], [D.x0, D.y + 6], [D.x0 + 6, D.y + 6]], 'mute', 1.2, 0.2, 0.3);
    P.line([[D.x1 - 6, D.y - 6], [D.x1, D.y - 6], [D.x1, D.y + 6], [D.x1 - 6, D.y + 6]], 'mute', 1.2, 0.2, 0.3);
  },
  // Blocks; the filled ones light up in turn, the last lit block in the second colour.
  bar(P, B) {
    const n = Math.max(8, Math.round(24 * B.w / 356)), g = 3, bw = (B.w - (n - 1) * g) / n, lit = Math.round(n * B.v);
    for (let i = 0; i < n; i++) {
      const x = B.x + i * (bw + g), r = [[x, B.y], [x + bw, B.y], [x + bw, B.y + B.h], [x, B.y + B.h]];
      if (i < lit) P.shape(poly(r), i === lit - 1 ? 's2' : 's1', 0.5 + i * 0.06 * 24 / n, 0.25);
      else P.line(r.concat([r[0]]), 'pale', 1, 0.5 + i * 0.03 * 24 / n, 0.2);
    }
    P.line([[B.x - 6, B.y - 4], [B.x - 10, B.y - 4], [B.x - 10, B.y + B.h + 4], [B.x - 6, B.y + B.h + 4]], 'mute', 1.2, 0.4, 0.3);
    P.line([[B.x + B.w + 6, B.y - 4], [B.x + B.w + 10, B.y - 4], [B.x + B.w + 10, B.y + B.h + 4], [B.x + B.w + 6, B.y + B.h + 4]], 'mute', 1.2, 0.4, 0.3);
  },
  // Hexagons, the first one with a lit core.
  bullet(P, p, i) {
    P.line(hex(p[0], p[1], 7, PI / 6), 's1', 1.4, 0.9 + i * 0.15, 0.45);
    if (i === 0) P.shape(poly(hex(p[0], p[1], 3, PI / 6).slice(0, 6)), 's2', 1.4);
  },
  // A dim rail with nodes; lit runs between them in turn.
  strip(P, S) {
    const nodes = [0, 112, 248, 416, 552, 696, 832].map((u) => S.x0 + u / 832 * (S.x1 - S.x0));
    P.line([[S.x0, S.y], [S.x1, S.y]], 'pale', 1, 0.5, 1.2);
    for (let i = 0; i < nodes.length - 1; i++) P.line([[nodes[i] + 6, S.y], [nodes[i + 1] - 6, S.y]], i % 2 ? 's2' : 's1', 2, 0.9 + i * 0.22, 0.3);
    nodes.forEach((x, i) => P.line(arc(x, S.y, 4, 0, PI * 2, 16), 's1', 1.4, 0.8 + i * 0.22, 0.2));
  },
};

/** A via: a ring that draws, then, every other time, a lit core. */
function via(P, x, y, r, role, dl) {
  P.line(arc(x, y, r, 0, PI * 2, 18), role, 1.4, dl, 0.2);
  if (P.rnd() > 0.5) P.shape(circ(x, y, r * 0.45), 's3', dl + 0.2, 0.3);
}

/** @type {import('./ornament-set-pen.js').SetStyle} */
const cyberpunk = {
  id: 'cyberpunk',
  seed: 31,
  // A neon outline with a shifted ghost of three of its runs; traces leave every side, turn at 45 degrees and end in a via.
  frame(P, C) {
    const x0 = C.x - 10, y0 = C.y - 10, x1 = C.x + C.w + 10, y1 = C.y + C.h + 10;
    const kx = (x1 - x0) / 420, ky = (y1 - y0) / 268;
    P.line([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], 's1', 1.6, 0.1, 1.1);
    P.line([[x0 + 40 * kx, y0 - 3], [x0 + 170 * kx, y0 - 3]], 's2', 1.2, 1.0, 0.12);
    P.line([[x1 + 3, y0 + 60 * ky], [x1 + 3, y0 + 130 * ky]], 's2', 1.2, 1.1, 0.12);
    P.line([[x1 - 210 * kx, y1 + 3], [x1 - 120 * kx, y1 + 3]], 's2', 1.2, 1.2, 0.12);
    [40, 84, 150, 204].forEach((u, i) => { const y = y0 + u * ky, s = i % 2 ? 1 : -1; P.line([[x0, y], [x0 - 8, y], [x0 - 18, y + 10 * s], [x0 - 26, y + 10 * s]], i % 2 ? 's2' : 's1', 1.3, 0.6 + i * 0.1, 0.35); via(P, x0 - 30, y + 10 * s, 3.5, 's2', 0.95 + i * 0.1); });
    [60, 110, 290, 340].forEach((u, i) => { const x = x0 + u * kx; P.line([[x, y1], [x, y1 + 8], [x + 12, y1 + 20], [x + 12, y1 + 34]], i % 2 ? 's1' : 's2', 1.3, 0.7 + i * 0.1, 0.35); via(P, x + 12, y1 + 38, 3.5, 's1', 1.05 + i * 0.1); });
    [30, 72].forEach((u, i) => { const y = y0 + u * ky; P.line([[x1, y], [x1 + 10, y], [x1 + 20, y + 10], [x1 + 30, y + 10]], 's2', 1.3, 0.8 + i * 0.1, 0.3); via(P, x1 + 34, y + 10, 3.5, 's2', 1.1 + i * 0.1); });
    [250, 290].forEach((u, i) => { const x = x0 + u * kx; P.line([[x, y0], [x, y0 - 4], [x + 6, y0 - 10]], 's1', 1.3, 0.9 + i * 0.1, 0.25); via(P, x + 9, y0 - 13, 3, 's1', 1.15 + i * 0.1); });
  },
  // A three-line bus with one 45-degree jog, a via at each end of each line.
  rule(P, D) {
    const mid = (D.x0 + D.x1) / 2;
    ['s1', 's2', 's1'].forEach((role, j) => {
      const y = D.y - 7 + j * 5;
      P.line([[D.x0 + 6, y], [mid - 8, y], [mid, y + 8], [D.x1 - 6, y + 8]], role, 1.3, 0.3 + j * 0.08, 0.9);
      P.line(arc(D.x0 + 3, y, 2.5, 0, PI * 2, 12), role, 1, 0.25, 0.15);
      P.line(arc(D.x1 - 3, y + 8, 2.5, 0, PI * 2, 12), role, 1, 1.2, 0.15);
    });
  },
  // A neon track, a ghost of its edges, data packets in the filled run, a cursor at the value.
  bar(P, B) {
    const vx = B.x + B.w * B.v;
    P.rect(B.x + 0.5, B.y + 0.5, B.w - 1, B.h - 1, 's1', { stroke: true });
    P.rect(B.x + 1, B.y + 1, (B.w - 2) * B.v, B.h - 2, 's1', { wipe: [0.5, 1.4, 'steps(12, end)'] });
    P.line([[B.x, B.y - 3], [vx, B.y - 3]], 's2', 1, 1.3, 0.2);
    if (vx - 60 > B.x + 40) P.line([[B.x + 40, B.y + B.h + 3], [vx - 60, B.y + B.h + 3]], 's2', 1, 1.4, 0.2);
    for (let i = 0, x = B.x + 14; x + 6 < vx - 10; i++, x += 36) P.shape(poly([[x, B.y + 3], [x + 6, B.y + 3], [x + 6, B.y + B.h - 3], [x, B.y + B.h - 3]]), 's3', 1.5 + i * 0.07, 0.2);
    P.line([[vx + 2, B.y - 7], [vx + 2, B.y + B.h + 7]], 's2', 2, 1.9, 0.15);
  },
  // A via with a short stub, the first one lit.
  bullet(P, p, i) {
    P.line(arc(p[0], p[1], 5, 0, PI * 2, 20), 's1', 1.5, 0.9 + i * 0.15, 0.3);
    P.line([[p[0] + 5, p[1]], [p[0] + 9, p[1] - 4], [p[0] + 14, p[1] - 4]], 's2', 1.3, 1.1 + i * 0.15, 0.2);
    if (i === 0) P.shape(circ(p[0], p[1], 2.2), 's3', 1.3);
  },
  // Three traces along the foot, each jogging twice at its own places.
  strip(P, S) {
    const k = (S.x1 - S.x0) / 832;
    [[S.y - 10, 's2'], [S.y, 's1'], [S.y + 10, 'pale']].forEach((row, j) => {
      const y = /** @type {number} */ (row[0]), role = /** @type {string} */ (row[1]);
      const a = S.x0 + (80 + P.rnd() * 260) * k, b = Math.min(S.x1 - 12, a + (180 + P.rnd() * 260) * k), s = j === 1 ? 1 : -1;
      P.line([[S.x0, y], [a, y], [a + 6, y + 6 * s], [b, y + 6 * s], [b + 6, y], [S.x1, y]], role, 1.4, 0.5 + j * 0.12, 1.4);
      via(P, S.x1 + 4, y, 3, role, 1.9 + j * 0.1);
    });
  },
};

/** A wave along a straight run from a to b. */
function wave(a, b, amp, per, ph) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, o = [];
  for (let s = 0; s <= len; s += 3) { const w = amp * Math.sin(2 * PI * s / per + ph); o.push([a[0] + dx * s / len + nx * w, a[1] + dy * s / len + ny * w]); }
  return o;
}

/** A five-pointed star. */
function star(x, y, r) {
  const o = [];
  for (let i = 0; i < 10; i++) { const a = -PI / 2 + i * PI / 5, q = i % 2 ? r * 0.45 : r; o.push([x + q * Math.cos(a), y + q * Math.sin(a)]); }
  return poly(o);
}

/** @type {import('./ornament-set-pen.js').SetStyle} */
const vibrant = {
  id: 'vibrant',
  seed: 5,
  barH: 16,
  popEase: 'cubic-bezier(.3,1.7,.5,1)',
  // One thick wavy ribbon per side, each in its own colour, then confetti round the card.
  frame(P, C) {
    const x0 = C.x - 16, y0 = C.y - 16, x1 = C.x + C.w + 16, y1 = C.y + C.h + 16;
    P.line(wave([x0 + 18, y0], [x1 - 18, y0], 4, 40, 0), 's1', 6, 0.1, 0.7);
    P.line(wave([x1, y0 + 18], [x1, y1 - 18], 4, 40, 0), 's3', 6, 0.45, 0.55);
    P.line(wave([x1 - 18, y1], [x0 + 18, y1], 4, 40, 0), 's2', 6, 0.75, 0.7);
    P.line(wave([x0, y1 - 18], [x0, y0 + 18], 4, 40, 0), 's4', 6, 1.1, 0.55);
    // The canvas placed the confetti round a 400 x 248 card at (64, 232); outside the card a spot keeps its distance, inside it scales.
    const map = (v, lo, len, size, at) => (v < lo ? at + (v - lo) : v > lo + len ? at + size + (v - lo - len) : at + (v - lo) / len * size);
    const roles = ['s1', 's3', 's2', 's4'];
    [[34, 250], [26, 330], [40, 420], [30, 470], [110, 516], [190, 526], [290, 512], [380, 528], [440, 516], [500, 250], [508, 330], [496, 410], [512, 470]].forEach((q, i) => {
      const x = map(q[0], 64, 400, C.w, C.x), y = map(q[1], 232, 248, C.h, C.y), role = roles[i % 4], kind = i % 3, dl = 1.3 + i * 0.05;
      if (kind === 0) P.shape(circ(x, y, 3 + P.rnd() * 2.5), role, dl);
      else if (kind === 1) P.shape(poly([[x, y - 5], [x + 5, y + 4], [x - 5, y + 4]]), role, dl);
      else P.line([[x - 6, y], [x - 2, y - 4], [x + 2, y], [x + 6, y - 4]], role, 2.5, dl, 0.25);
    });
  },
  // Two waves half a period apart, a dot at each end.
  rule(P, D) {
    P.line(wave([D.x0 + 10, D.y], [D.x1 - 10, D.y], 5, 36, 0), 's1', 4, 0.3, 1.0);
    P.line(wave([D.x0 + 10, D.y], [D.x1 - 10, D.y], 5, 36, PI), 's4', 4, 0.45, 1.0);
    P.shape(circ(D.x0 + 2, D.y, 4.5), 's3', 0.25); P.shape(circ(D.x1 - 2, D.y, 4.5), 's3', 1.4);
  },
  // A rounded track, a wave riding the filled run, a star where it ends.
  bar(P, B) {
    const vx = B.x + B.w * B.v, my = B.y + B.h / 2;
    P.rect(B.x, B.y, B.w, B.h, 't3', { rx: B.h / 2 });
    P.rect(B.x, B.y, B.w * B.v, B.h, 's3', { rx: B.h / 2, wipe: [0.5, 1.4, 'cubic-bezier(.3,1.3,.5,1)'] });
    if (vx - 14 > B.x + 10) P.line(wave([B.x + 10, my], [vx - 14, my], 2.5, 18, 0), 's4', 2.5, 1.2, 0.7);
    P.shape(star(vx + 2, B.y - 8, 9), 's1', 1.9, 0.6);
  },
  // Dots in three colours, each with a small bounce beside it.
  bullet(P, p, i) {
    P.shape(circ(p[0], p[1], 7), ['s1', 's2', 's4'][i % 3], 0.9 + i * 0.15, 0.6);
    P.shape(circ(p[0] + 6, p[1] - 6, 2.5), 's3', 1.1 + i * 0.15, 0.4);
  },
  // A zigzag in four colour runs.
  strip(P, S) {
    const run = (S.x1 - S.x0) / 4, roles = ['s1', 's3', 's2', 's4'];
    for (let k = 0; k < 4; k++) {
      const o = [];
      for (let x = S.x0 + k * run; x <= S.x0 + (k + 1) * run + 0.1; x += 12) o.push([x, S.y + (Math.round((x - S.x0) / 12) % 2 ? -7 : 7)]);
      P.line(o, roles[k], 5, 0.6 + k * 0.3, 0.35);
    }
  },
};

export const SETS_A = [modern, futuristic, cyberpunk, vibrant];
