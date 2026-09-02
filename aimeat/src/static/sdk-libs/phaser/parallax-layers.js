/**
 * @file phaser/parallax-layers.js
 * @description The painters behind parallax.js: ten kinds of backdrop layer, each drawn ONCE into
 *   one period of a canvas texture that a TileSprite then repeats across any world width.
 *
 *   EVERY SHAPE COMES FROM A SEED. A layer is drawn from a small deterministic generator, so the
 *   same seed gives the same mountains on every visit and two levels with different seeds get
 *   different skylines from the same code. Nothing here reads Math.random.
 *
 *   EVERY PERIOD TILES. A ridge ends at the height it started, a hill is a sum of whole-number
 *   harmonics of the period, and a cloud or a tree that crosses the right edge is drawn again
 *   coming in from the left. The seam a TileSprite makes is therefore never visible.
 *
 *   NO COLOUR IS WRITTEN HERE. A painter takes the layer's resolved colour and its lit, shadowed
 *   and hazed neighbours from parallax.js, which took them from the theme; the helpers below only
 *   move numbers toward each other. Two poles (white and black) exist so that shade() can lighten
 *   and darken, exactly as assets.js does it.
 *
 *   THE BAND IS THE TOP OF THE TEXTURE. A painter draws its silhouette in the first box.band
 *   pixels and fills solid to the texture's bottom edge, so a bottom-anchored sprite can be taller
 *   than the band (textures are power-of-two, see parallax.js) and still show ground all the way
 *   down. A flipped layer (a cave ceiling) is the same painting mirrored by the caller.
 * @structure rng · mix / shade / luminance / pot / css · KIND_DEFAULTS · KINDS · paint(kind, ctx,
 *   box, layer, colours, rand) dispatching to sky / stars / clouds / mountains / hills / forest /
 *   city / sea / fog / ground
 * @usage  import { paint, KIND_DEFAULTS, rng } from './parallax-layers.js';
 *         paint('hills', ctx, box, layer, colours, rng(seed));
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the ten painters, the seeded generator and the colour helpers.
 */
import { channels } from './tokens.js';

const TAU = Math.PI * 2;

/** The two poles shade() moves a colour toward. Not a palette: the ends of the scale. */
const WHITE = 0xffffff;
const BLACK = 0x000000;

/**
 * A small deterministic generator (mulberry32). Same seed, same sequence, on every visit and in
 * every browser.
 * @param {number} seed
 * @returns {() => number} the next value in [0, 1)
 */
