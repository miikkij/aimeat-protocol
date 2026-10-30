/**
 * @file atelier/ornament-sets-c.js
 * @description THREE ORNAMENT SETS: velocity, art deco and crystal, each the five figures of a set
 *   (frame, rule, bar, bullets, strip), ported from the accepted set canvas
 *   (wish-kymmenen-koristesetti-eri-tyyleiss) the same way as ornament-sets-a.js.
 * @structure velocity · artDeco · crystal · SETS_C
 * @usage  Reached through AIMEAT.atelier.ornament(el, '<set>-<frame|rule|bar|bullets|strip>') or ornamentSet().
 * @version-history
 *   v0.1.0 — 2026-10-30 — Initial: ported from the set canvas boards 9 to 11.
 */
import { poly, arc, hex } from './ornament-set-pen.js';

const PI = Math.PI;
const DEG = PI / 180;

/** A chevron pointing right, its tip at (x + h * 0.45, y). */
const chev = (x, y, h) => [[x, y - h / 2], [x + h * 0.45, y], [x, y + h / 2]];

/** @type {import('./ornament-set-pen.js').SetStyle} */
const velocity = {
  id: 'velocity',
  seed: 99,
  ease: 'cubic-bezier(.7,0,.25,1)',
  // Speed lines trail off the left edge, the top edge shoots across into a chevron, two lines run under the card, chevrons point on.
  frame(P, C) {
    const x0 = C.x - 12, y0 = C.y - 12, x1 = C.x + C.w + 12, y1 = C.y + C.h + 12;
    const n = Math.max(4, Math.min(12, Math.round(C.h / 27)));
    for (let i = 0; i < n; i++) {
      const y = C.y + 16 + i * (C.h - 32) / Math.max(1, n - 1), len = 12 + P.rnd() * 34;
      P.line([[x0 - 4 - len, y], [x0 - 4, y]], i % 3 === 1 ? 's2' : 'pale', i % 3 === 1 ? 2 : 1.4, 0.05 + i * 0.04, 0.25);
    }
    P.line([[x0, y0], [x1 - 6, y0]], 's2', 2.5, 0.2, 0.45);
    P.line(chev(x1 - 6, y0, 14), 's1', 2.5, 0.62, 0.15);
    P.line([[x0 + 20, y1], [x1, y1]], 'pale', 1.4, 0.35, 0.45);
    P.line([[x0 + Math.min(120, C.w / 3), y1 + 7], [x1 - 30, y1 + 7]], 's1', 1.6, 0.5, 0.4);
    ['s1', 's2', 'pale'].forEach((role, i) => P.line(chev(x1 + 10 + i * 13, C.y + C.h / 2, 18), role, 2.6, 0.8 + i * 0.08, 0.15));
  },
  // A streak that thickens toward its point, with two thinner lines riding beside it.
  rule(P, D) {
    const tail = D.x0, head = D.x1 - 14, wmax = 7, top = [], bot = [], span = D.x1 - D.x0;
    for (let x = tail; x <= head; x += 6) { const u = (x - tail) / (head - tail), w = wmax * Math.pow(u, 1.6) / 2; top.push([x, D.y - w]); bot.push([x, D.y + w]); }
    P.shape(poly(top.concat([[D.x1, D.y]]).concat(bot.reverse())), 's1', 0.3, 0.55, 'shoot');
    P.line([[D.x0 + span * 0.34, D.y - 9], [D.x1 - span * 0.17, D.y - 9]], 's2', 1.3, 0.45, 0.35);
    P.line([[D.x0 + span * 0.17, D.y + 9], [D.x1 - span * 0.34, D.y + 9]], 'pale', 1.3, 0.5, 0.35);
  },
  // A pale track, a striped fill, a chevron at the value with speed lines trailing it.
  bar(P, B) {
    const vx = B.x + B.w * B.v, my = B.y + B.h / 2, fw = B.w * B.v;
    P.rect(B.x, B.y, B.w, B.h, 'pale');
    P.rect(B.x, B.y, fw, B.h, 's1', { wipe: [0.5, 1] });
    // Stripes leaning forward over the fill, the ones that fit inside it.
    const slant = B.h * Math.tan(25 * DEG);
    let d = '';
    for (let x = B.x + 4; x + slant < B.x + fw - 1; x += 14) d += 'M' + P.f(x) + ' ' + P.f(B.y + B.h) + ' L' + P.f(x + slant) + ' ' + P.f(B.y);
    if (d) P.stroke(d, 'd1', 3, 1.5, 0.35, 'fade');
    P.shape(poly([[vx - 4, B.y - 6], [vx + 8, my], [vx - 4, B.y + B.h + 6], [vx + 1, my]]), 's2', 1.4, 0.3, 'shoot');
    if (vx - 14 > B.x) P.line([[Math.max(B.x, vx - 70), B.y - 7], [vx - 14, B.y - 7]], 's2', 1.4, 1.3, 0.25);
    if (vx - 30 > B.x) P.line([[Math.max(B.x, vx - 110), B.y + B.h + 7], [vx - 30, B.y + B.h + 7]], 'pale', 1.4, 1.35, 0.25);
  },
  // Chevrons.
  bullet(P, p, i) { P.line(chev(p[0] - 3, p[1], 14), i === 0 ? 's1' : 's2', 2.6, 0.9 + i * 0.1, 0.18); },
  // A burst of speed lines along the foot, quicker at the far end.
  strip(P, S) {
    const k = (S.x1 - S.x0) / 832;
    for (let i = 0; i < 16; i++) {
      const y = S.y - 14 + P.rnd() * 28, a = S.x0 + P.rnd() * 600 * k, len = (60 + P.rnd() * 200) * k, b = Math.min(S.x1, a + len);
      P.line([[a, y], [b, y]], i % 5 === 0 ? 's1' : (i % 2 ? 's2' : 'pale'), i % 5 === 0 ? 2.2 : 1.4, 0.5 + i * 0.06, 0.3 - i * 0.008);
    }
  },
};

