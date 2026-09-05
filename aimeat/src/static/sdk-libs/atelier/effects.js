/**
 * @file atelier/effects.js
 * @description THE EFFECTS ON CONTENT — post-process filters a block, a hero band or a picture
 *   may wear (wish-atelier-post-process-effects). The registry (src/data/atelier-effects.ts)
 *   declares each one; this module is its hands on the compositor: a class per effect on
 *   effects.css, the clamped parameters written as --ak-fx-<id>-<param> custom properties, and
 *   for the SVG engines a <filter> of the instance's own inside one hidden <svg id="ak-fx-defs">,
 *   its numbers written from the same clamp (one clamp, two consumers).
 *
 *   STILL, OR A MOMENT. On content nothing here loops: a still effect is CSS the compositor
 *   draws once (scanlines, vignette, duotone, recolour, distort at rest); a moment is a finite
 *   burst on a cue — play(), or fxPlay() for a one-shot — that rides WAAPI and one finite
 *   keyframe and is gone on `finished` (the sheen idiom), gated by reducedMotion() so the
 *   Less-motion switch and the operating system both win. Living motion belongs behind the
 *   words: `post` on the ambient layer (ambient-post.js). Two moments step their own SVG for
 *   their duration — distort swells its displacement scale, ripple grows its ring — because a
 *   filter primitive's attribute is reachable by neither CSS nor WAAPI; the ramp is a few dozen
 *   frames and ends.
 *
 *   sRGB, SAID OUT LOUD. Every filter carries color-interpolation-filters="sRGB": the SVG
 *   default is linearRGB, and the contrast matrix that proved the colour effects models sRGB,
 *   so the number it proved is the number the browser paints. Colours reach a graph as bytes
 *   read off the --ak-* tokens (token-color.js), never as literals, and are read again on a
 *   theme, palette or look change.
 *
 *   A <base href> would send url(#id) to the base document, so under one the filter reference
 *   is written in its absolute form (proven with a same-origin base; the CSP refuses a foreign
 *   one outright).
 *
 *   ONE ELEMENT, MANY EFFECTS. An element wears one instance per effect; a one-shot on an
 *   element already wearing that effect plays the instance it has. The marks the element's
 *   effects share (the base class, the still mark, the filter reference) are recomputed from
 *   what remains when one instance goes, so a glitch played over a still distort leaves the
 *   distort as it was; and the defs are swept of filters whose element left the document
 *   without destroy(), on every mount, so a re-render around a worn element leaks nothing.
 * @structure FX_PARAMS · FX_IDS · MOMENTS · fxParams() · fx(target, spec) → { el, id, params,
 *   set, play, stop, destroy } · fxPlay(target, id, opts) → boolean
 * @usage
 *   const v = AIMEAT.atelier.fx(card, { id: 'vignette', params: { strength: 0.25 } });
 *   AIMEAT.atelier.fx(glass, { id: 'recolour', params: { hue: 40 }, backdrop: true });
 *   AIMEAT.atelier.fxPlay(heroBand, 'glitch');                          // one tear, then whole
 * @version-history
 *   v0.48.0 — 2026-09-05 — Initial (wish-atelier-post-process-effects, stage 3).
 */
import { resolve, reducedMotion, injectStyle, uid } from './dom.js';
import { tokenRgb } from './token-color.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFS_ID = 'ak-fx-defs';
const PLAYING = 'is-ak-fx-playing';

/** The live instances per element, by effect id: one element wears one instance of an effect,
 *  and a one-shot on an element that already wears it plays that one rather than a second. */
const INSTANCES = new WeakMap();

/** Which element owns each filter in the defs, so an element that left the document without
 *  destroy() (an app that re-rendered around it) does not leave its filter behind: ensureDefs
 *  sweeps the orphans on every mount. */
/** @type {Map<string, Element>} */
const OWNERS = new Map();

/**
 * The registry's parameters — [min, max, default] for a number, { tokens, default } for a
 * token — in the registry's order, pinned to src/data/atelier-effects.ts by
 * test/unit/atelier-effects.test.ts (which reads this table from source), so the kit cannot
 * clamp to a number the matrix did not prove.
 */