export function rng(seed) {
  let a = (Math.floor(Number(seed) || 0) >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The colour t of the way from a to b.
 * @param {number} a 0xrrggbb
 * @param {number} b 0xrrggbb
 * @param {number} t 0..1
 * @returns {number}
 */
export function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  const from = channels(a);
  const to = channels(b);
  const r = Math.round(from.r + (to.r - from.r) * k);
  const g = Math.round(from.g + (to.g - from.g) * k);
  const bl = Math.round(from.b + (to.b - from.b) * k);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Move a colour toward white (a positive amount) or toward black (a negative one).
 * @param {number} colour 0xrrggbb
 * @param {number} amount -1..1
 * @returns {number}
 */
export function shade(colour, amount) {
  return mix(colour, amount >= 0 ? WHITE : BLACK, Math.abs(amount));
}

/**
 * How light a colour is, 0 (black) to 1 (white). Used to tell which of two page tones is the
 * darker, so "toward dark" means the same thing in light mode and in dark mode.
 * @param {number} colour
 * @returns {number}
 */
export function luminance(colour) {
  const c = channels(colour);
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

/**
 * The smallest power of two at or above n.
 * @param {number} n
 * @returns {number}
 */
export function pot(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * A theme number as the string a 2D canvas context wants, with an alpha.
 * @param {number} colour 0xrrggbb
 * @param {number} [alpha] 0..1, default 1
 * @returns {string}
 */
export function css(colour, alpha) {
  const c = channels(colour);
  const a = alpha == null ? 1 : Math.max(0, Math.min(1, alpha));
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
}

/**
 * What a layer of each kind is when the spec says only its kind: how tall a share of the viewport
 * it takes, how fast it follows the camera, which theme word it wears, how much of the sky's
 * horizon colour is mixed in (aerial perspective), and how fast it moves on its own.
 * @type {Record<string, { height: number, scroll: number, tone: string, alpha: number,
 *   drift: number, haze: number }>}
 */
export const KIND_DEFAULTS = {
  sky: { height: 1, scroll: 0, tone: 'ch1', alpha: 1, drift: 0, haze: 0 },
  stars: { height: 0.7, scroll: 0.04, tone: 'light', alpha: 1, drift: 0, haze: 0 },
  clouds: { height: 0.5, scroll: 0.12, tone: 'surface', alpha: 0.9, drift: 6, haze: 0.15 },
  mountains: { height: 0.5, scroll: 0.2, tone: 'inkDim', alpha: 1, drift: 0, haze: 0.5 },
  hills: { height: 0.36, scroll: 0.35, tone: 'ok', alpha: 1, drift: 0, haze: 0.35 },
  forest: { height: 0.34, scroll: 0.5, tone: 'ok', alpha: 1, drift: 0, haze: 0.25 },
  city: { height: 0.55, scroll: 0.3, tone: 'inkDim', alpha: 1, drift: 0, haze: 0.4 },
  sea: { height: 0.3, scroll: 0.45, tone: 'ch1', alpha: 1, drift: 12, haze: 0.2 },
  fog: { height: 0.22, scroll: 0.55, tone: 'line', alpha: 0.6, drift: 4, haze: 0 },
  ground: { height: 0.14, scroll: 0.85, tone: 'inkDim', alpha: 1, drift: 0, haze: 0 },
};

/** The kinds, in the order a stack usually has them. */
export const KINDS = Object.keys(KIND_DEFAULTS);

/**
 * @typedef {object} LayerBox
 * @property {number} w      the texture's width, one period, in texture pixels
 * @property {number} h      the texture's height
 * @property {number} band   how many of those rows the silhouette may use, from the top
 * @property {number} viewW  the viewport, in the same pixels, for the sky's disc
 * @property {number} viewH
 */

/**
 * @typedef {object} LayerColours
 * @property {number} tone       the layer's own colour, tinted for the time of day and hazed
 * @property {number} lit        a lighter face of it
 * @property {number} dim        a darker face of it
 * @property {number} back       the same colour pushed further into the haze, for a second row
 * @property {number} skyTop
 * @property {number} skyBottom
 * @property {'sun'|'moon'|null} disc  what the time of day puts in the sky
 * @property {number} sun
 * @property {number} moon
 * @property {{ tone: number, alpha: number, share: number }} window  a city's lit windows
 */

/** @param {any} ctx @param {number} x @param {number} y @param {number} r */
function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.2, r), 0, TAU);
  ctx.fill();
}

/**
 * Draw a thing at x and again one period either side, so whatever crosses an edge comes back in
 * on the other. The context clips what lands outside, so the extra draws cost nothing visible.
 * @param {number} w
 * @param {number} x
 * @param {(x: number) => void} draw
 */
function wrapped(w, x, draw) {
  draw(x);
  draw(x - w);
  draw(x + w);
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   The painters
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * A vertical gradient over the viewport's height, and the disc the time of day asks for.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {any} layer
 * @param {LayerColours} pal
 * @param {() => number} _rand
 */
function sky(ctx, box, layer, pal, _rand) {
  const grad = ctx.createLinearGradient(0, 0, 0, box.viewH);
  grad.addColorStop(0, css(pal.skyTop, 1));
  grad.addColorStop(1, css(pal.skyBottom, 1));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, box.w, box.viewH);
  ctx.fillStyle = css(pal.skyBottom, 1);
  ctx.fillRect(0, box.viewH, box.w, Math.max(0, box.h - box.viewH));

  const disc = layer.disc === undefined || layer.disc === 'auto' ? pal.disc : layer.disc;
  if (disc !== 'sun' && disc !== 'moon') return;
  const r = box.viewH * 0.065;
  const x = box.viewW * (typeof layer.discX === 'number' ? layer.discX : 0.74);
  const y = box.viewH * (typeof layer.discY === 'number' ? layer.discY : 0.2);
  const tone = disc === 'moon' ? pal.moon : pal.sun;
  for (let i = 3; i >= 1; i--) {
    ctx.fillStyle = css(tone, 0.07 * i);
    circle(ctx, x, y, r * (1 + i * 0.55));
  }
  ctx.fillStyle = css(tone, 1);
  circle(ctx, x, y, r);
  if (disc === 'moon') {
    ctx.fillStyle = css(pal.skyTop, 1);
    circle(ctx, x + r * 0.45, y - r * 0.2, r * 0.82);
  }
}

/**
 * A field of points. Every random is drawn for every star BEFORE the subset test, so the two
 * halves a twinkling layer paints (layer.subset 0 and 1) place their stars identically and
 * differ only in which ones each shows.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {any} layer
 * @param {LayerColours} pal
 * @param {() => number} rand
 */
function stars(ctx, box, layer, pal, rand) {
  const density = typeof layer.density === 'number' ? layer.density : 1;
  const count = Math.round((box.w * box.band) / 2600 * density);
  const subset = typeof layer.subset === 'number' ? layer.subset : -1;
  for (let i = 0; i < count; i++) {
    const x = rand() * box.w;
    const y = rand() * box.band;
    const r = 0.5 + rand() * rand() * 1.6;
    const a = 0.45 + rand() * 0.55;
    if (subset >= 0 && i % 2 !== subset) continue;
    ctx.fillStyle = css(pal.tone, a);
    circle(ctx, x, y, r);
  }
}

/**
 * Puffs of circles with a shadowed underside, each cloud drawn on both sides of the seam.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {any} layer
 * @param {LayerColours} pal
 * @param {() => number} rand
 */
function clouds(ctx, box, layer, pal, rand) {
  const density = typeof layer.density === 'number' ? layer.density : 1;
  const count = Math.max(2, Math.round((box.w / 300) * density));
  for (let i = 0; i < count; i++) {
    const cx = rand() * box.w;
    const cy = box.band * (0.12 + rand() * 0.6);
    const size = box.band * (0.1 + rand() * 0.14);
    const puffs = 3 + Math.floor(rand() * 3);
    /** @type {Array<{ dx: number, dy: number, r: number }>} */
    const list = [];
    for (let p = 0; p < puffs; p++) {
      list.push({
        dx: (p - (puffs - 1) / 2) * size * 0.9,
        dy: (rand() - 0.5) * size * 0.4,
        r: size * (0.6 + rand() * 0.6),
      });
    }
    wrapped(box.w, cx, function (x) {
      ctx.fillStyle = css(pal.dim, 0.45);
      for (const puff of list) circle(ctx, x + puff.dx, cy + puff.dy + size * 0.28, puff.r);
      ctx.fillStyle = css(pal.tone, 1);
      for (const puff of list) circle(ctx, x + puff.dx, cy + puff.dy, puff.r);
    });
  }
}

/**
 * One jagged ridge: peaks at whole steps, a valley between each pair, and the last peak set to
 * the first so the period closes.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {number} colour
 * @param {number} tall     how much of the band the peaks may climb, 0..1
 * @param {number} perK     peaks per 1024 texture pixels
 * @param {() => number} rand
 */
function ridge(ctx, box, colour, tall, perK, rand) {
  const n = Math.max(4, Math.round((perK * box.w) / 1024));
  const step = box.w / n;
  /** @type {number[]} */
  const peaks = [];
  for (let i = 0; i < n; i++) peaks.push(box.band * (1 - tall * (0.35 + rand() * 0.65)));
  peaks.push(peaks[0]);
  ctx.fillStyle = css(colour, 1);
  ctx.beginPath();
  ctx.moveTo(0, box.h);
  for (let i = 0; i <= n; i++) {
    ctx.lineTo(i * step, peaks[i]);
    if (i < n) {
      ctx.lineTo(i * step + step * (0.5 + (rand() - 0.5) * 0.3), box.band * (0.72 + rand() * 0.22));
    }
  }
  ctx.lineTo(box.w, box.h);
  ctx.closePath();
  ctx.fill();
}

/**
 * A far range: a hazed ridge behind and a sharper one in front.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {any} layer
 * @param {LayerColours} pal
 * @param {() => number} rand
 */
function mountains(ctx, box, layer, pal, rand) {
  const jag = typeof layer.jag === 'number' ? layer.jag : 1;
  ridge(ctx, box, pal.back, 0.95, 7 * jag, rand);
  ridge(ctx, box, pal.tone, 0.75, 10 * jag, rand);
}

/**
 * A smooth line: three sine harmonics whose periods divide the texture's width, so the curve
 * meets itself at the seam.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {number} colour
 * @param {number} lift  how much of the band the crests reach, 0..1
 * @param {() => number} rand
 */
function roll(ctx, box, colour, lift, rand) {
  const k1 = 1 + Math.floor(rand() * 2);
  const k2 = 3 + Math.floor(rand() * 3);
  const k3 = 6 + Math.floor(rand() * 4);
  const p1 = rand() * TAU;
  const p2 = rand() * TAU;
  const p3 = rand() * TAU;
  ctx.fillStyle = css(colour, 1);
  ctx.beginPath();
  ctx.moveTo(0, box.h);
  for (let x = 0; x <= box.w; x += 4) {
    const t = (x / box.w) * TAU;
    const wave = 0.5 + 0.25 * Math.sin(k1 * t + p1) + 0.15 * Math.sin(k2 * t + p2) + 0.1 * Math.sin(k3 * t + p3);
    ctx.lineTo(x, box.band * (1 - lift * wave));
  }
  ctx.lineTo(box.w, box.h);
  ctx.closePath();
  ctx.fill();
}

/**
 * Rolling hills: a hazed roll behind, the layer's own in front.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {any} _layer
 * @param {LayerColours} pal
 * @param {() => number} rand
 */
function hills(ctx, box, _layer, pal, rand) {
  roll(ctx, box, pal.back, 1, rand);
  roll(ctx, box, pal.tone, 0.7, rand);
}

/**
 * One conifer: a trunk and three tiers, standing on the band's floor.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {number} x
 * @param {number} h
 */
function tree(ctx, box, x, h) {
  const base = box.band;
  const top = base - h;
  const width = h * 0.55;
  ctx.fillRect(x - width * 0.08, base - h * 0.22, width * 0.16, h * 0.22);
  for (let i = 0; i < 3; i++) {
    const ty = top + i * h * 0.22;
    const tw = width * (0.45 + i * 0.28);
    const th = h * 0.45;
    ctx.beginPath();
    ctx.moveTo(x, ty);
    ctx.lineTo(x - tw / 2, ty + th);
    ctx.lineTo(x + tw / 2, ty + th);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * One row of trees, spaced with jitter, each drawn on both sides of the seam.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {number} colour
 * @param {number} minH
 * @param {number} maxH
 * @param {() => number} rand
 */
function treeRow(ctx, box, colour, minH, maxH, rand) {
  ctx.fillStyle = css(colour, 1);
  const gap = maxH * 0.42;
  let x = rand() * gap;
  while (x < box.w) {
    const h = minH + rand() * (maxH - minH);
    wrapped(box.w, x, function (at) { tree(ctx, box, at, h); });
    x += gap * (0.6 + rand() * 0.8);
  }
  ctx.fillRect(0, box.band * 0.98, box.w, Math.max(0, box.h - box.band * 0.98));
}

/**
 * A tree line at two depths: a smaller, hazed row behind and a taller one in front.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {any} _layer
 * @param {LayerColours} pal
 * @param {() => number} rand
 */
function forest(ctx, box, _layer, pal, rand) {
  treeRow(ctx, box, pal.back, box.band * 0.5, box.band * 0.72, rand);
  treeRow(ctx, box, pal.tone, box.band * 0.72, box.band * 0.98, rand);
}

/**
 * One row of buildings filling exactly one period, so the seam falls on a building's edge.
 * Windows are lit at the share and alpha the time of day gives them.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {number} colour
 * @param {number} tall
 * @param {{ tone: number, alpha: number, share: number }|null} window
 * @param {() => number} rand
 */
function skyline(ctx, box, colour, tall, window, rand) {
  const gap = Math.max(1, box.w * 0.004);
  const cell = Math.max(3, Math.round(box.band * 0.035));
  let x = 0;
  while (x < box.w) {
    const bw = box.w * (0.03 + rand() * 0.06);
    const bh = box.band * tall * (0.3 + rand() * 0.7);
    const right = Math.min(box.w, x + bw);
    const top = box.band - bh;
    ctx.fillStyle = css(colour, 1);
    ctx.fillRect(x, top, right - x, box.h - top);
    if (rand() < 0.2) {
      ctx.fillRect(x + (right - x) / 2 - 1, top - box.band * 0.08, 2, box.band * 0.08);
    }
    if (window && window.alpha > 0) {
      ctx.fillStyle = css(window.tone, window.alpha);
      const cols = Math.floor((right - x - cell) / (cell * 2));
      const rows = Math.floor((bh - cell) / (cell * 2));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rand() < window.share) {
            ctx.fillRect(x + cell + c * cell * 2, top + cell + r * cell * 2, cell, cell);
          }
        }
      }
    }
    x = right + gap;
  }
  ctx.fillStyle = css(colour, 1);
  ctx.fillRect(0, box.band * 0.95, box.w, Math.max(0, box.h - box.band * 0.95));
}

