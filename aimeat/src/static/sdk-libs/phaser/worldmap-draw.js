/**
 * @file phaser/worldmap-draw.js
 * @description The drawing half of the overworld map: every shape the map is made of, on the
 *   theme's colours and with no art. A region is a soft rounded panel with a caption; a path is a
 *   run of dots or dashes laid by arc length along a straight line or a bezier; a node is a disc,
 *   a rounded square, a diamond or a ring by kind, with a drawn padlock while it is closed and
 *   three stars plus the best score under it once it is open; the walker is a token on a shadow;
 *   the fog is a cloud of overlapping circles; the pulse is one ring that grows once and is gone.
 *
 *   EVERYTHING IS A GRAPHICS OBJECT REDRAWN IN PLACE. A node keeps its Graphics for life and
 *   paintNode() clears and redraws them when its state moves, so a refresh allocates nothing and
 *   an idle map draws nothing.
 *
 *   THE CURVE MATHS LIVES HERE TOO. pointAt() evaluates a path at t in [0, 1] (a line, a
 *   quadratic with one control point, a cubic with two) and both the dotted line and the walking
 *   tween read it, so the marker walks exactly where the dots are.
 * @structure NODE_RADIUS · toneOf · pointAt · samplePath · pathLength · drawRegions · drawPaths
 *   (dots / dashes) · buildNode · paintNode (drawLock / drawStars) · buildWalker · buildHaze ·
 *   pulseAt
 * @usage  internal to ./worldmap.js
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the overworld map's shapes, kept apart from worldmap.js so
 *     the logic file stays under the 800-line rule.
 */
import { cssColour } from './tokens.js';

/** The size of each kind of node, as the radius of the circle its shape fits in. */
export const NODE_RADIUS = { level: 14, town: 15, boss: 19, secret: 11 };

/** Which theme colour each kind wears once it is open. */
const NODE_ROLE = { level: 'accent', town: 'ok', boss: 'err', secret: 'ch3' };

/** The three stars under a node: their spacing and the two radii of the star shape. */
const STAR_GAP = 13;
const STAR_OUTER = 5.2;
const STAR_INNER = 2.3;

/** Dots and dashes along a path, in pixels. */
const DOT_STEP = 9;
const DASH_ON = 8;
const DASH_OFF = 6;

/**
 * A theme colour from a tone word ('accent', 'ok', 'ch2', ...) or a number.
 * @param {any} th  the theme handle
 * @param {any} want
 * @param {number} fallback
 * @returns {number}
 */
export function toneOf(th, want, fallback) {
  if (typeof want === 'number' && isFinite(want)) return want;
  if (typeof want === 'string' && typeof th[want] === 'number') return th[want];
  return fallback;
}

/**
 * @typedef {{ from: { x: number, y: number }, to: { x: number, y: number },
 *   control: Array<{ x: number, y: number }> }} PathGeom
 */

/**
 * The point at t along a path: a line with no control point, a quadratic with one, a cubic with
 * two.
 * @param {PathGeom} geom
 * @param {number} t  0 at from, 1 at to
 * @returns {{ x: number, y: number }}
 */
export function pointAt(geom, t) {
  const a = geom.from;
  const b = geom.to;
  const c = geom.control || [];
  const u = 1 - t;
  if (c.length === 0) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  if (c.length === 1) {
    const p = c[0];
    return {
      x: u * u * a.x + 2 * u * t * p.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * p.y + t * t * b.y,
    };
  }
  const p = c[0];
  const q = c[1];
  return {
    x: u * u * u * a.x + 3 * u * u * t * p.x + 3 * u * t * t * q.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * p.y + 3 * u * t * t * q.y + t * t * t * b.y,
  };
}

/**
 * The path as a polyline, dense enough to lay dots on by arc length.
 * @param {PathGeom} geom
 * @param {number} count  segments
 * @returns {Array<{ x: number, y: number }>}
 */
export function samplePath(geom, count) {
  const n = Math.max(2, Math.floor(count));
  const pts = [];
  for (let i = 0; i <= n; i += 1) pts.push(pointAt(geom, i / n));
  return pts;
}

/**
 * The length of a path in pixels, near enough to time a walk by.
 * @param {PathGeom} geom
 * @returns {number}
 */
