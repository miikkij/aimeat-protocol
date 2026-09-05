/**
 * @file atelier/ambient-post.js
 * @description THE POST PASSES — the second pass the ambient layer may run over its own field
 *   (wish-atelier-post-process-effects). A pass reads the frame the renderer (or the previous
 *   pass) drew and writes a transformed copy: the kaleidoscope folds it into mirrored wedges,
 *   the ripple shears it in slow horizontal waves, vhs splits its colour fringes and rolls a
 *   tracking band through it, glitch tears it in bursts. Living motion is legal here because
 *   the layer already moves: its gates (hidden tab, off-screen, Less motion, reduced motion,
 *   the weather) stop a pass exactly as they stop the field.
 *
 *   ONE BUDGET. A pass runs at the renderer's resolution (an eighth for plasma, full size for
 *   the grid) before the core's single upscale, so a post costs one more read of a frame the
 *   loop was already drawing. Two passes chain at most (POST_MAX, pinned to the registry): a
 *   third costs a third read and buys nothing a second did not. The wave's shader stands down
 *   while a pass is active (ambient.js tryGl), because a pass reads a 2D canvas.
 *
 *   NO COLOUR IS WRITTEN HERE. The fringes and the noise take their bytes from the palette the
 *   core sampled off the --ak-* tokens, and the parameters are the registry's, clamped by
 *   effects.js (one clamp, two consumers). The seeded generator the core hands setup() makes
 *   the still frame the same picture on every mount, which the Design Book's bench photographs.
 * @structure POST_IDS · POST_MAX · postById() · drawSplit()
 * @usage  import { POST_IDS, POST_MAX, postById } from './ambient-post.js';
 * @version-history
 *   v0.48.0 — 2026-09-05 — Initial (wish-atelier-post-process-effects, stage 3).
 */
import { rgba } from './ambient-presets.js';

const TAU = Math.PI * 2;

/** The effects that exist as a pass on the layer, in the registry's order. */
export const POST_IDS = ['glitch', 'vhs', 'ripple', 'kaleidoscope'];
/** How many passes chain at most (the registry's POST_MAX). */
export const POST_MAX = 2;

/**
 * @typedef {{ dark: boolean, bg: number[], ink: number[], accent: number[],
 *   spectrum2: number[], spectrum3: number[] }} Palette
 */
/**
 * @typedef {object} PostPass
 * @property {(w: number, h: number, rng: () => number, params: Record<string, number>, palette: Palette, scale: number) => any} setup
 *   once per size and per palette, at the pass's own resolution; `scale` says how many CSS
 *   pixels one of these pixels covers, so a length in the registry (a wavelength) lands right
 * @property {(dst: CanvasRenderingContext2D, src: HTMLCanvasElement, state: any, t: number, w: number, h: number, palette: Palette, params: Record<string, number>) => void} pass
 *   read `src`, write `dst` (the same size), t in seconds
 */

/** @param {number} w @param {number} h */
function scratchCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * The colour fringes: the frame's silhouette in two of the look's hues, offset either way and
 * added over the frame — a split of the channels in the palette's own colours rather than in
 * red and blue, so it re-skins with the look.
 * @param {CanvasRenderingContext2D} dst
 * @param {HTMLCanvasElement} src
 * @param {HTMLCanvasElement} scratch  a canvas the size of src
 * @param {number} w @param {number} h
 * @param {number} dx  the offset in pixels
 * @param {Palette} palette
 * @param {number} alpha  how strongly the fringes add
 */
export function drawSplit(dst, src, scratch, w, h, dx, palette, alpha) {
  const sc = scratch.getContext('2d');
  if (!sc) return;
  /** @type {Array<[number[], number]>} */
  const tints = [[palette.accent, -dx], [palette.spectrum2, dx]];
  for (const pair of tints) {
    sc.globalCompositeOperation = 'source-over';
    sc.clearRect(0, 0, w, h);
    sc.drawImage(src, pair[1], 0);
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = rgba(pair[0], 1);
    sc.fillRect(0, 0, w, h);
    dst.globalCompositeOperation = 'lighter';
    dst.globalAlpha = alpha;
    dst.drawImage(scratch, 0, 0);
  }
  dst.globalCompositeOperation = 'source-over';
  dst.globalAlpha = 1;
}

// ── kaleidoscope ─────────────────────────────────────────────────────────────────────────────

/** @type {PostPass} */
const kaleidoscope = {
  setup() { return {}; },
  pass(dst, src, state, t, w, h, palette, p) {
    const n = Math.max(2, Math.round(p.segments));
    const cx = w / 2;
    const cy = h / 2;
    const reach = Math.hypot(w, h) / 2 + 2;
    const wedge = TAU / n;
    const rot = t * p.spin * 0.5;
    // A hair of overlap between wedges hides the seam the clip would otherwise leave.
    const eps = 0.012;
    dst.clearRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const a0 = rot + i * wedge;
      dst.save();
      dst.beginPath();
      dst.moveTo(cx, cy);
      dst.arc(cx, cy, reach, a0 - eps, a0 + wedge + eps);
      dst.closePath();
      dst.clip();
      // Every wedge shows the SAME sector of the source (the one from the centre out to the
      // right), turned into its slot and mirrored every other time: that is what makes any
      // drift in the field bloom symmetrically.
      dst.translate(cx, cy);
      dst.rotate(a0);
      if (i % 2) { dst.rotate(wedge / 2); dst.scale(1, -1); dst.rotate(-wedge / 2); }
      dst.translate(-cx, -cy);
      dst.drawImage(src, 0, 0, w, h);
      dst.restore();
    }
  },
};