/**
 * A city: a hazed skyline behind and a lit one in front.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {any} layer
 * @param {LayerColours} pal
 * @param {() => number} rand
 */
function city(ctx, box, layer, pal, rand) {
  skyline(ctx, box, pal.back, 0.95, null, rand);
  skyline(ctx, box, pal.tone, 0.72, layer.windows === false ? null : pal.window, rand);
}

/**
 * A band of water: a gently curved top edge, a lit-to-deep gradient, rows of wave strokes that
 * get sparser and heavier toward the front.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {any} _layer
 * @param {LayerColours} pal
 * @param {() => number} rand
 */
function sea(ctx, box, _layer, pal, rand) {
  const k = 2 + Math.floor(rand() * 3);
  const phase = rand() * TAU;
  const grad = ctx.createLinearGradient(0, 0, 0, box.band);
  grad.addColorStop(0, css(pal.lit, 1));
  grad.addColorStop(1, css(pal.tone, 1));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, box.h);
  for (let x = 0; x <= box.w; x += 4) {
    const t = (x / box.w) * TAU;
    ctx.lineTo(x, box.band * 0.05 * (1 + Math.sin(k * t + phase)));
  }
  ctx.lineTo(box.w, box.h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = css(pal.tone, 1);
  ctx.fillRect(0, box.band, box.w, Math.max(0, box.h - box.band));

  const rows = 5;
  ctx.lineCap = 'round';
  for (let r = 0; r < rows; r++) {
    const y = box.band * (0.2 + (r / rows) * 0.72);
    const len = box.w / (16 - r * 2);
    ctx.strokeStyle = css(pal.lit, 0.6 - r * 0.08);
    ctx.lineWidth = 1 + r * 0.5;
    for (let x = rand() * len; x < box.w; x += len * (1.4 + rand() * 0.9)) {
      wrapped(box.w, x, function (at) {
        ctx.beginPath();
        ctx.moveTo(at, y);
        ctx.quadraticCurveTo(at + len * 0.3, y - len * 0.08, at + len * 0.6, y);
        ctx.stroke();
      });
    }
  }
}

