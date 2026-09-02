/**
 * @file phaser/parallax.js
 * @description A multi-layer scrolling backdrop drawn on the theme's colours, so a game has a
 *   world behind it with zero art: a sky, stars, clouds, mountains, hills, a tree line, a city,
 *   the sea, fog and a near strip, each generated from a seed and repeated across any world width.
 *   Seven presets make the common case one word; a custom stack is a list of layers.
 *
 *   THE SPRITE IS FIXED TO THE CAMERA AND THE TEXTURE DOES THE MOVING. Phaser's own scrollFactor
 *   on a viewport-wide sprite uncovers the screen the moment the camera moves (at factor 0.3 the
 *   sprite has left 300 px of the right edge bare after 1000 px of scroll), so every layer here is
 *   a TileSprite at scroll factor 0, the width of the viewport, and each frame its tilePositionX
 *   is set to the camera's scrollX times the layer's own factor, plus its drift. A world can be
 *   any width and no layer is ever wider than the screen. Vertical factors move the sprite itself.
 *
 *   TEXTURES ARE POWER-OF-TWO BY NECESSITY. The 4.2.1 WebGL renderer gives a texture the REPEAT
 *   wrap only when both sides are powers of two (the canvas renderer uses createPattern and does
 *   not care), so a period is rounded up to the next power of two and a band's texture is taller
 *   than the band, painted solid below the silhouette. Wide viewports are drawn at a reduced
 *   resolution and scaled back with tileScale, so a 1080p stack does not cost sixty megabytes.
 *
 *   LESS MOTION LEAVES THE PICTURE. Drift, the sea's bob and the stars' twinkle stop; the parallax
 *   itself is the camera moving, which the game already does, and stays.
 *
 *   NO COLOUR IS WRITTEN HERE. A layer's tone is a theme word or a number; the time of day moves
 *   it toward the darker of the page's two tones, or toward the warm token, and the haze mixes in
 *   the sky's own horizon, so the whole stack re-tones with the palette and the mode.
 * @structure PRESETS · normalise(spec) · poles / tone / palette / coloursFor · parallax(scene,
 *   spec) → handle (layers, layer, set, update, resize, destroy); painters in ./parallax-layers.js
 * @usage
 *   const bg = AIMEAT.phaser.parallax(this, 'hills');                  // drift runs on its own
 *   const bg = AIMEAT.phaser.parallax(this, { preset: 'city', time: 'night', seed: 7 });
 *   bg.set({ time: 'dusk' });   bg.layer('clouds').set({ drift: 20 });   bg.destroy();
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: ten generated layer kinds, seven presets, time of day, drift,
 *     twinkle, resize, and the camera-bound tile loop.
 */
import { reducedMotion } from '../atelier/dom.js';
import { look } from './tokens.js';
import { paint, rng, mix, shade, luminance, pot, KIND_DEFAULTS } from './parallax-layers.js';

/** Below every gameplay object: layer i of a stack sits at this plus i. */
const BASE_DEPTH = -100;

/** A period is never drawn wider than this, and a viewport wider than DRAW_WIDTH is drawn at
 *  DRAW_WIDTH / width of its size and scaled back up. Both keep a stack's canvases in memory a
 *  phone has. */
const MAX_PERIOD = 2048;
const DRAW_WIDTH = 1536;

/** The three times of day a stack can wear. */
const TIMES = { day: true, dusk: true, night: true };

/** How far the sea's band rises and falls, in display pixels, when it is allowed to move. */
const SEA_BOB = 3;

/** One handle, one id, so the texture keys of two backdrops in one game never meet. */
let nextId = 1;

/** The stack most presets are variations of. */
const HILLS = [
  { kind: 'sky' },
  { kind: 'stars' },
  { kind: 'clouds' },
  { kind: 'mountains' },
  { kind: 'hills', name: 'hills-far', scroll: 0.28, height: 0.4, haze: 0.45 },
  { kind: 'hills', scroll: 0.5, height: 0.28, haze: 0.18 },
  { kind: 'ground' },
];

/**
 * The stack each preset name stands for. A preset may carry the time of day it is best at; a
 * spec's own time wins over it.
 * @type {Record<string, { time?: 'day'|'dusk'|'night', layers: any[] }>}
 */