export const FX_PARAMS = {
  scanlines: { pitch: [2, 8, 3], strength: [0, 0.3, 0.12] },
  vignette: { size: [0.4, 1, 0.75], strength: [0, 0.7, 0.25] },
  duotone: {
    shadow: { tokens: ['ink', 'bg', 'accent', 'spectrum-2', 'spectrum-3'], default: 'ink' },
    light: { tokens: ['ink', 'bg', 'accent', 'spectrum-2', 'spectrum-3'], default: 'bg' },
    strength: [0, 1, 1],
  },
  recolour: { hue: [-180, 180, 0], saturate: [0.5, 2, 1] },
  distort: { scale: [2, 40, 12], frequency: [0.002, 0.05, 0.012], octaves: [1, 2, 1], duration: [200, 1500, 700] },
  glitch: { strength: [0, 1, 0.6], duration: [200, 900, 420] },
  vhs: { strength: [0, 1, 0.5], duration: [400, 1200, 800] },
  ripple: { amplitude: [0, 1, 0.4], wavelength: [20, 160, 60], speed: [0.25, 2, 1] },
  kaleidoscope: { segments: [4, 12, 6], spin: [-1, 1, 0.15] },
};

/** The ids, in the registry's order. */
export const FX_IDS = Object.keys(FX_PARAMS);

/** The effects that play a moment on content; the rest are still, and kaleidoscope is layer-only. */
export const MOMENTS = { distort: true, glitch: true, vhs: true, ripple: true };

/** The effects that have something to show at rest (the others show nothing until they play). */
const STILLS = { scanlines: true, vignette: true, duotone: true, recolour: true, distort: true };

/** The effects whose engine is an SVG graph of the instance's own. */
const SVG_ENGINES = { distort: true, duotone: true, vhs: true, glitch: true, ripple: true };

/** A token parameter's name → the contract token it stands for. */
const TOKEN_VARS = {
  ink: '--ak-ink', bg: '--ak-bg', accent: '--ak-accent', 'spectrum-2': '--ak-spectrum-2', 'spectrum-3': '--ak-spectrum-3',
};

/** The luminance rows of a duotone's first primitive (Rec. 709 weights on sRGB values). */
const LUM_MATRIX = '0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0';

/**
 * Every parameter of an effect resolved the registry's way: a given number clamped into its
 * bounds, a token kept when it is one of the allowed names, everything else the default.
 * Unknown names are dropped. Null for an effect the kit does not ship.
 * @param {string} id
 * @param {Record<string, any>|null|undefined} [given]
 * @returns {Record<string, any>|null}
 */
export function fxParams(id, given) {
  const decl = /** @type {any} */ (FX_PARAMS)[id];
  if (!decl) return null;
  /** @type {Record<string, any>} */
  const out = {};
  for (const name in decl) {
    const d = decl[name];
    const v = given ? given[name] : undefined;
    if (Array.isArray(d)) {
      const n = v == null ? NaN : Number(v);
      out[name] = isFinite(n) ? Math.min(d[1], Math.max(d[0], n)) : d[2];
    } else {
      out[name] = typeof v === 'string' && d.tokens.indexOf(v) >= 0 ? v : d.default;
    }
  }
  return out;
}

// ── The SVG graphs ───────────────────────────────────────────────────────────────────────────

/**
 * @param {Element} parent @param {string} name @param {Record<string, string|number>} attrs
 * @returns {SVGElement}
 */
function svgEl(parent, name, attrs) {
  const n = document.createElementNS(SVG_NS, name);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  parent.appendChild(n);
  return n;
}

/** The one hidden <svg> every instance's <filter> lives in, made on first use. */
function ensureDefs() {
  let svg = /** @type {Element|null} */ (document.getElementById(DEFS_ID));
  if (!svg) {
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('id', DEFS_ID);
    svg.setAttribute('class', 'ak-fx-defs');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.appendChild(document.createElementNS(SVG_NS, 'defs'));
    document.body.appendChild(svg);
  }
  // A filter whose element is no longer in the document is an orphan: gone with its owner.
  for (const [fid, owner] of OWNERS) {
    if (owner.isConnected) continue;
    const orphan = document.getElementById(fid);
    if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan);
    OWNERS.delete(fid);
  }
  return /** @type {Element} */ (svg.querySelector('defs'));
}

/**
 * Recompute the marks an element's effects SHARE — the base class, the still mark, the filter
 * reference — from the instances still on it, so a one-shot glitch over a still distort leaves
 * the distort exactly as it was when the glitch is gone.
 * @param {HTMLElement} node @param {Record<string, any>|undefined} rest
 */
