/**
 * @file atelier/ambient-presets.js
 * @description The ambient renderers — what the one layer allowed to move at idle actually
 *   paints. Every number the contrast matrix proves lives in the registry
 *   (src/data/atelier-ambients.ts); the copies here (PRESET_IDS, BASE_ALPHA, PEAK, FPS) are
 *   pinned to it by test/unit/atelier-ambients.test.ts, so the kit cannot drift from its proof.
 *
 *     waves   the PlayStation ribbon: three translucent sine bands, a glow, rising specks
 *     dust    motes at three depths, drifting up and sideways
 *     grid    the perspective floor, scrolling toward the viewer
 *     static  phosphor noise tiles at twelve frames a second
 *     ink     large soft blooms breathing over half a minute
 *     plasma  the demo-scene plasma: four sines per pixel at an eighth of the size, upscaled
 *     lava    metaballs at a sixth of the size: blobs that rise, stretch and fuse like wax
 *     tunnel  rings rushing outward on a perspective spacing, spokes turning through them
 *     aurora  has no renderer here: it is CSS on the layer (ambient.css), the compositor's alone
 *
 *   A renderer keeps no state beyond what setup() returned. The core (ambient.js) owns the
 *   clock, the gates, the canvas and the size; it calls setup(w, h, palette, rng) once per size
 *   and per palette, and frame(ctx, state, t, w, h, palette) per tick with t in seconds. A
 *   renderer with `scale` above 1 draws into an offscreen canvas at 1/scale resolution and the
 *   core upscales it, blitting at PEAK: the upscale is the glow, it costs a fraction of the
 *   pixels, and the blit is what caps the pigment at exactly the share the matrix composited. A
 *   renderer at scale 1 draws straight onto the visible canvas and holds itself to PEAK.
 *
 *   NO COLOUR IS WRITTEN HERE. Every colour arrives in the palette as bytes read off the --ak-*
 *   tokens (token-color.js), and the strings are assembled from those bytes.
 * @structure PRESET_IDS · BASE_ALPHA · PEAK · FPS · CSS_PRESETS · mulberry32() · rgba() · RENDERERS
 * @usage  import { RENDERERS, CSS_PRESETS, BASE_ALPHA, PEAK, FPS } from './ambient-presets.js';
 * @version-history
 *   v0.48.0 — 2026-09-05 — THE GENERATORS (wish-atelier-post-process-effects, stage 3): plasma,
 *     lava and tunnel join the shelf, each the registry's numbers. The two fields draw into an
 *     ImageData at a fraction of the size, which is what makes a per-pixel loop affordable and
 *     the upscale soft.
 *   v0.47.0 — 2026-09-05 — Initial (wish-atelier-ambient-visuals, stage 3).
 */

/** The ids, in the registry's order. */
export const PRESET_IDS = ['waves', 'aurora', 'dust', 'grid', 'static', 'ink', 'plasma', 'lava', 'tunnel'];
/** The alpha a preset ships at when a look or an app names none (the registry's defaultAlpha). */
export const BASE_ALPHA = { waves: 0.22, aurora: 0.3, dust: 0.6, grid: 0.5, static: 0.25, ink: 0.35, plasma: 0.25, lava: 0.25, tunnel: 0.5 };
/** The strongest pigment a preset composites anywhere at alpha 1 (the registry's peak). */
export const PEAK = { waves: 0.35, aurora: 0.26, dust: 0.5, grid: 0.6, static: 0.3, ink: 0.22, plasma: 0.32, lava: 0.3, tunnel: 0.55 };
/** Frames per second each loop is gated to; 0 for the compositor preset. */
export const FPS = { waves: 30, aurora: 0, dust: 30, grid: 30, static: 12, ink: 24, plasma: 24, lava: 24, tunnel: 30 };
/** Presets that are CSS on the layer rather than a canvas loop. */
export const CSS_PRESETS = { aurora: true };

const TAU = Math.PI * 2;

/**
 * A seeded generator, so the still frame is the same picture every time the layer mounts (the
 * Design Book's bench photographs it; two runs must agree).
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A colour string from palette bytes and an alpha.
 * @param {number[]} c
 * @param {number} a
 * @returns {string}
 */