const PRESETS = {
  hills: { layers: HILLS },
  night: { time: 'night', layers: HILLS },
  city: {
    layers: [
      { kind: 'sky' },
      { kind: 'stars' },
      { kind: 'clouds', alpha: 0.6, height: 0.4 },
      { kind: 'city', name: 'city-far', scroll: 0.15, height: 0.62, haze: 0.55, windows: false },
      { kind: 'city', scroll: 0.35, height: 0.44, tone: 'ink', haze: 0.22 },
      { kind: 'fog', alpha: 0.4 },
      { kind: 'ground', tone: 'ink' },
    ],
  },
  sea: {
    layers: [
      { kind: 'sky' },
      { kind: 'stars' },
      { kind: 'clouds' },
      { kind: 'mountains', scroll: 0.15, height: 0.34, haze: 0.6 },
      { kind: 'sea', name: 'sea-far', scroll: 0.3, height: 0.3, haze: 0.35, drift: 8 },
      { kind: 'sea', scroll: 0.5, height: 0.2, haze: 0.08, drift: 18 },
      { kind: 'ground', name: 'shore', tone: 'warn', height: 0.09 },
    ],
  },
  forest: {
    layers: [
      { kind: 'sky' },
      { kind: 'stars' },
      { kind: 'clouds' },
      { kind: 'mountains' },
      { kind: 'hills', scroll: 0.3, height: 0.42, haze: 0.45 },
      { kind: 'forest', name: 'forest-far', scroll: 0.42, height: 0.38, haze: 0.38 },
      { kind: 'forest', scroll: 0.65, height: 0.3, haze: 0.1 },
      { kind: 'fog', scroll: 0.72, alpha: 0.35 },
      { kind: 'ground' },
    ],
  },
  desert: {
    layers: [
      { kind: 'sky', tone: 'warn' },
      { kind: 'stars' },
      { kind: 'mountains', tone: 'warn', haze: 0.5, jag: 0.8 },
      { kind: 'hills', name: 'dunes-far', tone: 'warn', scroll: 0.35, height: 0.32, haze: 0.35 },
      { kind: 'hills', name: 'dunes', tone: 'warn', scroll: 0.55, height: 0.22, haze: 0.1 },
      { kind: 'ground', tone: 'warn' },
    ],
  },
  cave: {
    layers: [
      { kind: 'sky', top: 'dark', bottom: 'inkDim', disc: false },
      { kind: 'mountains', name: 'ceiling', tone: 'dark', flip: true, scroll: 0.2, height: 0.38, haze: 0.35 },
      { kind: 'mountains', name: 'rocks-far', tone: 'dark', scroll: 0.25, height: 0.42, haze: 0.5 },
      { kind: 'hills', name: 'rubble', tone: 'dark', scroll: 0.5, height: 0.24, haze: 0.18 },
      { kind: 'fog', tone: 'inkDim', alpha: 0.3 },
      { kind: 'ground', tone: 'dark' },
    ],
  },
};

/** The preset names, for the warning and for a picker. */
export const PARALLAX_PRESETS = Object.keys(PRESETS);

/**
 * @typedef {object} ParallaxLayerSpec
 * @property {'sky'|'stars'|'clouds'|'mountains'|'hills'|'forest'|'city'|'sea'|'fog'|'ground'} kind
 * @property {string} [name]     how layer(name) finds it. Default: the kind, '-2' and up for a repeat.
 * @property {number|{ x: number, y?: number }} [scroll]  how much of the camera's movement the
 *   layer follows: 0 is fixed to the screen, 1 moves with the world. y defaults to 0 and is best
 *   kept small, because a band that rises shows the sky beneath it.
 * @property {number} [depth]    Default: -100 plus the layer's place in the stack.
 * @property {string|number} [tone]  a theme word (bg, surface, ink, inkDim, accent, ok, warn, err,
 *   line, ch1..ch4, or light / dark for the paler and darker of the page's two tones) or a number.
 * @property {number} [alpha]
 * @property {number} [height]   the band's share of the viewport's height, 0..1.
 * @property {number} [haze]     how much of the sky's horizon is mixed into the tone, 0..1: far
 *   layers take more. Each kind has its own default.
 * @property {number} [seed]     shapes are deterministic in it. Default: from the stack's seed and
 *   the layer's name.
 * @property {number} [drift]    the layer's own motion in pixels per second, positive to the
 *   right. Clouds, the sea and fog drift by default; anything else may be told to.
 * @property {boolean} [flip]    hang the silhouette from the top instead (a cave ceiling).
 * @property {'sun'|'moon'|'auto'|false} [disc]  sky only. Default 'auto': the time decides.
 * @property {number} [discX]    sky only, the disc's place as a share of the viewport. Default 0.74.
 * @property {number} [discY]    Default 0.2.
 * @property {string|number} [top]     sky only: a fixed top tone instead of the time's own.
 * @property {string|number} [bottom]  sky only: a fixed horizon tone.
 * @property {boolean} [always]  stars only: shown by day too. Default: hidden by day, half at dusk.
 * @property {number} [density]  stars and clouds: a multiplier on how many. Default 1.
 * @property {boolean} [windows] city only: false draws no lit windows.
 * @property {number} [jag]      mountains only: peaks per width, as a multiplier. Default 1.
 * @property {number} [bob]      sea only: how far the band rises and falls, in pixels. Default 3.
 */