function settleShared(node, rest) {
  const ids = rest ? Object.keys(rest) : [];
  if (!ids.length) {
    node.classList.remove('ak-fx', 'is-ak-fx-still', PLAYING);
    node.style.removeProperty('--ak-fx-filter');
    return;
  }
  let still = false;
  let ref = '';
  for (const k of ids) {
    if (STILLS[k]) still = true;
    if (SVG_ENGINES[k] && rest[k].filterId) ref = filterRef(rest[k].filterId);
  }
  node.classList.toggle('is-ak-fx-still', still);
  if (ref) node.style.setProperty('--ak-fx-filter', ref);
  else node.style.removeProperty('--ak-fx-filter');
}

/**
 * The CSS reference to a filter: bare under normal conditions, absolute under a <base href>,
 * which would otherwise send the fragment to the base document.
 * @param {string} id
 */
function filterRef(id) {
  const base = document.querySelector('base[href]');
  return 'url(' + (base ? location.href.split('#')[0] : '') + '#' + id + ')';
}

/**
 * The ripple's map: a small image whose red and green carry the outward direction at a ring,
 * neutral elsewhere, drawn on a canvas so no colour is ever written as text. Stretched over the
 * ring's box by the moment's ramp, it displaces the picture outward at the ring only.
 * @returns {string} a data: URI
 */
function ringMapUri() {
  const n = 64;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(n, n);
  const d = img.data;
  const mid = (n - 1) / 2;
  let o = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x - mid) / mid;
      const dy = (y - mid) / mid;
      const r = Math.sqrt(dx * dx + dy * dy);
      // The ring sits at two thirds of the radius and is a fifth wide; its strength is a bell.
      const band = Math.max(0, 1 - Math.abs(r - 0.66) / 0.2);
      const k = band * band * (r > 0 ? 1 / r : 0);
      d[o] = 128 + 127 * dx * k;
      d[o + 1] = 128 + 127 * dy * k;
      d[o + 2] = 128;
      d[o + 3] = 255;
      o += 4;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

let ringMap = '';

/**
 * (Re)build one instance's <filter> from its parameters and the tokens as they resolve on the
 * element now. Every graph says sRGB, every graph has an explicit region.
 * @param {any} inst
 */
function buildFilter(inst) {
  const defs = ensureDefs();
  const old = document.getElementById(inst.filterId);
  if (old && old.parentNode) old.parentNode.removeChild(old);
  const p = inst.params;
  const f = svgEl(defs, 'filter', {
    id: inst.filterId, 'color-interpolation-filters': 'sRGB', x: '-6%', y: '-6%', width: '112%', height: '112%',
  });
  OWNERS.set(inst.filterId, inst.el);
  inst.disp = null;
  inst.map = null;
  if (inst.id === 'distort') {
    svgEl(f, 'feTurbulence', {
      type: 'fractalNoise', baseFrequency: p.frequency, numOctaves: p.octaves, seed: 7, stitchTiles: 'stitch', result: 'n',
    });
    inst.disp = svgEl(f, 'feDisplacementMap', {
      in: 'SourceGraphic', in2: 'n', scale: p.scale, xChannelSelector: 'R', yChannelSelector: 'G',
    });
  } else if (inst.id === 'duotone') {
    const s = tokenRgb(inst.el, TOKEN_VARS[p.shadow]);
    const l = tokenRgb(inst.el, TOKEN_VARS[p.light]);
    svgEl(f, 'feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: LUM_MATRIX, result: 'lum' });
    const ct = svgEl(f, 'feComponentTransfer', { in: 'lum', result: 'tone' });
    const channels = ['R', 'G', 'B'];
    for (let i = 0; i < 3; i++) {
      svgEl(ct, 'feFunc' + channels[i], { type: 'table', tableValues: (s[i] / 255).toFixed(4) + ' ' + (l[i] / 255).toFixed(4) });
    }
    svgEl(f, 'feComposite', {
      in: 'tone', in2: 'SourceGraphic', operator: 'arithmetic', k1: 0, k2: p.strength, k3: 1 - p.strength, k4: 0,
    });
  } else if (inst.id === 'vhs' || inst.id === 'glitch') {
    // The chroma split: the red and the blue of the picture pushed apart and screened back
    // over the green, which is whole where they overlap and fringed where they do not.
    const d = Math.max(1, Math.round(inst.id === 'vhs' ? 2 + 10 * p.strength : 3 + 14 * p.strength));
    svgEl(f, 'feOffset', { in: 'SourceGraphic', dx: -d, dy: 0, result: 'l' });
    svgEl(f, 'feColorMatrix', { in: 'l', type: 'matrix', values: '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', result: 'red' });
    svgEl(f, 'feOffset', { in: 'SourceGraphic', dx: d, dy: 0, result: 'r' });
    svgEl(f, 'feColorMatrix', { in: 'r', type: 'matrix', values: '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0', result: 'blue' });
    svgEl(f, 'feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', result: 'green' });
    svgEl(f, 'feBlend', { in: 'red', in2: 'green', mode: 'screen', result: 'rg' });
    svgEl(f, 'feBlend', { in: 'rg', in2: 'blue', mode: 'screen' });
  } else if (inst.id === 'ripple') {
    if (!ringMap) ringMap = ringMapUri();
    inst.map = svgEl(f, 'feImage', { href: ringMap, x: 0, y: 0, width: 0, height: 0, preserveAspectRatio: 'none', result: 'map' });
    inst.disp = svgEl(f, 'feDisplacementMap', {
      in: 'SourceGraphic', in2: 'map', scale: 0, xChannelSelector: 'R', yChannelSelector: 'G',
    });
  }
}

