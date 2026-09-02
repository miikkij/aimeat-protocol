/**
 * @file phaser/fx-parts.js
 * @description The pure parts of the particle kit, kept out of fx.js so that file stays under
 *   the line cap: the shapes and the frame strip a preset is drawn with, the zones a weather
 *   layer is born in and dies at, and the arithmetic that turns a preset's numbers into an
 *   emitter's. Nothing here keeps state. strip() is the one function that touches a scene, to
 *   draw a texture once and keep it on the scene's texture manager.
 *
 *   ONE STRIP PER SHAPE AND COLOUR LIST. A preset with several colours is drawn side by side in
 *   one texture and each cell is registered as a frame (c0, c1 and so on), so an emitter picks a
 *   frame per particle and every colour is the theme's own number. A tint would multiply the
 *   pixel and darken a coloured texture; frames do not.
 *
 *   ZONES ANSWER PHASER'S OWN QUESTIONS. An emit zone wants getRandomPoint(point) and a death
 *   zone wants contains(x, y), both checked in the 4.2.1 bundle, so a plain object carries them
 *   and no Phaser.Geom is needed. The box carries its own fit() as well, so a resize moves the
 *   zone without touching the emitter.
 * @structure SHAPES · drawCell · strip · box · ring · fitZones · merge · scaled · slowed ·
 *   mean · flow
 * @usage  import { strip, box, ring, fitZones, merge, slowed, mean, flow } from './fx-parts.js';
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: extracted from fx.js as written, nothing changed.
 */

/** Emissions are spread over frames; past this many per second, particles come in groups. */
const MAX_PER_SECOND = 60;
/** How far outside the view particles are born and allowed to live, in px. */
const MARGIN = 48;

/** The emitter config keys that are motion, for the less-motion slowdown. */
const MOTION_KEYS = ['speed', 'speedX', 'speedY', 'gravityX', 'gravityY', 'accelerationX',
  'accelerationY', 'maxVelocityX', 'maxVelocityY'];

/* ── Shapes and the frame strip ──────────────────────────────────────────────────────────── */

/** Each shape's cell size, in px. */
const SHAPES = {
  dot: { w: 8, h: 8 }, chip: { w: 7, h: 10 }, spark: { w: 12, h: 3 }, drop: { w: 2, h: 14 },
  flake: { w: 5, h: 5 }, puff: { w: 32, h: 32 }, ring: { w: 24, h: 24 }, star: { w: 9, h: 9 },
  leaf: { w: 12, h: 7 }, bubble: { w: 10, h: 10 }, print: { w: 6, h: 9 },
};

/** The gap between two cells of a strip, so a frame never bleeds into its neighbour. */
const CELL_GAP = 2;

/**
 * One cell of a strip: the shape in one colour, at a horizontal offset.
 * @param {any} g  a Graphics
 * @param {string} shape
 * @param {number} colour
 * @param {number} ox
 * @param {number} w
 * @param {number} h
 * @returns {void}
 */
function drawCell(g, shape, colour, ox, w, h) {
  const cx = ox + w / 2;
  const cy = h / 2;
  g.fillStyle(colour, 1);
  if (shape === 'dot' || shape === 'flake') {
    g.fillCircle(cx, cy, w / 2);
  } else if (shape === 'puff') {
    // Three stacked discs at low alpha: a soft edge without a gradient.
    g.fillStyle(colour, 0.1);
    g.fillCircle(cx, cy, 16);
    g.fillStyle(colour, 0.12);
    g.fillCircle(cx, cy, 11);
    g.fillStyle(colour, 0.14);
    g.fillCircle(cx, cy, 6);
  } else if (shape === 'ring') {
    g.lineStyle(2, colour, 1);
    g.strokeCircle(cx, cy, 10);
  } else if (shape === 'star') {
    g.fillRect(ox + 3.5, 0, 2, h);
    g.fillRect(ox, 3.5, w, 2);
  } else if (shape === 'leaf' || shape === 'print') {
    g.fillEllipse(cx, cy, w, h);
  } else if (shape === 'bubble') {
    g.lineStyle(1.5, colour, 0.9);
    g.strokeCircle(cx, cy, 4);
    g.fillStyle(colour, 0.9);
    g.fillCircle(ox + 3.5, 3.5, 1);
  } else {
    g.fillRect(ox, 0, w, h);
  }
}

/**
 * The texture for one shape in a list of colours, drawn once and kept: one cell per colour, side
 * by side, each registered as a frame named c0, c1 and so on.
 * @param {any} scene
 * @param {string} shape
 * @param {number[]} colours
 * @returns {{ key: string, frames: string|string[] }}
 */