/**
 * @typedef {object} ParallaxSpec
 * @property {string} [preset]   hills (default), night, city, sea, forest, desert or cave.
 * @property {ParallaxLayerSpec[]} [layers]  a custom stack, back to front; replaces the preset.
 * @property {'day'|'dusk'|'night'} [time]   tints the whole stack. Default: the preset's, else day.
 * @property {number} [seed]     every layer's shapes follow from it. Default 1.
 * @property {number} [drift]    a multiplier on every layer's drift; 0 holds them all still.
 * @property {boolean} [twinkle] the stars breathe. Default true; off under less motion anyway.
 * @property {boolean} [auto]    Default true: bound to the scene's postupdate and the scale's
 *   resize, so nothing needs calling. false leaves update() and resize() to the caller.
 * @property {number} [depth]    the depth of the first layer. Default -100.
 * @property {number} [width]    the viewport to fit, when the camera's own size is not it.
 * @property {number} [height]
 * @property {any} [theme]       a theme handle. Default: read off the element the game booted into.
 */

/**
 * @typedef {object} ParallaxLayerHandle
 * @property {string} name
 * @property {string} kind
 * @property {any} spec           the layer as built, every default filled in (read it, do not edit it)
 * @property {any[]} sprites      the TileSprite, or two of them for a twinkling star field
 * @property {(patch: Partial<ParallaxLayerSpec>) => void} set   change this layer and redraw
 * @property {(alpha: number) => void} setAlpha
 * @property {(visible: boolean) => void} setVisible
 */

/**
 * @typedef {object} ParallaxHandle
 * @property {ParallaxLayerHandle[]} layers   back to front
 * @property {(name: string) => ParallaxLayerHandle|null} layer
 * @property {(patch: Partial<ParallaxSpec> & { layers?: ParallaxLayerSpec[]|Record<string,
 *   Partial<ParallaxLayerSpec>|false> }) => void} set   change the time, the drift, the seed, a
 *   preset, the whole stack (an array) or named layers (an object; false removes one), and redraw
 * @property {() => void} update    place every layer for this frame. Called for you when auto.
 * @property {(w?: number, h?: number) => void} resize   the viewport changed; refit. With no
 *   arguments the camera is measured again.
 * @property {() => void} destroy   every sprite and every generated texture, gone
 */

/**
 * A number the layer's name and the stack's seed agree on, so a layer keeps its shapes when a
 * neighbour is added or removed.
 * @param {number} base
 * @param {string} name
 * @param {number|undefined} own
 * @returns {number}
 */