export function pathLength(geom) {
  const pts = samplePath(geom, 24);
  let len = 0;
  for (let i = 1; i < pts.length; i += 1) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/**
 * The regions: one rounded panel each, in its tone at a whisper, with a caption in the corner.
 * @param {any} scene
 * @param {Array<{ label?: string, x: number, y: number, w: number, h: number, tone?: any }>} regions
 * @param {any} th
 * @returns {{ graphics: any, captions: any[] }}
 */
export function drawRegions(scene, regions, th) {
  const g = scene.add.graphics();
  /** @type {any[]} */
  const captions = [];
  for (const r of regions || []) {
    const tone = toneOf(th, r.tone, th.line);
    const radius = Math.max(4, Math.min(18, r.w / 4, r.h / 4));
    g.fillStyle(tone, 0.09);
    g.fillRoundedRect(r.x, r.y, r.w, r.h, radius);
    g.lineStyle(1, tone, 0.4);
    g.strokeRoundedRect(r.x, r.y, r.w, r.h, radius);
    if (r.label) {
      captions.push(scene.add.text(r.x + 14, r.y + 10, String(r.label), {
        fontFamily: th.fontDisplay || th.font, fontSize: '14px', color: cssColour(th.inkDim),
      }).setOrigin(0, 0));
    }
  }
  return { graphics: g, captions: captions };
}

/**
 * Every path, redrawn into one Graphics: open ones in ink, closed ones in the hairline colour,
 * hidden ones (beyond the fog) not at all.
 * @param {any} g
 * @param {Array<{ geom: PathGeom, open: boolean, shown: boolean, style?: string }>} list
 * @param {any} th
 * @param {'dotted'|'dashed'|undefined} defaultStyle
 * @returns {void}
 */
export function drawPaths(g, list, th, defaultStyle) {
  g.clear();
  for (const item of list) {
    if (!item.shown) continue;
    const colour = item.open ? th.ink : th.line;
    const alpha = item.open ? 0.85 : 0.8;
    const style = item.style || defaultStyle || 'dotted';
    const pts = samplePath(item.geom, Math.max(8, Math.ceil(pathLength(item.geom) / 3)));
    if (style === 'dashed') dashes(g, pts, colour, alpha, item.open ? 2 : 1.5);
    else dots(g, pts, colour, alpha, item.open ? 1.8 : 1.4);
  }
}

/**
 * Dots every DOT_STEP pixels of arc length along a polyline.
 * @param {any} g
 * @param {Array<{ x: number, y: number }>} pts
 * @param {number} colour
 * @param {number} alpha
 * @param {number} radius
 * @returns {void}
 */
function dots(g, pts, colour, alpha, radius) {
  g.fillStyle(colour, alpha);
  let carry = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let d = carry;
    while (d <= seg) {
      const k = seg > 0 ? d / seg : 0;
      g.fillCircle(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, radius);
      d += DOT_STEP;
    }
    carry = d - seg;
  }
}

/**
 * Dashes of DASH_ON pixels with DASH_OFF between them, by arc length along a polyline.
 * @param {any} g
 * @param {Array<{ x: number, y: number }>} pts
 * @param {number} colour
 * @param {number} alpha
 * @param {number} width
 * @returns {void}
 */
function dashes(g, pts, colour, alpha, width) {
  g.lineStyle(width, colour, alpha);
  let on = true;
  let left = DASH_ON;
  for (let i = 1; i < pts.length; i += 1) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = Math.hypot(b.x - a.x, b.y - a.y);
    while (seg > 0 && left < seg) {
      const k = left / seg;
      const m = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      if (on) g.lineBetween(a.x, a.y, m.x, m.y);
      on = !on;
      left = on ? DASH_ON : DASH_OFF;
      a = m;
      seg = Math.hypot(b.x - a.x, b.y - a.y);
    }
    if (on && seg > 0) g.lineBetween(a.x, a.y, b.x, b.y);
    left -= seg;
  }
}