/** A stepped rectangle, two steps of s at every corner, from the top centre clockwise back to it. */
function stepped(x0, y0, x1, y1, s) {
  const cx = (x0 + x1) / 2;
  return [[cx, y0], [x1 - 2 * s, y0], [x1 - 2 * s, y0 + s], [x1 - s, y0 + s], [x1 - s, y0 + 2 * s], [x1, y0 + 2 * s], [x1, y1 - 2 * s], [x1 - s, y1 - 2 * s], [x1 - s, y1 - s], [x1 - 2 * s, y1 - s], [x1 - 2 * s, y1],
    [x0 + 2 * s, y1], [x0 + 2 * s, y1 - s], [x0 + s, y1 - s], [x0 + s, y1 - 2 * s], [x0, y1 - 2 * s], [x0, y0 + 2 * s], [x0 + s, y0 + 2 * s], [x0 + s, y0 + s], [x0 + 2 * s, y0 + s], [x0 + 2 * s, y0], [cx, y0]];
}

/** A fan: a half sun of rays and rings, opening up (dir -1) or down (dir 1). */
function fan(P, x, y, r, n, dir, role, dl) {
  P.line(arc(x, y, r, 0, dir * PI, 24), role, 1.2, dl, 0.5);
  P.line(arc(x, y, r * 0.55, 0, dir * PI, 16), role, 1, dl + 0.1, 0.4);
  for (let i = 1; i < n; i++) {
    const a = dir * PI * i / n;
    P.line([[x + r * 0.2 * Math.cos(a), y + r * 0.2 * Math.sin(a)], [x + r * Math.cos(a), y + r * Math.sin(a)]], role, 1, dl + 0.2 + Math.abs(i - n / 2) * 0.04, 0.3);
  }
}