function seedOf(base, name, own) {
  if (typeof own === 'number' && isFinite(own)) return own;
  let h = (Math.floor(base) >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * One layer with every default filled in. The kind's defaults come first, the layer's own
 * words over them; a repeated name gets a counter so layer(name) stays unambiguous.
 * @param {any} raw
 * @param {number} index
 * @param {Record<string, boolean>} names
 * @param {number} depthBase
 * @returns {any|null}
 */
function normaliseLayer(raw, index, names, depthBase) {
  const d = raw && KIND_DEFAULTS[raw.kind];
  if (!d) {
    console.warn('[aimeat-phaser] parallax: a layer of kind "' + (raw && raw.kind) + '" is not one of '
      + Object.keys(KIND_DEFAULTS).join(', ') + ' and was left out.');
    return null;
  }
  let name = raw.name || raw.kind;
  if (names[name]) {
    let n = 2;
    while (names[name + '-' + n]) n += 1;
    name = name + '-' + n;
  }
  names[name] = true;
  const scroll = typeof raw.scroll === 'number'
    ? { x: raw.scroll, y: 0 }
    : Object.assign({ x: d.scroll, y: 0 }, raw.scroll || {});
  return Object.assign({}, raw, {
    name: name,
    kind: raw.kind,
    scroll: scroll,
    height: typeof raw.height === 'number' ? raw.height : d.height,
    tone: raw.tone != null ? raw.tone : d.tone,
    alpha: typeof raw.alpha === 'number' ? raw.alpha : d.alpha,
    drift: typeof raw.drift === 'number' ? raw.drift : d.drift,
    haze: typeof raw.haze === 'number' ? raw.haze : d.haze,
    depth: typeof raw.depth === 'number' ? raw.depth : depthBase + index,
  });
}

/**
 * A spec, whatever shape it arrived in, as the stack that will be built.
 * @param {string|ParallaxSpec|undefined} spec
 * @returns {{ time: string, layers: any[], seed: number, drift: number, twinkle: boolean,
 *   auto: boolean, depth: number, width: number|undefined, height: number|undefined, theme: any }}
 */
function normalise(spec) {
  const s = /** @type {any} */ (typeof spec === 'string' ? { preset: spec } : (spec || {}));
  let preset = null;
  if (s.preset) {
    preset = PRESETS[s.preset] || null;
    if (!preset) {
      console.warn('[aimeat-phaser] parallax: no preset is named "' + s.preset + '". The presets are '
        + PARALLAX_PRESETS.join(', ') + '; hills is used.');
    }
  }
  if (!preset && !Array.isArray(s.layers)) preset = PRESETS.hills;
  const source = Array.isArray(s.layers) ? s.layers : preset.layers;
  const depthBase = typeof s.depth === 'number' ? s.depth : BASE_DEPTH;
  /** @type {Record<string, boolean>} */
  const names = {};
  /** @type {any[]} */
  const layers = [];
  for (let i = 0; i < source.length; i++) {
    const layer = normaliseLayer(source[i], layers.length, names, depthBase);
    if (layer) layers.push(layer);
  }
  return {
    time: TIMES[s.time] ? s.time : ((preset && preset.time) || 'day'),
    layers: layers,
    seed: typeof s.seed === 'number' ? s.seed : 1,
    drift: typeof s.drift === 'number' ? s.drift : 1,
    twinkle: s.twinkle !== false,
    auto: s.auto !== false,
    depth: depthBase,
    width: typeof s.width === 'number' ? s.width : undefined,
    height: typeof s.height === 'number' ? s.height : undefined,
    theme: s.theme,
  };
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   The colours
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The page's two poles, whichever mode it is in: "dark" is the darker of bg and ink.
 * @param {any} th
 * @returns {{ light: number, dark: number }}
 */
function poles(th) {
  const bgIsLight = luminance(th.bg) >= luminance(th.ink);
  return { light: bgIsLight ? th.bg : th.ink, dark: bgIsLight ? th.ink : th.bg };
}

/**
 * A theme word, a pole word or a number, as a colour.
 * @param {any} th
 * @param {{ light: number, dark: number }} p
 * @param {any} want
 * @param {number} fallback
 * @returns {number}
 */
function tone(th, p, want, fallback) {
  if (typeof want === 'number' && isFinite(want)) return want;
  if (want === 'light') return p.light;
  if (want === 'dark') return p.dark;
  if (typeof want === 'string' && typeof th[want] === 'number') return th[want];
  return fallback;
}

/**
 * What the time of day does to the stack: the sky's two tones, the tint every layer takes, the
 * disc, how bright the stars are and how the city's windows look.
 * @param {any} th
 * @param {{ light: number, dark: number }} p
 * @param {string} time
 * @param {any} skyLayer  the stack's sky layer, whose tone is what the sky leans to
 * @returns {{ top: number, bottom: number, tint: (c: number) => number, disc: 'sun'|'moon',
 *   sun: number, moon: number, starAlpha: number,
 *   window: { tone: number, alpha: number, share: number } }}
 */
function palette(th, p, time, skyLayer) {
  const lean = tone(th, p, skyLayer ? skyLayer.tone : 'ch1', th.ch1);
  const lit = shade(th.warn, 0.4);
  /** @type {any} */
  let out;
  if (time === 'night') {
    out = {
      top: mix(p.dark, lean, 0.06),
      bottom: mix(p.dark, lean, 0.2),
      tint: function (c) { return mix(c, p.dark, 0.62); },
      disc: 'moon',
      starAlpha: 1,
      window: { tone: lit, alpha: 0.95, share: 0.6 },
    };
  } else if (time === 'dusk') {
    const warm = mix(p.dark, th.warn, 0.3);
    out = {
      top: mix(mix(th.bg, p.dark, 0.45), lean, 0.2),
      bottom: mix(mix(th.bg, p.dark, 0.2), th.warn, 0.5),
      tint: function (c) { return mix(c, warm, 0.42); },
      disc: 'sun',
      starAlpha: 0.5,
      window: { tone: lit, alpha: 0.8, share: 0.5 },
    };
  } else {
    out = {
      top: mix(th.bg, lean, 0.45),
      bottom: mix(th.bg, lean, 0.12),
      tint: function (c) { return c; },
      disc: 'sun',
      starAlpha: 0,
      window: { tone: mix(p.light, lean, 0.2), alpha: 0.35, share: 0.45 },
    };
  }
  if (skyLayer && skyLayer.top != null) out.top = out.tint(tone(th, p, skyLayer.top, out.top));
  if (skyLayer && skyLayer.bottom != null) out.bottom = out.tint(tone(th, p, skyLayer.bottom, out.bottom));
  out.sun = time === 'dusk' ? mix(th.ch3, th.warn, 0.5) : mix(th.ch3, p.light, 0.25);
  out.moon = mix(p.light, lean, 0.12);
  return out;
}

/**
 * One layer's colours: its tone tinted for the time and hazed toward the horizon, with a lit
 * face, a shadowed face and a further-back version for the painters that draw two rows.
 * Stars are not tinted: a star field pulled toward dark at night would vanish.
 * @param {any} th
 * @param {{ light: number, dark: number }} p
 * @param {any} pal
 * @param {any} layer
 * @returns {import('./parallax-layers.js').LayerColours}
 */
function coloursFor(th, p, pal, layer) {
  const base = tone(th, p, layer.tone, th.inkDim);
  const tinted = layer.kind === 'stars' ? base : pal.tint(base);
  const colour = mix(tinted, pal.bottom, layer.haze);
  return {
    tone: colour,
    lit: shade(colour, 0.22),
    dim: shade(colour, -0.25),
    back: mix(colour, pal.bottom, 0.45),
    skyTop: pal.top,
    skyBottom: pal.bottom,
    disc: pal.disc,
    sun: pal.sun,
    moon: pal.moon,
    window: pal.window,
  };
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   The handle
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * A backdrop for one scene.
 * @param {any} scene
 * @param {string|ParallaxSpec} [spec]  a preset name, or a spec
 * @returns {ParallaxHandle}
 */
export function parallax(scene, spec) {
  const id = nextId++;
  /** The spec as last asked for, in raw form; set() merges into it and normalises again. */
  let raw = /** @type {any} */ (typeof spec === 'string' ? { preset: spec } : Object.assign({}, spec || {}));
  let stack = normalise(raw);
  const th = stack.theme || look(scene);
  const auto = stack.auto;
  /** @type {{ w: number, h: number }|null} an explicit viewport from resize(w, h) */
  let override = stack.width && stack.height ? { w: stack.width, h: stack.height } : null;

  /** @type {any[]} the built layers: spec, sprites, and what the loop needs per frame */
  let built = [];
  /** @type {string[]} texture keys this handle made and must remove */
  let textures = [];
  /** @type {ParallaxLayerHandle[]} */
  let handles = [];
  let generation = 0;
  let gone = false;
  /** Seconds of self-motion so far. It stops advancing under less motion and survives a rebuild,
   *  so a time-of-day change does not make the clouds jump. */
  let driftT = 0;
  /** @type {number|null} */
  let last = null;

  /** @returns {number} milliseconds, on the scene's clock when it has one */
  function clock() {
    if (scene.time && typeof scene.time.now === 'number') return scene.time.now;
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  /** @returns {{ w: number, h: number }} the viewport to fit */
  function viewport() {
    if (override) return override;
    const cam = scene.cameras && scene.cameras.main;
    const w = (scene.scale && scene.scale.width) || (cam && cam.width) || 960;
    const h = (scene.scale && scene.scale.height) || (cam && cam.height) || 540;
    return { w: w, h: h };
  }

  /** Every sprite and every texture this handle made, gone. */
  function teardown() {
    for (const L of built) {
      for (const sp of L.sprites) if (sp && typeof sp.destroy === 'function') sp.destroy();
    }
    built = [];
    handles = [];
    for (const key of textures) {
      if (scene.textures && scene.textures.exists(key)) scene.textures.remove(key);
    }
    textures = [];
  }

  /**
   * Draw one period of a layer into a new canvas texture.
   * @param {any} L
   * @param {number} subset  -1 for all stars, 0 or 1 for a twinkle half
   * @param {any} box
   * @param {any} colours
   * @returns {string|null} the texture key
   */
  function makeTexture(L, subset, box, colours) {
    const key = 'ak-parallax-' + id + '-' + generation + '-' + L.name + (subset > 0 ? '-b' : '');
    const tex = scene.textures.createCanvas(key, box.w, box.h);
    if (!tex) return null;
    const ctx = typeof tex.getContext === 'function' ? tex.getContext() : tex.context;
    if (L.flip) {
      ctx.save();
      ctx.translate(0, box.h);
      ctx.scale(1, -1);
    }
    paint(L.kind, ctx, box, Object.assign({}, L, { subset: subset }), colours, rng(seedOf(stack.seed, L.name, L.seed)));
    if (L.flip) ctx.restore();
    if (typeof tex.refresh === 'function') tex.refresh();
    textures.push(key);
    return key;
  }

  /** The whole stack, from the current spec and the current viewport. */
  function build() {
    teardown();
    generation += 1;
    const view = viewport();
    const vw = Math.max(16, view.w);
    const vh = Math.max(16, view.h);
    const res = Math.min(1, DRAW_WIDTH / vw);
    const texW = Math.min(MAX_PERIOD, pot(Math.ceil(vw * res)));
    const p = poles(th);
    const skyLayer = stack.layers.filter(function (L) { return L.kind === 'sky'; })[0] || null;
    const pal = palette(th, p, stack.time, skyLayer);

    for (const L of stack.layers) {
      const isSky = L.kind === 'sky';
      const bandD = isSky ? vh : Math.max(8, Math.round(vh * Math.max(0.02, Math.min(1, L.height))));
      const band = Math.max(4, Math.round(bandD * res));
      const texH = isSky ? pot(Math.ceil(vh * res)) : pot(band);
      const box = { w: texW, h: texH, band: band, viewW: Math.round(vw * res), viewH: Math.round(vh * res) };
      const colours = coloursFor(th, p, pal, L);
      const twinkle = L.kind === 'stars' && stack.twinkle;
      const starFactor = L.kind === 'stars' && !L.always ? pal.starAlpha : 1;
      const alpha = Math.max(0, Math.min(1, L.alpha * starFactor));
      const subsets = twinkle ? [0, 1] : [-1];
      /** @type {any[]} */
      const sprites = [];
      for (const subset of subsets) {
        const key = makeTexture(L, subset, box, colours);
        if (!key) continue;
        const sprite = scene.add.tileSprite(0, 0, vw, texH / res, key);
        sprite.setOrigin(0, 0).setScrollFactor(0).setDepth(L.depth).setAlpha(alpha);
        if (alpha === 0) sprite.setVisible(false);
        if (res !== 1 && typeof sprite.setTileScale === 'function') sprite.setTileScale(1 / res);
        sprites.push(sprite);
      }
      const texHD = texH / res;
      const record = {
        spec: L,
        sprites: sprites,
        anchorY: isSky ? 0 : (L.flip ? bandD - texHD : vh - texHD),
        res: res,
        fx: L.scroll.x,
        fy: L.scroll.y,
        drift: L.drift,
        alpha: alpha,
        twinkle: twinkle && alpha > 0,
        bob: L.kind === 'sea' ? (typeof L.bob === 'number' ? L.bob : SEA_BOB) : 0,
        phase: rng(seedOf(stack.seed, L.name + ':phase', undefined))() * Math.PI * 2,
      };
      built.push(record);
      handles.push(layerHandle(record));
    }
    place();
  }

  /**
   * The public face of one built layer.
   * @param {any} record
   * @returns {ParallaxLayerHandle}
   */
  function layerHandle(record) {
    const name = record.spec.name;
    return {
      name: name,
      kind: record.spec.kind,
      spec: record.spec,
      sprites: record.sprites,
      set(patch) {
        /** @type {any} */
        const layers = {};
        layers[name] = patch || {};
        api.set({ layers: layers });
      },
      setAlpha(alpha) {
        record.alpha = Math.max(0, Math.min(1, alpha));
        for (const sp of record.sprites) sp.setAlpha(record.alpha).setVisible(record.alpha > 0);
      },
      setVisible(visible) {
        for (const sp of record.sprites) sp.setVisible(!!visible);
      },
    };
  }

  /** Put every layer where this frame's camera and clock say. */
  function place() {
    const now = clock();
    const dt = last == null ? 0 : Math.max(0, (now - last) / 1000);
    last = now;
    const still = reducedMotion();
    if (!still) driftT += dt * stack.drift;
    const cam = scene.cameras && scene.cameras.main;
    const sx = cam ? cam.scrollX || 0 : 0;
    const sy = cam ? cam.scrollY || 0 : 0;
    for (const L of built) {
      const tx = (sx * L.fx - driftT * L.drift) * L.res;
      let y = L.anchorY - sy * L.fy;
      if (L.bob && !still) y += Math.sin(driftT * 1.2 + L.phase) * L.bob;
      for (let i = 0; i < L.sprites.length; i++) {
        const sp = L.sprites[i];
        sp.tilePositionX = tx;
        sp.y = y;
        if (L.twinkle) {
          sp.alpha = still ? L.alpha : L.alpha * (0.6 + 0.4 * Math.sin(driftT * 2.2 + L.phase + i * Math.PI));
        }
      }
    }
  }

  function tick() {
    if (gone) return;
    place();
  }

  function onResize() {
    if (gone) return;
    override = null;
    build();
  }

  /** @type {ParallaxHandle} */
  const api = {
    get layers() { return handles.slice(); },

    layer(name) {
      for (const h of handles) if (h.name === name) return h;
      return null;
    },

    set(patch) {
      if (gone) return;
      const q = /** @type {any} */ (patch || {});
      const next = Object.assign({}, raw);
      for (const key in q) if (key !== 'layers') next[key] = q[key];
      if (Array.isArray(q.layers)) {
        next.layers = q.layers;
      } else if (q.preset && q.preset !== raw.preset) {
        // A new preset starts from its own stack; layers patched under the old one do not carry.
        delete next.layers;
      }
      if (q.layers && typeof q.layers === 'object' && !Array.isArray(q.layers)) {
        // Named patches land on the stack as it will be built (a preset named in the same call
        // included), so a layer keeps its preset defaults and takes only the words in the patch.
        // false removes a layer.
        /** @type {any[]} */
        const merged = [];
        for (const L of normalise(next).layers) {
          const change = q.layers[L.name];
          if (change === false) continue;
          merged.push(change && typeof change === 'object' ? Object.assign({}, L, change) : L);
        }
        next.layers = merged;
      }
      raw = next;
      stack = normalise(raw);
      build();
    },

    update() {
      tick();
    },

    resize(w, h) {
      if (gone) return;
      override = typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 ? { w: w, h: h } : null;
      build();
    },

    destroy() {
      if (gone) return;
      gone = true;
      if (scene.events && typeof scene.events.off === 'function') {
        scene.events.off('postupdate', tick);
        scene.events.off('shutdown', api.destroy);
      }
      if (auto && scene.scale && typeof scene.scale.off === 'function') scene.scale.off('resize', onResize);
      teardown();
    },
  };

  build();

  // postupdate rather than update: the scene's own update has moved the player by then, and the
  // camera follow is applied at render, so this is the latest place before the frame is drawn.
  if (auto && scene.events && typeof scene.events.on === 'function') scene.events.on('postupdate', tick);
  if (auto && scene.scale && typeof scene.scale.on === 'function') scene.scale.on('resize', onResize);
  if (scene.events && typeof scene.events.once === 'function') scene.events.once('shutdown', api.destroy);

  return api;
}
