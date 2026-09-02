/**
 * @file phaser/sprites-draw.js
 * @description The drawings behind spriteSheet(): seven kinds of small figure, each frame a
 *   handful of rectangles, ellipses and triangles in three colours, so a game has a hero, its
 *   enemies and its pickups the moment it boots and long before anyone has made art.
 *
 *   EVERY NUMBER IS A SHARE OF THE FRAME, so the same figure comes out at 32x40 and at 64x80,
 *   and every colour is one of three the caller resolved from the theme (body, visor, trim), so
 *   the whole cast re-tones with the palette and the mode. Nothing here touches a scene: a
 *   drawer takes a Graphics object, a clip name, a frame index and a cell, and paints inside it.
 *
 *   THE PLAN IS DATA. KINDS says how big a kind is and which tokens it wears; the clip lists say
 *   which animations it carries, how many frames each has, how fast it plays, and whether it is
 *   decoration (still: true, which under less motion becomes its first frame). sprites.js reads
 *   the plan, lays the cells out and registers the animations; this file only draws.
 *
 *   WHAT THE THREE COLOURS MEAN, per kind: for the figures, body is the suit, visor the face
 *   band or the eyes, trim the limbs; for the coin and the pickup, visor is the edge and trim
 *   the shine. A caller overriding one of them is overriding that.
 * @structure tint() · KINDS · CLIPS / DIRS · plan() · palette() · the seven drawers · draw()
 * @usage
 *   import { plan, palette, draw } from './sprites-draw.js';
 *   const p = plan('hero', {}); const pal = palette('hero', look, {});
 *   draw('hero', g, 'walk', 2, 64, 0, 32, 40, pal);   // the third walk frame, into cell 2
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the hero, the top-down figure, slime, bat and walker, the
 *     coin and the pickup, with their clip plans.
 */

/**
 * Move a colour toward white (a positive amount) or toward black (a negative one). One theme
 * colour in, a lit face or a shadowed face out, so the art re-tones with the palette instead of
 * carrying paint of its own.
 * @param {number} colour 0xrrggbb
 * @param {number} amount -1..1
 * @returns {number}
 */