/**
 * @typedef {object} NodeEntry
 * @property {any} node       the app's own node object
 * @property {string} kind
 * @property {number} r
 * @property {any} box        the container at the node's position
 * @property {any} ring       the resting mark of the current node
 * @property {any} body       the shape
 * @property {any} lock       the padlock, drawn while closed
 * @property {any} stars      the three stars
 * @property {any} label
 * @property {any} best       the best score, mono, under the stars
 * @property {any} hit        the invisible disc that takes the pointer
 * @property {boolean} lifting  whether a fog-lift tween owns the box's alpha right now
 */

/**
 * One node's objects, in a container at its place on the map. Nothing is painted until
 * paintNode() is told the state.
 * @param {any} scene
 * @param {any} node
 * @param {any} th
 * @returns {NodeEntry}
 */
export function buildNode(scene, node, th) {
  const kind = NODE_RADIUS[node.kind] ? node.kind : 'level';
  const r = NODE_RADIUS[kind];
  const box = scene.add.container(node.x, node.y);
  const ring = scene.add.graphics();
  const body = scene.add.graphics();
  const lock = scene.add.graphics();
  const stars = scene.add.graphics();
  const label = scene.add.text(0, r + 9, node.label != null ? String(node.label) : String(node.id), {
    fontFamily: th.font, fontSize: '13px', color: cssColour(th.ink), align: 'center',
  }).setOrigin(0.5, 0);
  const best = scene.add.text(0, r + 41, '', {
    fontFamily: th.fontMono || th.font, fontSize: '11px', color: cssColour(th.inkDim),
  }).setOrigin(0.5, 0);
  // The hit disc has no fill and no stroke, so it draws nothing and still takes the pointer.
  const hit = scene.add.circle(0, 0, r + 8);
  box.add([ring, body, lock, stars, label, best, hit]);
  return {
    node: node, kind: kind, r: r, box: box, ring: ring, body: body, lock: lock,
    stars: stars, label: label, best: best, hit: hit, lifting: false,
  };
}

/**
 * Repaint a node for its state. The box's alpha is the caller's, because the fog owns it.
 * @param {NodeEntry} entry
 * @param {{ unlocked: boolean, stars: number, best: number, current: boolean, hover: boolean }} state
 * @param {any} th
 * @returns {void}
 */
export function paintNode(entry, state, th) {
  const r = entry.r;
  const open = !!state.unlocked;
  const fill = open ? th[NODE_ROLE[entry.kind]] : th.surface;
  const edge = open ? th.ink : th.line;
  const body = entry.body;
  body.clear();
  body.fillStyle(fill, 1);
  body.lineStyle(open ? 2 : 1.5, edge, open ? 0.9 : 0.8);
  if (entry.kind === 'town') {
    body.fillRoundedRect(-r, -r, r * 2, r * 2, r * 0.35);
    body.strokeRoundedRect(-r, -r, r * 2, r * 2, r * 0.35);
  } else if (entry.kind === 'boss') {
    const pts = [{ x: 0, y: -r }, { x: r, y: 0 }, { x: 0, y: r }, { x: -r, y: 0 }];
    body.fillPoints(pts, true);
    body.strokePoints(pts, true);
  } else if (entry.kind === 'secret') {
    body.lineStyle(3, open ? fill : edge, 1);
    body.strokeCircle(0, 0, r * 0.8);
    body.fillStyle(open ? fill : edge, 1);
    body.fillCircle(0, 0, r * 0.3);
  } else {
    body.fillCircle(0, 0, r);
    body.strokeCircle(0, 0, r);
  }

  entry.lock.clear();
  if (!open) drawLock(entry.lock, th.inkDim);

  entry.stars.clear();
  if (open && entry.kind !== 'town') drawStars(entry.stars, state.stars, r + 30, th);

  entry.best.setText(open && state.best > 0 ? String(state.best) : '');
  const inkFor = state.current || state.hover ? th.accent : (open ? th.ink : th.inkDim);
  entry.label.setColor(cssColour(inkFor));

  entry.ring.clear();
  if (state.current) {
    entry.ring.lineStyle(2, th.accent, 0.9);
    entry.ring.strokeCircle(0, 0, r + 5);
  }
}

/**
 * A padlock at the origin: a rounded body and an arc for the shackle.
 * @param {any} g
 * @param {number} colour
 * @returns {void}
 */