export function rgba(c, a) {
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}

/**
 * @typedef {{ dark: boolean, bg: number[], ink: number[], accent: number[],
 *   spectrum2: number[], spectrum3: number[] }} Palette
 */
/**
 * @typedef {object} Renderer
 * @property {number} scale  1 draws on the visible canvas; above 1 draws at 1/scale and is upscaled
 * @property {(w: number, h: number, palette: Palette, rng: () => number) => any} setup
 * @property {(ctx: CanvasRenderingContext2D, state: any, t: number, w: number, h: number, palette: Palette) => void} frame
 */

// ── waves ────────────────────────────────────────────────────────────────────────────────────

/** @type {Renderer} */
const waves = {
  scale: 2,
  setup(w, h, palette, rng) {
    const colours = [palette.accent, palette.spectrum2, palette.spectrum3];
    const ribbons = [];
    for (let i = 0; i < 3; i++) {
      ribbons.push({
        base: 0.38 + i * 0.13 + (rng() - 0.5) * 0.06,
        a1: 0.05 + rng() * 0.05, k1: (1.2 + rng() * 1.2) * TAU / w, w1: 0.25 + rng() * 0.2,
        a2: 0.02 + rng() * 0.03, k2: (3 + rng() * 2) * TAU / w, w2: 0.4 + rng() * 0.3,
        thick: 0.05 + rng() * 0.05,
        colour: colours[i % 3],
      });
    }
    const specks = [];
    for (let i = 0; i < 12; i++) {
      specks.push({ x: rng(), y: rng(), r: 0.8 + rng() * 1.6, v: 0.01 + rng() * 0.02, phase: rng() * TAU });
    }
    return { ribbons, specks };
  },
  frame(ctx, state, t, w, h, palette) {
    ctx.clearRect(0, 0, w, h);
    // Light adds up on a dark screen the way it does on a real one; on a light ground additive
    // washes to white, so the bands simply lie on the page.
    ctx.globalCompositeOperation = palette.dark ? 'lighter' : 'source-over';
    const step = 8;
    for (const r of state.ribbons) {
      const y = function (x, off) {
        return h * (r.base + off) + h * (r.a1 * Math.sin(r.k1 * x + r.w1 * t) + r.a2 * Math.sin(r.k2 * x - r.w2 * t));
      };
      ctx.beginPath();
      ctx.moveTo(0, y(0, -r.thick / 2));
      for (let x = step; x <= w + step; x += step) ctx.lineTo(x, y(x, -r.thick / 2));
      for (let x = w + step; x >= 0; x -= step) ctx.lineTo(x, y(x, r.thick / 2));
      ctx.closePath();
      ctx.fillStyle = rgba(r.colour, 0.55);
      ctx.fill();
      // The glow is the centre line drawn wide and faint; the upscale softens it further.
      ctx.beginPath();
      ctx.moveTo(0, y(0, 0));
      for (let x = step; x <= w + step; x += step) ctx.lineTo(x, y(x, 0));
      ctx.lineWidth = h * r.thick * 2.2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(r.colour, 0.14);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const s of state.specks) {
      const sy = ((s.y - t * s.v) % 1 + 1) % 1;
      const sx = ((s.x + Math.sin(t * 0.3 + s.phase) * 0.01) % 1 + 1) % 1;
      ctx.beginPath();
      ctx.arc(sx * w, sy * h, s.r, 0, TAU);
      ctx.fillStyle = rgba(palette.ink, 0.6);
      ctx.fill();
    }
  },
};

// ── dust ─────────────────────────────────────────────────────────────────────────────────────