export function tint(colour, amount) {
  const to = amount < 0 ? 0 : 255;
  const k = Math.min(1, Math.abs(amount));
  const channel = function (shift) {
    const c = (colour >> shift) & 255;
    return Math.round(c + (to - c) * k) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/**
 * The seven kinds: their frame size and which theme tokens they wear. A visor or trim rule that
 * is a number is a tint of the body; a string is a token of its own.
 * @type {Record<string, { width: number, height: number, body: string,
 *   visor: string|number, trim: string|number }>}
 */
export const KINDS = {
  hero: { width: 32, height: 40, body: 'accent', visor: 'ink', trim: -0.34 },
  topdown: { width: 32, height: 32, body: 'accent', visor: 'ink', trim: -0.34 },
  slime: { width: 32, height: 24, body: 'ok', visor: 'ink', trim: 0.45 },
  bat: { width: 32, height: 24, body: 'inkDim', visor: 'err', trim: -0.3 },
  walker: { width: 28, height: 36, body: 'warn', visor: 'ink', trim: -0.34 },
  coin: { width: 20, height: 20, body: 'ch3', visor: -0.4, trim: 0.5 },
  pickup: { width: 20, height: 20, body: 'ch4', visor: -0.4, trim: 0.5 },
};

/**
 * @typedef {object} Clip
 * @property {string} name        the clip, and the suffix of its animation key
 * @property {number} count       frames
 * @property {number} [rate]      frames per second. Default 8.
 * @property {number} [repeat]    -1 loops. Default 0: play once.
 * @property {boolean} [still]    decoration: under less motion the clip is its first frame
 * @property {string} [alias]     a second animation key on the same frames
 * @property {number} [aliasRate] the alias's own pace, when it differs
 * @property {number} [start]     filled in by the layout: the first cell
 */

/**
 * The clips each kind carries, in sheet order. The hero's walk is also registered as run, at a
 * faster pace, because level.js asks for <key>-run; the coin's spin and the pickup's bob are
 * also idle, so an actor made of either has a resting clip.
 * @type {Record<string, Clip[]>}
 */
const CLIPS = {
  hero: [
    { name: 'idle', count: 2, rate: 2, repeat: -1, still: true },
    { name: 'walk', count: 6, rate: 10, repeat: -1, alias: 'run', aliasRate: 14 },
    { name: 'jump', count: 1 },
    { name: 'fall', count: 1 },
    { name: 'hit', count: 1 },
    { name: 'die', count: 3, rate: 6, repeat: 0 },
  ],
  slime: [
    { name: 'idle', count: 2, rate: 2, repeat: -1, still: true },
    { name: 'walk', count: 4, rate: 6, repeat: -1 },
    { name: 'hit', count: 1 },
    { name: 'die', count: 2, rate: 6, repeat: 0 },
  ],
  bat: [
    { name: 'idle', count: 2, rate: 4, repeat: -1, still: true },
    { name: 'walk', count: 4, rate: 12, repeat: -1, alias: 'fly' },
    { name: 'hit', count: 1 },
    { name: 'die', count: 2, rate: 6, repeat: 0 },
  ],
  walker: [
    { name: 'idle', count: 2, rate: 2, repeat: -1, still: true },
    { name: 'walk', count: 4, rate: 8, repeat: -1 },
    { name: 'hit', count: 1 },
    { name: 'die', count: 2, rate: 6, repeat: 0 },
  ],
  coin: [
    { name: 'spin', count: 6, rate: 10, repeat: -1, still: true, alias: 'idle' },
  ],
  pickup: [
    { name: 'bob', count: 4, rate: 6, repeat: -1, still: true, alias: 'idle' },
  ],
};

/** The top-down directions, four or eight, in sheet order. */
const DIRS4 = ['down', 'left', 'right', 'up'];
const DIRS8 = ['down', 'downleft', 'left', 'upleft', 'up', 'upright', 'right', 'downright'];

/** Where each direction points, as a unit-ish vector with y down. */
const DIR_VECTORS = {
  down: [0, 1], left: [-1, 0], right: [1, 0], up: [0, -1],
  downleft: [-0.7, 0.7], upleft: [-0.7, -0.7], upright: [0.7, -0.7], downright: [0.7, 0.7],
};

/** Four-frame stride: legs apart, together, apart the other way, together; the body bobs on
 *  the two contact frames, which is what makes four frames read as walking. */
const STEP4 = [1, 0, -1, 0];
const BOB4 = [0, -1, 0, -1];

/** The hero's six-frame stride, the same idea with a longer swing. */
const SWING6 = [1, 0.5, -0.4, -1, -0.5, 0.4];
const BOB6 = [0, -1, 0, 0, -1, 0];

/** The slime's hop: [height share, width share, lift as a share of the frame]. */
const HOP = [[0.82, 1.14, 0], [1.1, 0.88, -0.08], [1, 0.94, -0.16], [0.9, 1.08, 0]];

/** The bat's wingbeat: the tip's height, negative up. */
const FLAP = [-0.7, -0.1, 0.6, 0.1];

/** The coin's spin: how wide the face is on each frame. */
const SPIN = [1, 0.72, 0.36, 0.12, 0.36, 0.72];

/**
 * The top-down clips: one idle and one four-frame walk per direction, with the 'down' pair also
 * registered as plain idle and walk so a game that never turns still has a name to play.
 * @param {4|8} directions
 * @returns {Clip[]}
 */
function topdownClips(directions) {
  const dirs = directions === 8 ? DIRS8 : DIRS4;
  /** @type {Clip[]} */
  const out = [];
  for (const d of dirs) {
    out.push({ name: 'idle-' + d, count: 1, alias: d === 'down' ? 'idle' : undefined });
    out.push({ name: 'walk-' + d, count: 4, rate: 8, repeat: -1, alias: d === 'down' ? 'walk' : undefined });
  }
  return out;
}

/**
 * The plan for one kind: frame size and a fresh copy of its clips, so the layout may write
 * each clip's start cell without touching the shared table.
 * @param {string} kind
 * @param {{ directions?: number }} [spec]
 * @returns {{ width: number, height: number, clips: Clip[] }}
 */
export function plan(kind, spec) {
  const k = KINDS[kind] || KINDS.hero;
  const clips = kind === 'topdown'
    ? topdownClips(spec && spec.directions === 8 ? 8 : 4)
    : (CLIPS[kind] || CLIPS.hero).map(function (c) { return Object.assign({}, c); });
  return { width: k.width, height: k.height, clips: clips };
}

/**
 * A kind's rule for one colour, resolved: a number tints the body, a string names a token.
 * @param {string|number} rule
 * @param {number} body
 * @param {any} look
 * @returns {number}
 */
function derive(rule, body, look) {
  return typeof rule === 'number' ? tint(body, rule) : look[rule];
}

/**
 * The three colours a kind is drawn in, with the caller's overrides in place.
 * @param {string} kind
 * @param {any} look                      the theme handle
 * @param {{ body?: number, visor?: number, trim?: number }} [asked]
 * @returns {{ body: number, visor: number, trim: number }}
 */
export function palette(kind, look, asked) {
  const k = KINDS[kind] || KINDS.hero;
  const a = asked || {};
  const body = typeof a.body === 'number' ? a.body : look[k.body];
  return {
    body: body,
    visor: typeof a.visor === 'number' ? a.visor : derive(k.visor, body, look),
    trim: typeof a.trim === 'number' ? a.trim : derive(k.trim, body, look),
  };
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   The side-view hero
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {object} Pose
 * @property {number} swing    legs: 1 near leg forward, -1 back
 * @property {number} bob      pixels the body drops
 * @property {number} arm      the near arm's lift, 1 raised
 * @property {number} lean     -1 knocked back
 * @property {number} squash   the body's height share
 * @property {number} lie      0 standing … 1 flat on the ground
 * @property {boolean} tuck    legs drawn up (a jump)
 * @property {boolean} spread  legs out (a fall)
 */

/**
 * One figure in one cell. Everything is derived from the cell, so the hero is the same shape at
 * any size, and from the pose, so one drawer covers every clip.
 * @param {any} g
 * @param {number} left
 * @param {number} top
 * @param {number} w
 * @param {number} h
 * @param {{ body: number, visor: number, trim: number }} pal
 * @param {Pose} pose
 */
function figure(g, left, top, w, h, pal, pose) {
  const ground = top + h - 1;
  const lie = pose.lie;
  const bodyW = Math.round(w * (0.6 + 0.3 * lie));
  const bodyH = Math.max(3, Math.round(h * 0.5 * pose.squash * (1 - 0.72 * lie)));
  const legH = Math.round(h * 0.26 * (1 - lie));
  const bodyX = left + Math.round((w - bodyW) / 2) + Math.round(pose.lean * w * 0.06);
  // Standing, the body sits on its legs; lying, it sinks to the ground.
  const standY = top + Math.round(h * 0.16) + pose.bob;
  const bodyY = Math.round(standY + (ground - bodyH - standY) * lie);
  const radius = Math.round(Math.min(bodyW, bodyH) * 0.3);

  if (legH > 0) {
    const legW = Math.max(3, Math.round(w * 0.14));
    const legTop = bodyY + bodyH - 2;
    const legLeft = bodyX + Math.round(bodyW * 0.13);
    const legRight = bodyX + bodyW - Math.round(bodyW * 0.13) - legW;
    const reach = Math.max(2, Math.round(legH * 0.3));
    // A leg stops at the cell's ground whatever the swing adds, so no frame reaches into the
    // cell below it.
    const leg = function (len) { return Math.max(1, Math.min(ground, legTop + Math.round(len)) - legTop); };
    g.fillStyle(pal.trim, 1);
    if (pose.tuck) {
      g.fillRect(legLeft, legTop, legW, leg(legH - reach));
      g.fillRect(legRight, legTop, legW, leg(legH - reach / 2));
    } else if (pose.spread) {
      g.fillRect(legLeft - reach, legTop, legW, leg(legH));
      g.fillRect(legRight + reach, legTop, legW, leg(legH));
    } else {
      g.fillRect(legLeft, legTop, legW, leg(legH + pose.swing * reach));
      g.fillRect(legRight, legTop, legW, leg(legH - pose.swing * reach));
    }
  }

  g.fillStyle(pal.body, 1).fillRoundedRect(bodyX, bodyY, bodyW, bodyH, radius);
  // The visor: one band across the upper third, narrowing to a slit as the figure lies down.
  const visorH = Math.max(2, Math.round(bodyH * 0.26));
  const visorW = Math.round(bodyW * (0.68 - 0.3 * lie));
  g.fillStyle(pal.visor, 1).fillRoundedRect(
    bodyX + Math.round(bodyW * 0.16) - Math.round(pose.lean * 2), bodyY + Math.round(bodyH * 0.18),
    visorW, visorH, Math.round(visorH / 2),
  );
  if (lie < 0.6) {
    const armW = Math.max(3, Math.round(bodyW * 0.22));
    const armH = Math.max(3, Math.round(bodyH * 0.26));
    const armY = bodyY + Math.round(bodyH * 0.5) - Math.round(pose.arm * bodyH * 0.3);
    g.fillStyle(pal.trim, 1).fillRect(bodyX - Math.round(armW / 2), armY, armW, armH);
  }
}

/** @type {(g: any, clip: string, i: number, left: number, top: number, w: number, h: number,
 *   pal: { body: number, visor: number, trim: number }) => void} */
function drawHero(g, clip, i, left, top, w, h, pal) {
  /** @type {Pose} */
  const pose = { swing: 0, bob: 0, arm: 0, lean: 0, squash: 1, lie: 0, tuck: false, spread: false };
  if (clip === 'idle') {
    // Breathing: the second frame is a pixel lower and a shade shorter.
    pose.bob = i;
    pose.squash = i ? 0.96 : 1;
  } else if (clip === 'walk') {
    pose.swing = SWING6[i];
    pose.bob = BOB6[i];
    pose.arm = -SWING6[i];
  } else if (clip === 'jump') {
    pose.tuck = true;
    pose.arm = 1;
  } else if (clip === 'fall') {
    pose.spread = true;
    pose.arm = 1.2;
  } else if (clip === 'hit') {
    pose.lean = -1;
    pose.arm = 0.7;
    pose.squash = 0.94;
  } else if (clip === 'die') {
    pose.lie = (i + 1) / 3;
  }
  figure(g, left, top, w, h, pal, pose);
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   The top-down figure
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/** @type {(g: any, clip: string, i: number, left: number, top: number, w: number, h: number,
 *   pal: { body: number, visor: number, trim: number }) => void} */
function drawTopdown(g, clip, i, left, top, w, h, pal) {
  const dir = clip.slice(clip.indexOf('-') + 1);
  const v = DIR_VECTORS[dir] || DIR_VECTORS.down;
  const walking = clip.indexOf('walk') === 0;
  const step = walking ? STEP4[i] : 0;
  const bob = walking ? BOB4[i] : 0;
  const cx = left + w / 2;
  const cy = top + h / 2;
  const bodyW = w * 0.56;
  const bodyH = h * 0.56;

  // Two feet, either side of the line of travel, stepping forward and back along it.
  const footW = Math.max(3, Math.round(w * 0.16));
  const footH = Math.max(3, Math.round(h * 0.16));
  const apart = w * 0.16;
  const stride = h * 0.12 * step;
  const px = -v[1];
  const py = v[0];
  g.fillStyle(pal.trim, 1);
  g.fillRect(
    Math.round(cx + px * apart + v[0] * stride - footW / 2),
    Math.round(cy + py * apart + v[1] * stride + bodyH * 0.32 - footH / 2), footW, footH,
  );
  g.fillRect(
    Math.round(cx - px * apart - v[0] * stride - footW / 2),
    Math.round(cy - py * apart - v[1] * stride + bodyH * 0.32 - footH / 2), footW, footH,
  );

  g.fillStyle(pal.body, 1).fillRoundedRect(
    Math.round(cx - bodyW / 2), Math.round(cy - bodyH / 2 + bob),
    Math.round(bodyW), Math.round(bodyH), Math.round(bodyW * 0.3),
  );

  if (v[1] < -0.5) {
    // Facing away: the back of the head, a trim band where the visor would be.
    g.fillStyle(pal.trim, 1).fillRect(
      Math.round(cx - bodyW * 0.3), Math.round(cy - bodyH * 0.38 + bob),
      Math.round(bodyW * 0.6), Math.max(2, Math.round(bodyH * 0.14)),
    );
    return;
  }
  // The visor slides toward the facing and narrows when seen from the side.
  const visorW = Math.round(bodyW * (Math.abs(v[0]) > 0.5 ? 0.34 : 0.56));
  const visorH = Math.max(2, Math.round(bodyH * 0.2));
  g.fillStyle(pal.visor, 1).fillRoundedRect(
    Math.round(cx + v[0] * bodyW * 0.22 - visorW / 2),
    Math.round(cy - bodyH * 0.22 + v[1] * bodyH * 0.1 + bob),
    visorW, visorH, Math.round(visorH / 2),
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   The enemies
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/** @type {(g: any, clip: string, i: number, left: number, top: number, w: number, h: number,
 *   pal: { body: number, visor: number, trim: number }) => void} */
function drawSlime(g, clip, i, left, top, w, h, pal) {
  let sx = 1;
  let sy = 1;
  let lift = 0;
  let eyes = 'open';
  if (clip === 'idle') {
    sy = i ? 0.9 : 1;
    sx = i ? 1.06 : 1;
  } else if (clip === 'walk') {
    sy = HOP[i][0];
    sx = HOP[i][1];
    lift = HOP[i][2];
  } else if (clip === 'hit') {
    sy = 0.7;
    sx = 1.2;
    eyes = 'shut';
  } else if (clip === 'die') {
    sy = i ? 0.22 : 0.45;
    sx = i ? 1.15 : 1.3;
    eyes = i ? 'none' : 'shut';
  }
  const cx = left + w / 2;
  const bw = Math.min(w - 2, Math.round(w * 0.8 * sx));
  const bh = Math.max(2, Math.round(h * 0.8 * sy));
  const bottom = top + h - 1 + Math.round(lift * h);
  const x = Math.round(cx - bw / 2);
  const y = bottom - bh;
  const r = Math.round(Math.min(bw, bh) * 0.45);
  const rb = Math.round(Math.min(bw, bh) * 0.15);
  g.fillStyle(pal.body, 1).fillRoundedRect(x, y, bw, bh, { tl: r, tr: r, bl: rb, br: rb });
  if (bh > 6) {
    g.fillStyle(pal.trim, 1).fillEllipse(
      Math.round(cx - bw * 0.22), Math.round(y + bh * 0.3), Math.round(bw * 0.18), Math.round(bh * 0.2),
    );
  }
  if (eyes !== 'none') {
    const ew = Math.max(2, Math.round(bw * 0.09));
    const eh = eyes === 'shut' ? 1 : Math.max(2, Math.round(bh * 0.22));
    const ey = Math.round(y + bh * 0.42);
    g.fillStyle(pal.visor, 1);
    g.fillRect(Math.round(cx - bw * 0.2 - ew / 2), ey, ew, eh);
    g.fillRect(Math.round(cx + bw * 0.2 - ew / 2), ey, ew, eh);
  }
}

/** @type {(g: any, clip: string, i: number, left: number, top: number, w: number, h: number,
 *   pal: { body: number, visor: number, trim: number }) => void} */
function drawBat(g, clip, i, left, top, w, h, pal) {
  let wing = 0.3;
  let drop = 0;
  let flip = false;
  let eyes = true;
  if (clip === 'idle') {
    wing = i ? 0.5 : 0.25;
  } else if (clip === 'walk') {
    wing = FLAP[i];
  } else if (clip === 'hit') {
    wing = 0.55;
    eyes = false;
  } else if (clip === 'die') {
    wing = i ? 0.95 : 0.85;
    drop = i ? 0.12 : 0.06;
    flip = i === 1;
  }
  const cx = left + w / 2;
  const cy = top + h * 0.5 + drop * h;
  const bodyW = Math.round(w * 0.28);
  const bodyH = Math.round(h * 0.5);
  const span = w * 0.48;
  const tipY = Math.min(top + h - 1, Math.round(cy + wing * h * 0.4));
  g.fillStyle(pal.body, 1);
  g.fillTriangle(cx - bodyW * 0.4, cy - bodyH * 0.25, cx - bodyW * 0.4, cy + bodyH * 0.25, cx - span, tipY);
  g.fillTriangle(cx + bodyW * 0.4, cy - bodyH * 0.25, cx + bodyW * 0.4, cy + bodyH * 0.25, cx + span, tipY);
  g.fillEllipse(cx, cy, bodyW, bodyH);
  // Ears, which point the other way once the bat is upside down.
  const earY = flip ? cy + bodyH * 0.5 : cy - bodyH * 0.5;
  const earTip = flip ? Math.min(top + h - 1, earY + h * 0.1) : earY - h * 0.14;
  g.fillStyle(pal.trim, 1);
  g.fillTriangle(cx - bodyW * 0.45, earY, cx - bodyW * 0.1, earY, cx - bodyW * 0.35, earTip);
  g.fillTriangle(cx + bodyW * 0.1, earY, cx + bodyW * 0.45, earY, cx + bodyW * 0.35, earTip);
  if (eyes) {
    const e = Math.max(2, Math.round(w * 0.06));
    g.fillStyle(pal.visor, 1);
    g.fillRect(Math.round(cx - bodyW * 0.25 - e / 2), Math.round(cy - bodyH * 0.12), e, e);
    g.fillRect(Math.round(cx + bodyW * 0.25 - e / 2), Math.round(cy - bodyH * 0.12), e, e);
  }
}

/** @type {(g: any, clip: string, i: number, left: number, top: number, w: number, h: number,
 *   pal: { body: number, visor: number, trim: number }) => void} */
function drawWalker(g, clip, i, left, top, w, h, pal) {
  let swing = 0;
  let bob = 0;
  let lean = 0;
  let lamp = true;
  let tilt = 0;
  let flat = false;
  if (clip === 'idle') {
    bob = i;
    lamp = !i;
  } else if (clip === 'walk') {
    swing = STEP4[i];
    bob = BOB4[i];
  } else if (clip === 'hit') {
    lean = -1;
    lamp = false;
  } else if (clip === 'die') {
    tilt = i ? 0 : 1;
    flat = i === 1;
    lamp = false;
  }
  const ground = top + h - 1;
  const bodyW = Math.round(w * (flat ? 0.9 : 0.64));
  const bodyH = Math.round(h * (flat ? 0.22 : 0.46));
  const legH = flat ? 0 : Math.round(h * 0.24);
  const bodyX = left + Math.round((w - bodyW) / 2) + Math.round(lean * w * 0.06) + Math.round(tilt * w * 0.08);
  const bodyY = flat ? ground - bodyH : top + Math.round(h * 0.24) + bob + Math.round(tilt * h * 0.1);

  if (legH > 0) {
    const legW = Math.max(3, Math.round(w * 0.16));
    const reach = Math.max(2, Math.round(legH * 0.3));
    const legTop = bodyY + bodyH - 1;
    // A leg stops at the cell's ground whatever the swing and the tilt add, so no frame reaches
    // into the cell below it.
    const leg = function (len) { return Math.max(1, Math.min(ground, legTop + Math.round(len)) - legTop); };
    g.fillStyle(pal.trim, 1);
    g.fillRect(bodyX + Math.round(bodyW * 0.12), legTop, legW, leg(legH + swing * reach));
    g.fillRect(bodyX + bodyW - Math.round(bodyW * 0.12) - legW, legTop, legW, leg(legH - swing * reach));
  }
  g.fillStyle(pal.body, 1).fillRect(bodyX, bodyY, bodyW, bodyH);
  // A belt along the bottom, which is what makes a box read as a machine.
  g.fillStyle(pal.trim, 1).fillRect(bodyX, bodyY + bodyH - Math.max(2, Math.round(bodyH * 0.14)), bodyW, Math.max(2, Math.round(bodyH * 0.14)));
  // The screen: one wide slit, narrower once the thing is down.
  const slitH = Math.max(2, Math.round(bodyH * (flat ? 0.3 : 0.2)));
  g.fillStyle(pal.visor, 1).fillRect(
    bodyX + Math.round(bodyW * 0.15), bodyY + Math.round(bodyH * 0.22), Math.round(bodyW * 0.7), slitH,
  );
  if (!flat) {
    // The antenna, with a lamp that blinks on the idle.
    const ax = bodyX + Math.round(bodyW * 0.5);
    const antH = Math.round(h * 0.12);
    g.fillStyle(pal.trim, 1).fillRect(ax - 1, bodyY - antH, 2, antH);
    if (lamp) g.fillStyle(pal.visor, 1).fillRect(ax - 2, bodyY - antH - 3, 4, 4);
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   The collectables
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/** @type {(g: any, clip: string, i: number, left: number, top: number, w: number, h: number,
 *   pal: { body: number, visor: number, trim: number }) => void} */
function drawCoin(g, clip, i, left, top, w, h, pal) {
  const share = SPIN[i] || 1;
  const cx = left + w / 2;
  const cy = top + h / 2;
  const r = Math.min(w, h) / 2 - 1;
  g.fillStyle(pal.visor, 1).fillEllipse(cx, cy, Math.max(2, 2 * r * share), 2 * r);
  g.fillStyle(pal.body, 1).fillEllipse(cx, cy, Math.max(2, 2 * r * share - 3), 2 * r - 3);
  if (share > 0.3) {
    g.fillStyle(pal.trim, 1).fillEllipse(cx - r * 0.3 * share, cy - r * 0.3, Math.max(1, r * 0.5 * share), r * 0.5);
  }
}

/** @type {(g: any, clip: string, i: number, left: number, top: number, w: number, h: number,
 *   pal: { body: number, visor: number, trim: number }) => void} */
function drawPickup(g, clip, i, left, top, w, h, pal) {
  const bob = [0, -1, -2, -1][i] || 0;
  const cx = left + w / 2;
  const cy = top + h / 2 + bob;
  const r = Math.min(w, h) * 0.4;
  // A gem: a dark lower half, a lit upper half, and one facet of shine.
  g.fillStyle(pal.visor, 1).fillTriangle(cx - r, cy, cx + r, cy, cx, cy + r * 1.1);
  g.fillStyle(pal.body, 1).fillTriangle(cx - r, cy, cx, cy - r * 0.7, cx + r, cy);
  g.fillStyle(pal.trim, 1).fillTriangle(cx - r * 0.7, cy, cx - r * 0.15, cy - r * 0.5, cx - r * 0.2, cy);
}

/** Every drawer, by kind. */
const DRAWERS = {
  hero: drawHero,
  topdown: drawTopdown,
  slime: drawSlime,
  bat: drawBat,
  walker: drawWalker,
  coin: drawCoin,
  pickup: drawPickup,
};

/**
 * Paint one frame of one clip into one cell.
 * @param {string} kind
 * @param {any} g          a Phaser Graphics object
 * @param {string} clip    the clip name ('walk', or 'walk-upleft' for the top-down figure)
 * @param {number} i       the frame within the clip
 * @param {number} left    the cell's left edge on the sheet
 * @param {number} top     the cell's top edge
 * @param {number} w       cell width
 * @param {number} h       cell height
 * @param {{ body: number, visor: number, trim: number }} pal
 * @returns {void}
 */
export function draw(kind, g, clip, i, left, top, w, h, pal) {
  (DRAWERS[kind] || drawHero)(g, clip, i, left, top, w, h, pal);
}