// ── The instance ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} FxHandle
 * @property {HTMLElement} el
 * @property {string} id
 * @property {() => Record<string, any>} params  the clamped parameters in force
 * @property {(patch: { params?: Record<string, any>, backdrop?: boolean }) => void} set
 * @property {(opts?: { onDone?: () => void }) => boolean} play  one moment; false when the effect
 *   has none, one is already playing, or the viewer asked for less motion
 * @property {() => void} stop
 * @property {() => void} destroy
 */

/**
 * Write the parameters and the filter onto the element.
 * @param {any} inst
 */
function apply(inst) {
  const node = inst.el;
  const p = inst.params;
  for (const name in p) node.style.setProperty('--ak-fx-' + inst.id + '-' + name, String(p[name]));
  if (inst.backdrop) node.setAttribute('data-ak-fx-backdrop', '');
  else node.removeAttribute('data-ak-fx-backdrop');
  if (SVG_ENGINES[inst.id]) {
    buildFilter(inst);
    node.style.setProperty('--ak-fx-filter', filterRef(inst.filterId));
  }
}

/**
 * A finite ramp: fn(f) once a frame from 0 to 1 over `ms`, then done. The one place this
 * module steps something per frame, for a moment's own length.
 * @param {any} inst @param {number} ms @param {(f: number) => void} fn @param {() => void} done
 */
function ramp(inst, ms, fn, done) {
  const t0 = performance.now();
  const step = function (now) {
    inst.raf = 0;
    if (inst.destroyed) return;
    const f = Math.min(1, (now - t0) / ms);
    fn(f);
    if (f < 1) inst.raf = requestAnimationFrame(step);
    else done();
  };
  fn(0);
  inst.raf = requestAnimationFrame(step);
}

/**
 * The filter flicker of a vhs or glitch moment: the split on, off, on, off — discrete steps on
 * WAAPI, which finishes on its own.
 * @param {string} ref
 */
function flickerFrames(ref) {
  return [
    { filter: ref, offset: 0 }, { filter: 'none', offset: 0.32 }, { filter: ref, offset: 0.46 },
    { filter: 'none', offset: 0.64 }, { filter: ref, offset: 0.78 }, { filter: 'none', offset: 1 },
  ];
}

/**
 * The glitch's two bands: they invert what is beneath them (backdrop-filter, or a tint where
 * the browser has none) and cross the element on WAAPI, removed when they arrive.
 * @param {HTMLElement} node @param {any} p @param {number} dur
 */
function glitchBands(node, p, dur) {
  const tops = [0.18, 0.61];
  for (let i = 0; i < 2; i++) {
    const band = document.createElement('span');
    band.className = 'ak-fx__glitch-band';
    band.setAttribute('aria-hidden', 'true');
    band.style.setProperty('--ak-fx-band-top', (tops[i] * 100).toFixed(1) + '%');
    band.style.setProperty('--ak-fx-band-h', (4 + 8 * p.strength).toFixed(1) + '%');
    node.appendChild(band);
    const dir = i ? -1 : 1;
    const a = band.animate(
      [{ transform: 'translateX(' + (dir * -100) + '%)' }, { transform: 'translateX(' + (dir * 100) + '%)' }],
      { duration: dur, easing: 'steps(6, end)', delay: i * dur * 0.15 },
    );
    const gone = function () { if (band.parentNode) band.parentNode.removeChild(band); };
    a.addEventListener('finish', gone);
    a.addEventListener('cancel', gone);
  }
}