/** @type {Renderer} */
const dust = {
  scale: 1,
  setup(w, h, palette, rng) {
    const count = Math.max(40, Math.min(120, Math.round((w * h) / 12000)));
    const motes = [];
    for (let i = 0; i < count; i++) {
      const z = 0.15 + rng() * 0.85;
      motes.push({
        x: rng() * w, y: rng() * h, z,
        r: 0.8 + z * 2.6, vy: -(4 + z * 12), vx: (rng() - 0.5) * 6, phase: rng() * TAU,
      });
    }
    return { motes, t: null };
  },
  frame(ctx, state, t, w, h, palette) {
    const dt = state.t == null ? 0 : Math.min(Math.max(t - state.t, 0), 0.1);
    state.t = t;
    ctx.clearRect(0, 0, w, h);
    for (const m of state.motes) {
      m.x += (m.vx + Math.sin(t * 0.7 + m.phase) * 4) * dt;
      m.y += m.vy * dt;
      if (m.y < -6) { m.y = h + 6; m.x = (m.x + w * 0.37) % w; }
      if (m.x < -6) m.x = w + 6;
      else if (m.x > w + 6) m.x = -6;
      // Depth is the picture: the near motes are large, quick and in the accent, the far ones
      // are pinpricks of ink. Points, never a ground, so the strongest sits at PEAK.
      const c = m.z > 0.6 ? palette.accent : palette.ink;
      const a = PEAK.dust * (0.35 + m.z * 0.65);
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TAU);
      ctx.fillStyle = rgba(c, a);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 2.4, 0, TAU);
      ctx.fillStyle = rgba(c, a * 0.18);
      ctx.fill();
    }
  },
};

// ── grid ─────────────────────────────────────────────────────────────────────────────────────

/** @type {Renderer} */
const grid = {
  scale: 1,
  setup() {
    return { horizon: 0.44, focal: 1.2, period: 1.5, rows: 18, columns: 22 };
  },
  frame(ctx, state, t, w, h, palette) {
    ctx.clearRect(0, 0, w, h);
    const hz = h * state.horizon;
    const depth = h - hz;
    // A low glow above the horizon, in the second hue — under the page whisper on its own.
    const glow = ctx.createLinearGradient(0, hz - depth * 0.35, 0, hz);
    glow.addColorStop(0, rgba(palette.spectrum2, 0));
    glow.addColorStop(1, rgba(palette.spectrum2, 0.08));
    ctx.fillStyle = glow;
    ctx.fillRect(0, hz - depth * 0.35, w, depth * 0.35);
    ctx.lineWidth = 1;
    // The columns fan out from the vanishing point to the bottom edge and past it.
    const vx = w / 2;
    const fan = ctx.createLinearGradient(0, hz, 0, h);
    fan.addColorStop(0, rgba(palette.accent, 0));
    fan.addColorStop(1, rgba(palette.accent, PEAK.grid * 0.7));
    ctx.strokeStyle = fan;
    for (let i = 0; i <= state.columns; i++) {
      const bx = vx + (i / state.columns - 0.5) * w * 3;
      ctx.beginPath();
      ctx.moveTo(vx, hz);
      ctx.lineTo(bx, h);
      ctx.stroke();
    }
    // The rows approach the viewer: one row per period, seamless because the depth index
    // slides by one exactly as the fraction wraps.
    const frac = (t / state.period) % 1;
    for (let i = 0; i < state.rows; i++) {
      const d = i + 1 - frac;
      const y = hz + depth * state.focal / (d + state.focal);
      const a = PEAK.grid * Math.pow((y - hz) / depth, 1.3);
      ctx.strokeStyle = rgba(palette.accent, a);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  },
};

// ── static ───────────────────────────────────────────────────────────────────────────────────

/** @type {Renderer} */
const staticNoise = {
  scale: 1,
  setup(w, h, palette, rng) {
    // Four to six tiles of ink at random alpha, generated once; a frame is a pattern fill at a
    // random offset, never a per-pixel loop.
    const tiles = [];
    const n = 4 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const cx = c.getContext('2d');
      const img = cx.createImageData(128, 128);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = palette.ink[0];
        d[i + 1] = palette.ink[1];
        d[i + 2] = palette.ink[2];
        d[i + 3] = Math.floor(rng() * 255);
      }
      cx.putImageData(img, 0, 0);
      tiles.push(c);
    }
    return { tiles, patterns: null, frame: 0 };
  },
  frame(ctx, state, t, w, h) {
    if (!state.patterns) {
      state.patterns = state.tiles.map(function (c) { return ctx.createPattern(c, 'repeat'); });
    }
    state.frame++;
    const i = state.frame % state.patterns.length;
    const dx = Math.floor((Math.sin(t * 37.1) * 0.5 + 0.5) * 128);
    const dy = Math.floor((Math.cos(t * 23.7) * 0.5 + 0.5) * 128);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.globalAlpha = PEAK.static;
    ctx.translate(-dx, -dy);
    ctx.fillStyle = state.patterns[i];
    ctx.fillRect(0, 0, w + 128, h + 128);
    ctx.restore();
  },
};