/** @type {import('./ornament-set-pen.js').SetStyle} */
const artDeco = {
  id: 'art-deco',
  barH: 16,
  popEase: 'cubic-bezier(.3,1.4,.55,1)',
  // Three stepped rules, the outer one heaviest, a rising sun on top and a setting one below.
  frame(P, C) {
    const cx = C.x + C.w / 2;
    P.line(stepped(C.x - 20, C.y - 20, C.x + C.w + 20, C.y + C.h + 20, 7), 's1', 1.6, 0.1, 1.8);
    P.line(stepped(C.x - 14, C.y - 14, C.x + C.w + 14, C.y + C.h + 14, 6), 's1', 0.8, 0.3, 1.8);
    P.line(stepped(C.x - 8, C.y - 8, C.x + C.w + 8, C.y + C.h + 8, 5), 'h1', 0.6, 0.5, 1.8);
    fan(P, cx, C.y - 20, 28, 9, -1, 's1', 1.4);
    fan(P, cx, C.y + C.h + 20, 18, 7, 1, 's1', 1.6);
  },
  // Three lines from each end close in on a small sun and a diamond.
  rule(P, D) {
    const mid = (D.x0 + D.x1) / 2, inset = Math.min(36, (D.x1 - D.x0) / 10);
    [-5, 0, 5].forEach((o, j) => {
      const ins = j === 1 ? 0 : inset;
      P.line([[D.x0 + ins, D.y + o], [mid - 26, D.y + o]], 's1', j === 1 ? 1.2 : 0.7, 0.3 + j * 0.06, 0.8);
      P.line([[D.x1 - ins, D.y + o], [mid + 26, D.y + o]], 's1', j === 1 ? 1.2 : 0.7, 0.3 + j * 0.06, 0.8);
    });
    fan(P, mid, D.y - 2, 16, 7, -1, 's1', 1.0);
    P.shape(poly([[mid, D.y + 2], [mid + 6, D.y + 9], [mid, D.y + 16], [mid - 6, D.y + 9]]), 's1', 1.4);
  },
  // A double rule round the track, the fill inside it, stepped marks under the quarters.
  bar(P, B) {
    P.rect(B.x + 0.5, B.y + 0.5, B.w - 1, B.h - 1, 's1', { stroke: true });
    P.rect(B.x + 2.5, B.y + 2.5, B.w - 5, B.h - 5, 's1', { stroke: true });
    P.rect(B.x + 5, B.y + 5, (B.w - 10) * B.v, B.h - 10, 's1', { wipe: [0.5, 1.4] });
    for (let i = 0; i <= 4; i++) {
      const x = B.x + B.w * i / 4, y = B.y + B.h + 6;
      P.line([[x - 6, y + 8], [x - 6, y + 4], [x - 3, y + 4], [x - 3, y], [x + 3, y], [x + 3, y + 4], [x + 6, y + 4], [x + 6, y + 8]], 's1', 1, 0.6 + i * 0.12, 0.3);
    }
  },
  // Quarter suns.
  bullet(P, p, i) {
    const x = p[0] - 6, y = p[1] + 6;
    P.line(arc(x, y, 12, -PI / 2, 0, 10), 's1', 1.2, 0.9 + i * 0.15, 0.3);
    for (let k = 1; k < 4; k++) { const a = -PI / 2 * k / 4; P.line([[x + 3 * Math.cos(a), y + 3 * Math.sin(a)], [x + 12 * Math.cos(a), y + 12 * Math.sin(a)]], 's1', 1, 1.05 + i * 0.15 + k * 0.03, 0.2); }
  },
  // A row of scallops over a straight rule, every other one holding a sun.
  strip(P, S) {
    const y = S.y + 10, n = Math.max(6, Math.round(16 * (S.x1 - S.x0) / 832)), w = (S.x1 - S.x0) / n;
    P.line([[S.x0, y], [S.x1, y]], 's1', 1, 0.4, 1.4);
    for (let i = 0; i < n; i++) {
      const x = S.x0 + w * (i + 0.5), dl = 0.6 + i * 0.06 * 16 / n;
      P.line(arc(x, y, w / 2, PI, 2 * PI, 14), i % 2 ? 'h1' : 's1', 1, dl, 0.3);
      if (i % 2 === 0) for (let k = 1; k < 5; k++) { const a = PI + PI * k / 5; P.line([[x + 4 * Math.cos(a), y + 4 * Math.sin(a)], [x + (w / 2 - 4) * Math.cos(a), y + (w / 2 - 4) * Math.sin(a)]], 's1', 0.8, dl + 0.2, 0.2); }
    }
  },
};

/** Arms grow at this many px a second, and each branch draws once the arm has reached it. */
const ARM_SPEED = 260;

/** An arm: a straight run with side branches at 60 degrees on side s (1, -1, or 0 for both), shorter toward the tip. */
function arm(P, x, y, dir, len, s, br, role, dl) {
  const c = Math.cos(dir * DEG), sn = Math.sin(dir * DEG);
  P.line([[x, y], [x + c * len, y + sn * len]], role, 1.4, dl, len / ARM_SPEED);
  for (let d = 12; d < len - 4; d += 13) {
    const bl = br * Math.pow(1 - d / len, 0.8) + 3, px = x + c * d, py = y + sn * d, when = dl + d / ARM_SPEED;
    (s === 0 ? [1, -1] : [s]).forEach((side) => {
      const a = (dir + side * 60) * DEG;
      P.line([[px, py], [px + Math.cos(a) * bl, py + Math.sin(a) * bl]], role, 1, when, 0.2);
      if (bl > 10) { const tx = px + Math.cos(a) * bl * 0.55, ty = py + Math.sin(a) * bl * 0.55, a2 = dir * DEG; P.line([[tx, ty], [tx + Math.cos(a2) * bl * 0.35, ty + Math.sin(a2) * bl * 0.35]], role, 0.8, when + 0.15, 0.15); }
    });
  }
}

/** A small snowflake: six spokes, each with a pair of twigs, and a hexagon core. */
function flake(P, x, y, r, role, dl) {
  for (let i = 0; i < 6; i++) {
    const a = (i * 60 + 30) * DEG;
    P.line([[x, y], [x + r * Math.cos(a), y + r * Math.sin(a)]], role, 1.1, dl, 0.25);
    const mx = x + r * 0.6 * Math.cos(a), my = y + r * 0.6 * Math.sin(a);
    [-1, 1].forEach((sd) => { const b = a + sd * 60 * DEG; P.line([[mx, my], [mx + r * 0.3 * Math.cos(b), my + r * 0.3 * Math.sin(b)]], role, 0.9, dl + 0.2, 0.15); });
  }
  P.line(hex(x, y, r * 0.3), role, 1, dl + 0.1, 0.25);
}