/**
 * A low translucent band with a few soft banks in it.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {any} _layer
 * @param {LayerColours} pal
 * @param {() => number} rand
 */
function fog(ctx, box, _layer, pal, rand) {
  const grad = ctx.createLinearGradient(0, 0, 0, box.band);
  grad.addColorStop(0, css(pal.tone, 0));
  grad.addColorStop(0.7, css(pal.tone, 0.55));
  grad.addColorStop(1, css(pal.tone, 0.7));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, box.w, box.band);
  ctx.fillStyle = css(pal.tone, 0.7);
  ctx.fillRect(0, box.band, box.w, Math.max(0, box.h - box.band));
  const n = Math.max(2, Math.round(box.w / 220));
  ctx.fillStyle = css(pal.lit, 0.18);
  for (let i = 0; i < n; i++) {
    const cx = rand() * box.w;
    const cy = box.band * (0.4 + rand() * 0.5);
    const rx = box.w * (0.08 + rand() * 0.12);
    const ry = box.band * (0.12 + rand() * 0.15);
    wrapped(box.w, cx, function (at) {
      ctx.beginPath();
      ctx.ellipse(at, cy, rx, ry, 0, 0, TAU);
      ctx.fill();
    });
  }
}

/**
 * The near strip: solid, a lit edge along the top, pebbles and tufts scattered in it.
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {any} _layer
 * @param {LayerColours} pal
 * @param {() => number} rand
 */