// ── ink ──────────────────────────────────────────────────────────────────────────────────────

/** @type {Renderer} */
const ink = {
  scale: 6,
  setup(w, h, palette, rng) {
    const blooms = [];
    const n = 5 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      blooms.push({
        x: 0.1 + rng() * 0.8, y: 0.1 + rng() * 0.8, r: 0.18 + rng() * 0.22,
        period: 20 + rng() * 20, phase: rng() * TAU,
        colour: i % 2 ? palette.spectrum3 : palette.accent,
      });
    }
    return { blooms };
  },
  frame(ctx, state, t, w, h, palette) {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = palette.dark ? 'lighter' : 'source-over';
    const m = Math.min(w, h);
    for (const b of state.blooms) {
      const breathe = 0.75 + 0.25 * Math.sin((TAU * t) / b.period + b.phase);
      const r = Math.max(1, m * b.r * breathe);
      const cx = b.x * w;
      const cy = b.y * h;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba(b.colour, 0.9));
      g.addColorStop(0.6, rgba(b.colour, 0.35));
      g.addColorStop(1, rgba(b.colour, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
};

// ── plasma ───────────────────────────────────────────────────────────────────────────────────

/**
 * A 256-entry colour ramp through the pigments, built once per palette so a frame is a table
 * lookup per pixel and never a mix.
 * @param {number[][]} stops
 * @returns {Uint8ClampedArray}
 */
function ramp(stops) {
  const lut = new Uint8ClampedArray(256 * 3);
  const n = stops.length - 1;
  for (let i = 0; i < 256; i++) {
    const f = (i / 255) * n;
    const k = Math.min(n - 1, Math.floor(f));
    const p = f - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = stops[k][c] * (1 - p) + stops[k + 1][c] * p;
  }
  return lut;
}

/** @type {Renderer} */
const plasma = {
  scale: 8,
  setup(w, h, palette, rng) {
    // The demo-scene plasma: four sines per pixel over an eighth-resolution image, read from a
    // table, coloured from a ramp, one putImageData; the upscale is the softness. The phases
    // come from the seed, so two mounts agree on the still frame.
    const sin = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) sin[i] = Math.sin((i / 1024) * TAU);
    return {
      sin,
      lut: ramp([palette.accent, palette.spectrum2, palette.spectrum3, palette.accent]),
      img: null,
      phase: [rng() * TAU, rng() * TAU, rng() * TAU, rng() * TAU],
      k: [TAU / (w * 0.9), TAU / (h * 0.7), TAU / (w * 1.4), TAU / (Math.min(w, h) * 0.8)],
    };
  },
  frame(ctx, state, t, w, h) {
    if (!state.img || state.img.width !== w || state.img.height !== h) state.img = ctx.createImageData(w, h);
    const d = state.img.data;
    const sin = state.sin;
    const lut = state.lut;
    const k = state.k;
    const ph = state.phase;
    const cx = w / 2;
    const cy = h / 2;
    // An angle in radians to a table index: 1024 entries over one turn, wrapped.
    const s = function (a) { return sin[(((a * 162.9746617) | 0) % 1024 + 1024) % 1024]; };
    let o = 0;
    for (let y = 0; y < h; y++) {
      const b = s(y * k[1] - t * 0.7 + ph[1]);
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const v = s(x * k[0] + t + ph[0]) + b + s((x + y) * k[2] + t * 0.4 + ph[2])
          + s(Math.sqrt(dx * dx + dy * dy) * k[3] - t + ph[3]);
        const i = ((v + 4) * 31.875) | 0;
        d[o] = lut[i * 3];
        d[o + 1] = lut[i * 3 + 1];
        d[o + 2] = lut[i * 3 + 2];
        d[o + 3] = 255;
        o += 4;
      }
    }
    ctx.putImageData(state.img, 0, 0);
  },
};

// ── lava ─────────────────────────────────────────────────────────────────────────────────────