export function strip(scene, shape, colours) {
  const size = SHAPES[shape] || SHAPES.dot;
  const key = 'ak-fx-' + shape + '-' + colours.map(function (c) {
    return ((c >>> 0) & 0xffffff).toString(16);
  }).join('-');
  /** @type {string[]} */
  const frames = [];
  for (let i = 0; i < colours.length; i++) frames.push('c' + i);
  if (scene.textures && scene.textures.exists(key)) {
    return { key: key, frames: frames.length === 1 ? frames[0] : frames };
  }
  const g = scene.make.graphics({ add: false });
  const cell = size.w + CELL_GAP;
  for (let i = 0; i < colours.length; i++) drawCell(g, shape, colours[i], i * cell, size.w, size.h);
  g.generateTexture(key, cell * colours.length, size.h);
  g.destroy();
  const texture = scene.textures.get(key);
  for (let i = 0; i < colours.length; i++) texture.add(frames[i], 0, i * cell, 0, size.w, size.h);
  return { key: key, frames: frames.length === 1 ? frames[0] : frames };
}

/* ── Zones ───────────────────────────────────────────────────────────────────────────────── */

/**
 * A box particles are born in or kept inside, in the emitter's own space. It carries its own
 * fit() so a resize moves the box without touching the emitter, and it answers both of Phaser's
 * zone questions: getRandomPoint for an emit zone and contains for a death zone.
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {any}
 */
export function box(x, y, w, h) {
  return {
    x: x, y: y, w: w, h: h,
    fit: function (nx, ny, nw, nh) {
      this.x = nx; this.y = ny; this.w = nw; this.h = nh;
    },
    getRandomPoint: function (p) {
      p.x = this.x + Math.random() * this.w;
      p.y = this.y + Math.random() * this.h;
      return p;
    },
    contains: function (px, py) {
      return px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h;
    },
  };
}

/**
 * A ring of a radius, with a little width so the points do not sit on one perfect circle.
 * @param {number} radius
 * @returns {any}
 */
export function ring(radius) {
  return {
    getRandomPoint: function (p) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.9 + Math.random() * 0.2);
      p.x = Math.cos(a) * r;
      p.y = Math.sin(a) * r;
      return p;
    },
  };
}

/**
 * Where a weather layer is born and where it dies, for a view of a size. The birth band sits
 * outside the view on the side the particles come from, and stretches upwind by the distance a
 * particle drifts in its life, so wind never leaves one edge of the screen dry.
 * @param {any} born   the emit box to fit
 * @param {any} kept   the death box to fit
 * @param {'top'|'bottom'|'all'} zone
 * @param {number} w
 * @param {number} h
 * @param {number} wind   px/s
 * @param {number} life   ms
 * @returns {void}
 */
export function fitZones(born, kept, zone, w, h, wind, life) {
  const drift = Math.min(w, Math.abs(wind) * life / 1000);
  const left = wind > 0 ? -MARGIN - drift : -MARGIN;
  const width = w + MARGIN * 2 + drift;
  if (zone === 'top') born.fit(left, -MARGIN, width, MARGIN);
  else if (zone === 'bottom') born.fit(left, h, width, MARGIN);
  else born.fit(wind > 0 ? -drift : 0, 0, w + drift, h);
  kept.fit(left - MARGIN, -MARGIN * 2, width + MARGIN * 2, h + MARGIN * 3);
}

/* ── Config arithmetic ───────────────────────────────────────────────────────────────────── */

/**
 * A shallow copy of a config with the caller's own keys over it.
 * @param {any} base
 * @param {any} [extra]
 * @returns {any}
 */
export function merge(base, extra) {
  /** @type {any} */
  const out = {};
  for (const name in base) out[name] = base[name];
  if (extra) for (const name in extra) out[name] = extra[name];
  return out;
}

/**
 * One op value scaled: a number, a min/max range or a start/end pair.
 * @param {any} v
 * @param {number} k
 * @returns {any}
 */
function scaled(v, k) {
  if (typeof v === 'number') return v * k;
  if (v && typeof v === 'object') {
    const out = merge(v);
    if (typeof out.min === 'number') out.min *= k;
    if (typeof out.max === 'number') out.max *= k;
    if (typeof out.start === 'number') out.start *= k;
    if (typeof out.end === 'number') out.end *= k;
    return out;
  }
  return v;
}

/**
 * Every motion key in a config multiplied by k. Used for the less-motion half speed.
 * @param {any} config
 * @param {number} k
 * @returns {any}
 */
export function slowed(config, k) {
  const out = merge(config);
  for (const name of MOTION_KEYS) if (name in out) out[name] = scaled(out[name], k);
  return out;
}

/**
 * The mean of an op value, for the direction a rain drop faces.
 * @param {any} v
 * @returns {number}
 */
export function mean(v) {
  if (typeof v === 'number') return v;
  if (v && typeof v.min === 'number' && typeof v.max === 'number') return (v.min + v.max) / 2;
  return 0;
}

/**
 * Particles per second as Phaser's frequency and quantity: one particle every so many ms while
 * the rate allows it, and groups of several once it would be more than one per frame.
 * @param {number} perSecond
 * @returns {{ frequency: number, quantity: number }}
 */
export function flow(perSecond) {
  if (!(perSecond > 0)) return { frequency: 1000, quantity: 0 };
  const quantity = Math.max(1, Math.ceil(perSecond / MAX_PER_SECOND));
  return { frequency: (1000 * quantity) / perSecond, quantity: quantity };
}