function drawLock(g, colour) {
  g.fillStyle(colour, 1);
  g.fillRoundedRect(-5, -1, 10, 8, 2);
  g.lineStyle(2, colour, 1);
  g.beginPath();
  g.arc(0, -1, 3.5, Math.PI, 0, false);
  g.strokePath();
}

/**
 * Three stars in a row, the earned ones in the warm tone and the rest as outlines' worth of
 * hairline.
 * @param {any} g
 * @param {number} count
 * @param {number} y
 * @param {any} th
 * @returns {void}
 */
function drawStars(g, count, y, th) {
  const n = Math.max(0, Math.min(3, Math.floor(typeof count === 'number' ? count : 0)));
  for (let i = 0; i < 3; i += 1) {
    const earned = i < n;
    g.fillStyle(earned ? th.warn : th.line, earned ? 1 : 0.7);
    g.fillPoints(starPoints((i - 1) * STAR_GAP, y, STAR_OUTER, STAR_INNER), true);
  }
}

/**
 * The ten points of a five-pointed star.
 * @param {number} cx
 * @param {number} cy
 * @param {number} outer
 * @param {number} inner
 * @returns {Array<{ x: number, y: number }>}
 */
function starPoints(cx, cy, outer, inner) {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
  }
  return pts;
}

/**
 * The walker when the app brings no sprite: a token in the accent colour on a soft shadow, with a
 * highlight so it reads as a thing rather than a dot. The body is returned apart from the box so
 * it can bob while the shadow stays on the ground.
 * @param {any} scene
 * @param {any} th
 * @returns {{ box: any, body: any }}
 */
export function buildWalker(scene, th) {
  const box = scene.add.container(0, 0);
  const shadow = scene.add.graphics();
  shadow.fillStyle(th.ink, 0.18);
  shadow.fillEllipse(0, 9, 16, 6);
  const body = scene.add.graphics();
  body.fillStyle(th.accent, 1);
  body.fillCircle(0, 0, 9);
  body.lineStyle(2, th.ink, 0.9);
  body.strokeCircle(0, 0, 9);
  body.fillStyle(th.bg, 1);
  body.fillCircle(-3, -3, 2.6);
  box.add([shadow, body]);
  return { box: box, body: body };
}

/**
 * The haze over a node beyond the frontier: a cloud of circles in the page's own colours, big
 * enough to cover the node, its label and its stars.
 * @param {any} scene
 * @param {number} x
 * @param {number} y
 * @param {any} th
 * @returns {any} the Graphics
 */
export function buildHaze(scene, x, y, th) {
  const g = scene.add.graphics();
  g.setPosition(x, y);
  g.fillStyle(th.bg, 0.6);
  g.fillCircle(0, 10, 40);
  g.fillStyle(th.surface, 0.92);
  g.fillCircle(-13, 6, 17);
  g.fillCircle(10, -2, 19);
  g.fillCircle(6, 16, 15);
  g.fillCircle(-5, -9, 13);
  g.lineStyle(1, th.line, 0.45);
  g.strokeCircle(10, -2, 19);
  g.strokeCircle(-13, 6, 17);
  return g;
}

/**
 * One pulse on a node: a ring that grows and fades once, then destroys itself. It is put into
 * the map's container before the tween starts, so the ring is in place whenever the tween ends.
 * @param {any} scene
 * @param {any} parent  the container the ring is added to
 * @param {number} x
 * @param {number} y
 * @param {number} r
 * @param {any} th
 * @param {number} pace
 * @param {string} ease
 * @param {(ring: any) => void} done  called with the ring once it is gone
 * @returns {any} the ring, so a destroy() can kill it early
 */
export function pulseAt(scene, parent, x, y, r, th, pace, ease, done) {
  const g = scene.add.graphics();
  g.setPosition(x, y);
  g.lineStyle(2, th.accent, 1);
  g.strokeCircle(0, 0, r + 4);
  parent.add(g);
  scene.tweens.add({
    targets: g, scaleX: 1.9, scaleY: 1.9, alpha: 0, duration: pace * 3, ease: ease, repeat: 0,
    onComplete: function () {
      if (g.scene) g.destroy();
      done(g);
    },
  });
  return g;
}