/** @type {Renderer} */
const lava = {
  scale: 6,
  setup(w, h, palette, rng) {
    const blobs = [];
    const n = 5 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      blobs.push({
        x: 0.15 + rng() * 0.7, r: 0.09 + rng() * 0.08,
        period: 24 + rng() * 24, phase: rng() * TAU, sway: 0.03 + rng() * 0.04, swayPeriod: 9 + rng() * 9,
      });
    }
    return { blobs, img: null };
  },
  frame(ctx, state, t, w, h, palette) {
    // Metaballs: the field of every blob summed per pixel and thresholded, so two that touch
    // fuse the way wax does; a rim in the third hue where the field is thin, and a blob
    // stretched along its travel. At a sixth of the size this is a few tens of thousands of
    // pixels, and the upscale is the softness.
    if (!state.img || state.img.width !== w || state.img.height !== h) state.img = ctx.createImageData(w, h);
    const d = state.img.data;
    const m = Math.min(w, h);
    const live = [];
    for (const b of state.blobs) {
      const ang = (TAU * t) / b.period + b.phase;
      const y = 0.5 + 0.38 * Math.sin(ang);
      const vy = Math.cos(ang);
      const x = b.x + b.sway * Math.sin((TAU * t) / b.swayPeriod + b.phase);
      const r = m * b.r * (0.85 + 0.15 * Math.sin(ang * 1.7));
      live.push({ cx: x * w, cy: y * h, r2: r * r, sy: 1 / (1 + 0.35 * Math.abs(vy)) });
    }
    const core = palette.accent;
    const rim = palette.spectrum3;
    let o = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let f = 0;
        for (const b of live) {
          const dx = x - b.cx;
          const dy = (y - b.cy) * b.sy;
          f += b.r2 / (dx * dx + dy * dy + 1);
        }
        if (f < 0.75) { d[o + 3] = 0; o += 4; continue; }
        // The edge softens over the last quarter below the threshold; the rim gives way to the
        // core as the field thickens.
        const edge = f >= 1 ? 1 : (f - 0.75) * 4;
        const mix = f >= 1.8 ? 1 : f <= 1 ? 0 : (f - 1) * 1.25;
        d[o] = rim[0] + (core[0] - rim[0]) * mix;
        d[o + 1] = rim[1] + (core[1] - rim[1]) * mix;
        d[o + 2] = rim[2] + (core[2] - rim[2]) * mix;
        d[o + 3] = 255 * edge;
        o += 4;
      }
    }
    ctx.putImageData(state.img, 0, 0);
  },
};

// ── tunnel ───────────────────────────────────────────────────────────────────────────────────

/** @type {Renderer} */
const tunnel = {
  scale: 1,
  setup() {
    return { rings: 24, spokes: 12, period: 2.4 };
  },
  frame(ctx, state, t, w, h, palette) {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const reach = Math.hypot(w, h) / 2;
    ctx.lineWidth = 1;
    // The rings rush outward: depth runs from the far point to the viewer and the radius grows
    // as a perspective projection of it, so the far rings crowd and the near ones fly.
    const frac = (t / state.period) % 1;
    for (let i = 0; i < state.rings; i++) {
      const depth = (i + 1 - frac) / state.rings;
      const r = reach * Math.pow(1 - depth, 2.2);
      if (r < 1) continue;
      const a = PEAK.tunnel * Math.pow(1 - depth, 1.2);
      ctx.strokeStyle = rgba(palette.accent, a);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
    }
    // The spokes turn at a fraction of the ring speed, which is what gives the tunnel its twist.
    const rot = t * 0.12;
    for (let i = 0; i < state.spokes; i++) {
      const ang = rot + (i / state.spokes) * TAU;
      const ex = cx + Math.cos(ang) * reach;
      const ey = cy + Math.sin(ang) * reach;
      const g = ctx.createLinearGradient(cx, cy, ex, ey);
      g.addColorStop(0, rgba(palette.spectrum2, 0));
      g.addColorStop(1, rgba(palette.spectrum2, PEAK.tunnel * 0.6));
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
  },
};

/** The canvas renderers by preset id. */
export const RENDERERS = { waves, dust, grid, static: staticNoise, ink, plasma, lava, tunnel };