// ── ripple ───────────────────────────────────────────────────────────────────────────────────

/** @type {PostPass} */
const ripple = {
  setup(w, h, rng, p, palette, scale) {
    // The wavelength is a length on the page; at a scaled resolution it covers fewer rows.
    const rows = Math.max(4, p.wavelength / Math.max(scale, 1));
    return { band: 3, k: TAU / rows };
  },
  pass(dst, src, state, t, w, h, palette, p) {
    const band = state.band;
    const amp = p.amplitude * Math.min(w, h) * 0.045;
    const om = p.speed * 1.4;
    dst.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y += band) {
      const bh = Math.min(band, h - y);
      const dx = Math.round(amp * Math.sin(state.k * y + t * om));
      dst.drawImage(src, 0, y, w, bh, dx, y, w, bh);
      // The strip slid off one edge; the sliver it left is filled from the other edge, so the
      // picture wraps instead of showing the page through a gap.
      if (dx > 0) dst.drawImage(src, w - dx, y, dx, bh, 0, y, dx, bh);
      else if (dx < 0) dst.drawImage(src, 0, y, -dx, bh, w + dx, y, -dx, bh);
    }
  },
};

// ── vhs ──────────────────────────────────────────────────────────────────────────────────────

/** @type {PostPass} */
const vhs = {
  setup(w, h, rng, p, palette) {
    // One noise tile of ink at random alpha, generated once; a frame draws it as a pattern at
    // a random offset, never a per-pixel loop.
    const tile = scratchCanvas(64, 64);
    const tc = tile.getContext('2d');
    if (tc) {
      const img = tc.createImageData(64, 64);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = palette.ink[0];
        d[i + 1] = palette.ink[1];
        d[i + 2] = palette.ink[2];
        d[i + 3] = Math.floor(rng() * 255);
      }
      tc.putImageData(img, 0, 0);
    }
    return { scratch: scratchCanvas(w, h), tile, pattern: null, rng };
  },
  pass(dst, src, state, t, w, h, palette, p) {
    const s = p.strength;
    const unit = Math.max(1, w / 640);
    dst.clearRect(0, 0, w, h);
    // The shiver: now and then the whole frame drops a pixel or two and comes back.
    const jitter = Math.sin(t * 9.7) > 0.96 ? Math.round(2 * s * unit) : 0;
    dst.drawImage(src, 0, jitter);
    drawSplit(dst, src, state.scratch, w, h, Math.max(1, Math.round((1 + 6 * s) * unit)), palette, 0.08 + 0.28 * s);
    // The tracking band rolls up the picture over a few seconds, its slice shifted sideways
    // and darkened the way a worn tape reads.
    const bandH = Math.max(2, Math.round(h * (0.05 + 0.1 * s)));
    const y = h - ((t * 0.25 * h) % (h + bandH));
    dst.save();
    dst.beginPath();
    dst.rect(0, y, w, bandH);
    dst.clip();
    dst.clearRect(0, y, w, bandH);
    dst.drawImage(src, Math.round(8 * s * unit), 0);
    dst.fillStyle = rgba(palette.ink, 0.18 * s);
    dst.fillRect(0, y, w, bandH);
    dst.restore();
    if (!state.pattern) state.pattern = dst.createPattern(state.tile, 'repeat');
    dst.save();
    dst.globalAlpha = 0.05 + 0.1 * s;
    dst.translate(-Math.floor(state.rng() * 64), -Math.floor(state.rng() * 64));
    dst.fillStyle = state.pattern;
    dst.fillRect(0, 0, w + 64, h + 64);
    dst.restore();
  },
};

// ── glitch ───────────────────────────────────────────────────────────────────────────────────

/** @type {PostPass} */
const glitch = {
  setup(w, h, rng) {
    return { scratch: scratchCanvas(w, h), rng, burst: 0, slices: [] };
  },
  pass(dst, src, state, t, w, h, palette, p) {
    const s = p.strength;
    const rng = state.rng;
    dst.clearRect(0, 0, w, h);
    // A burst begins by chance (more often the stronger the effect), lasts a handful of frames
    // and tears the frame into three to seven slices thrown sideways, with the channels split.
    if (state.burst <= 0 && rng() < 0.01 + 0.03 * s) {
      state.burst = 3 + Math.floor(rng() * 6);
      const n = 3 + Math.floor(rng() * 5);
      state.slices = [];
      for (let i = 0; i < n; i++) {
        state.slices.push({ y: rng(), hgt: 0.02 + rng() * 0.12, dx: (rng() - 0.5) * 0.16 * s });
      }
    }
    dst.drawImage(src, 0, 0);
    if (state.burst <= 0) return;
    state.burst--;
    for (const sl of state.slices) {
      const y = Math.round(sl.y * h);
      const hh = Math.max(1, Math.round(sl.hgt * h));
      const dx = Math.round(sl.dx * w);
      dst.clearRect(0, y, w, hh);
      dst.drawImage(src, 0, y, w, hh, dx, y, w, hh);
    }
    drawSplit(dst, src, state.scratch, w, h, Math.max(1, Math.round(10 * s * Math.max(1, w / 640))), palette, 0.35 * s);
  },
};

const PASSES = { glitch, vhs, ripple, kaleidoscope };

/**
 * The pass for an id, or null.
 * @param {string} id
 * @returns {PostPass|null}
 */
export function postById(id) {
  return PASSES[id] || null;
}