function ground(ctx, box, _layer, pal, rand) {
  ctx.fillStyle = css(pal.tone, 1);
  ctx.fillRect(0, 0, box.w, box.h);
  ctx.fillStyle = css(pal.lit, 1);
  ctx.fillRect(0, 0, box.w, Math.max(2, box.band * 0.06));
  const n = Math.max(4, Math.round(box.w / 40));
  ctx.fillStyle = css(pal.dim, 0.7);
  for (let i = 0; i < n; i++) {
    const x = rand() * box.w;
    const y = box.band * (0.15 + rand() * 0.75);
    const s = 2 + rand() * 3;
    ctx.fillRect(x, y, s * 1.6, s * 0.7);
  }
}

/** @type {Record<string, (ctx: any, box: LayerBox, layer: any, pal: LayerColours, rand: () => number) => void>} */
const PAINTERS = { sky, stars, clouds, mountains, hills, forest, city, sea, fog, ground };

/**
 * Draw one period of a layer into a 2D context.
 * @param {string} kind
 * @param {any} ctx
 * @param {LayerBox} box
 * @param {any} layer
 * @param {LayerColours} pal
 * @param {() => number} rand
 * @returns {boolean} whether the kind was known
 */
export function paint(kind, ctx, box, layer, pal, rand) {
  const painter = PAINTERS[kind];
  if (!painter) return false;
  painter(ctx, box, layer, pal, rand);
  return true;
}