/** @type {import('./ornament-set-pen.js').SetStyle} */
const crystal = {
  id: 'crystal',
  popEase: 'cubic-bezier(.3,1.3,.55,1)',
  // From every corner an arm grows along each edge, branching outward; a crystal sits in each corner.
  frame(P, C) {
    const x0 = C.x - 12, y0 = C.y - 12, x1 = C.x + C.w + 12, y1 = C.y + C.h + 12;
    const lx = Math.min(150, (x1 - x0) * 0.36), ly = Math.min(110, (y1 - y0) * 0.41);
    arm(P, x0, y0, 0, lx, -1, 16, 's1', 0.2); arm(P, x0, y0, 90, ly, 1, 14, 's2', 0.2);
    arm(P, x1, y0, 180, lx, 1, 16, 's1', 0.35); arm(P, x1, y0, 90, ly, -1, 14, 's2', 0.35);
    arm(P, x1, y1, 180, lx, -1, 16, 's1', 0.5); arm(P, x1, y1, 270, ly, 1, 14, 's2', 0.5);
    arm(P, x0, y1, 0, lx, 1, 16, 's1', 0.65); arm(P, x0, y1, 270, ly, -1, 14, 's2', 0.65);
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach((q, i) => { P.shape(poly(hex(q[0], q[1], 7).slice(0, 6)), 's3', 0.1 + i * 0.15, 0.6, 'spin'); P.line(hex(q[0], q[1], 11), 's1', 1, 0.3 + i * 0.15, 0.4); });
  },
  // A flake in the middle with branching arms growing out both ways.
  rule(P, D) {
    const mid = (D.x0 + D.x1) / 2;
    flake(P, mid, D.y, 13, 's3', 0.2);
    arm(P, mid + 16, D.y, 0, D.x1 - mid - 16, 0, 11, 's1', 0.5); arm(P, mid - 16, D.y, 180, mid - 16 - D.x0, 0, 11, 's1', 0.5);
  },
  // A light track, twigs frosting the filled run, a faceted point at the value.
  bar(P, B) {
    const vx = B.x + B.w * B.v, my = B.y + B.h / 2, a = -60 * DEG;
    P.rect(B.x, B.y, B.w, B.h, 'paper');
    P.rect(B.x + 0.5, B.y + 0.5, B.w - 1, B.h - 1, 't1', { stroke: true });
    P.rect(B.x + 1, B.y + 1, (B.w - 2) * B.v, B.h - 2, 's1', { wipe: [0.5, 1.4] });
    for (let x = B.x + 14; x < vx - 10; x += 18) {
      P.line([[x, B.y - 1], [x + Math.cos(a) * 9, B.y - 1 + Math.sin(a) * 9]], 's2', 1, 1.0 + (x - B.x) / 400, 0.15);
      P.line([[x + 9, B.y + B.h + 1], [x + 9 + Math.cos(-a) * 7, B.y + B.h + 1 + Math.sin(-a) * 7]], 's2', 1, 1.05 + (x - B.x) / 400, 0.15);
    }
    P.shape(poly([[vx - 4, B.y - 7], [vx + 8, B.y - 2], [vx + 14, my], [vx + 8, B.y + B.h + 2], [vx - 4, B.y + B.h + 7]]), 's3', 1.9, 0.5, 'spin');
    P.line([[vx - 4, B.y - 7], [vx + 4, my], [vx - 4, B.y + B.h + 7]], 'paper', 1, 2.2, 0.2);
  },
  // Small flakes.
  bullet(P, p, i) { flake(P, p[0], p[1], 8, i === 0 ? 's3' : 's1', 0.9 + i * 0.15); },
  // A band of facets between two rules, every third one filled.
  strip(P, S) {
    const step = 16, top = S.y - 8, bot = S.y + 8, zz = [];
    P.line([[S.x0, top], [S.x1, top]], 's1', 0.8, 0.5, 1.2); P.line([[S.x0, bot], [S.x1, bot]], 's1', 0.8, 0.5, 1.2);
    for (let x = S.x0, k = 0; x <= S.x1 + 0.1; x += step, k++) zz.push([x, k % 2 ? top : bot]);
    P.line(zz, 's2', 1, 0.7, 1.6);
    for (let k = 0; k + 2 < zz.length; k += 3) P.shape(poly([zz[k], zz[k + 1], zz[k + 2]]), k % 2 ? 't3' : 't2', 0.8 + k * 0.03, 0.4, 'spin');
  },
};

export const SETS_C = [velocity, artDeco, crystal];