/**
 * The vhs tracking band: one child riding the sheet's finite keyframe (its duration from the
 * custom property), removed on animationend.
 * @param {HTMLElement} node
 */
function trackBand(node) {
  const band = document.createElement('span');
  band.className = 'ak-fx__band';
  band.setAttribute('aria-hidden', 'true');
  node.appendChild(band);
  const gone = function () { if (band.parentNode) band.parentNode.removeChild(band); };
  band.addEventListener('animationend', gone);
  band.addEventListener('animationcancel', gone);
  // A sheet that collapsed the keyframe (reduced motion at the CSS level) fires no end event.
  setTimeout(gone, 2500);
}

/**
 * An effect on an element. The element gets the classes, the custom properties and, for an
 * SVG engine, a filter of its own; a still effect shows at once, a moment waits for play().
 * @param {Element|string} target
 * @param {{ id: string, params?: Record<string, any>|null, backdrop?: boolean }} spec
 * @returns {FxHandle|null} null (with a word in the console) for an effect the kit does not ship
 */
export function fx(target, spec) {
  const s = spec || /** @type {any} */ ({});
  const id = String(s.id || '');
  if (!/** @type {any} */ (FX_PARAMS)[id]) {
    console.warn('aimeat-atelier: "' + id + '" is not an effect this kit ships (' + FX_IDS.join(', ') + ').');
    return null;
  }
  if (id === 'kaleidoscope') {
    console.warn('aimeat-atelier: kaleidoscope folds the ambient layer (ambient({ post: ["kaleidoscope"] })); a page of words folded is unreadable by construction.');
    return null;
  }
  injectStyle();
  const node = /** @type {HTMLElement} */ (resolve(target));
  // The same effect twice on one element would fight over the classes and the properties, so
  // the earlier instance steps aside.
  const worn = INSTANCES.get(node) || {};
  if (worn[id]) worn[id].handle.destroy();
  /** @type {any} */
  const inst = {
    el: node, id,
    params: fxParams(id, s.params),
    // Only the filter-function engine may post-process what is behind the element.
    backdrop: !!s.backdrop && id === 'recolour',
    filterId: uid('ak-fx-' + id),
    disp: null, map: null, anim: null, raf: 0, playing: false, destroyed: false,
  };
  node.classList.add('ak-fx', 'ak-fx-' + id);
  if (STILLS[id]) node.classList.add('is-ak-fx-still');
  apply(inst);

  // A duotone carries token bytes in its graph, so it follows the theme, the palette and the
  // look the way the ambient layer does; the other graphs carry numbers only.
  const onPalette = function () { if (!inst.destroyed && inst.id === 'duotone') apply(inst); };
  window.addEventListener('aimeat-theme-change', onPalette);
  window.addEventListener('aimeat-palette-change', onPalette);
  const lookHost = node.closest('[data-ak-look]');
  const moLook = lookHost && id === 'duotone' ? new MutationObserver(onPalette) : null;
  if (moLook && lookHost) moLook.observe(lookHost, { attributes: true, attributeFilter: ['data-ak-look'] });
  const moRoot = id === 'duotone' ? new MutationObserver(onPalette) : null;
  if (moRoot) moRoot.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });

  function settle() {
    inst.playing = false;
    inst.anim = null;
    if (inst.raf) cancelAnimationFrame(inst.raf);
    inst.raf = 0;
    node.classList.remove(PLAYING);
    if (inst.id === 'distort' && inst.disp) inst.disp.setAttribute('scale', String(inst.params.scale));
    if (inst.id === 'ripple' && inst.disp) inst.disp.setAttribute('scale', '0');
  }

  const handle = {
    el: node,
    id,
    params() { return Object.assign({}, inst.params); },

    /** @param {{ params?: Record<string, any>, backdrop?: boolean }} patch */
    set(patch) {
      if (!patch || inst.destroyed) return;
      if (patch.params) inst.params = fxParams(id, Object.assign({}, inst.params, patch.params));
      if ('backdrop' in patch) inst.backdrop = !!patch.backdrop && id === 'recolour';
      apply(inst);
    },

    /** @param {{ onDone?: () => void }} [opts] */
    play(opts) {
      if (inst.destroyed || !MOMENTS[id] || inst.playing || reducedMotion()) return false;
      const p = inst.params;
      const done = function () {
        if (!inst.playing) return;
        settle();
        if (opts && opts.onDone) opts.onDone();
      };
      inst.playing = true;
      node.classList.add(PLAYING);
      if (id === 'distort') {
        ramp(inst, p.duration, function (f) {
          if (inst.disp) inst.disp.setAttribute('scale', (p.scale * (1 + 1.4 * Math.sin(Math.PI * f))).toFixed(2));
        }, done);
      } else if (id === 'ripple') {
        const box = node.getBoundingClientRect();
        const cx = box.width / 2;
        const cy = box.height / 2;
        const reach = Math.hypot(cx, cy) * 1.2;
        ramp(inst, 900 / p.speed, function (f) {
          const r = Math.max(1, f * reach);
          if (inst.map) {
            inst.map.setAttribute('x', (cx - r).toFixed(1));
            inst.map.setAttribute('y', (cy - r).toFixed(1));
            inst.map.setAttribute('width', (2 * r).toFixed(1));
            inst.map.setAttribute('height', (2 * r).toFixed(1));
          }
          if (inst.disp) inst.disp.setAttribute('scale', (p.amplitude * 48 * (1 - f)).toFixed(2));
        }, done);
      } else {
        if (typeof node.animate !== 'function') { done(); return false; }
        const anim = node.animate(flickerFrames(filterRef(inst.filterId)), { duration: p.duration, easing: 'step-end' });
        inst.anim = anim;
        anim.addEventListener('finish', done);
        anim.addEventListener('cancel', done);
        if (id === 'glitch') glitchBands(node, p, p.duration);
        else trackBand(node);
      }
      return true;
    },

    stop() {
      if (inst.anim) { const a = inst.anim; inst.anim = null; a.cancel(); }
      settle();
    },

    destroy() {
      if (inst.destroyed) return;
      handle.stop();
      inst.destroyed = true;
      window.removeEventListener('aimeat-theme-change', onPalette);
      window.removeEventListener('aimeat-palette-change', onPalette);
      if (moLook) moLook.disconnect();
      if (moRoot) moRoot.disconnect();
      // This instance's own marks go; the marks the element's other effects share are
      // recomputed from what remains (settleShared), never stripped wholesale.
      node.classList.remove('ak-fx-' + id);
      if (inst.backdrop) node.removeAttribute('data-ak-fx-backdrop');
      for (const name in inst.params) node.style.removeProperty('--ak-fx-' + id + '-' + name);
      const f = document.getElementById(inst.filterId);
      if (f && f.parentNode) f.parentNode.removeChild(f);
      OWNERS.delete(inst.filterId);
      if (MOMENTS[id]) {
        for (const band of Array.prototype.slice.call(node.querySelectorAll('.ak-fx__band, .ak-fx__glitch-band'))) {
          if (band.parentNode) band.parentNode.removeChild(band);
        }
      }
      const rest = INSTANCES.get(node);
      if (rest && rest[id] === inst) delete rest[id];
      settleShared(node, rest);
    },
  };
  inst.handle = handle;
  worn[id] = inst;
  INSTANCES.set(node, worn);
  return handle;
}

/**
 * One moment on an element that keeps no effect otherwise: a glitch on a cue, a ripple where
 * a touch landed. Mounts, plays, and unmounts on finished.
 * @param {Element|string} target
 * @param {string} id
 * @param {{ params?: Record<string, any> }} [opts]
 * @returns {boolean} whether it played (false under reduced motion, or for a still effect)
 */
export function fxPlay(target, id, opts) {
  if (!MOMENTS[id]) return false;
  // An element already wearing the effect (a distort at rest, say) plays its own moment and
  // keeps its still state afterwards; a bare element gets a one-shot that unmounts itself.
  const node = resolve(target);
  const worn = INSTANCES.get(node);
  if (worn && worn[id]) {
    if (opts && opts.params) worn[id].handle.set({ params: opts.params });
    return worn[id].handle.play();
  }
  const inst = fx(node, { id, params: opts && opts.params });
  if (!inst) return false;
  const played = inst.play({ onDone: function () { inst.destroy(); } });
  if (!played) inst.destroy();
  return played;
}
