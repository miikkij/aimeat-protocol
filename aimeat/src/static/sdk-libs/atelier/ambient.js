/**
 * @file atelier/ambient.js
 * @description THE AMBIENT LAYER — the one thing in this kit allowed to move at idle
 *   (wish-atelier-ambient-visuals). The Atelier's rule is that an idle surface repaints zero
 *   times; this layer is the declared exception, the way the PlayStation 3's wave moved behind
 *   a menu that did nothing, and it keeps every other promise the kit makes: it is one element
 *   behind the app, it mutates no DOM while it runs, and it stops when nobody can see it.
 *
 *   THE LOOK DECIDES. With no preset named, the layer reads --ak-ambient, --ak-ambient-alpha and
 *   --ak-ambient-speed off its host — the look's tokens, proven by the contrast matrix
 *   (AK-AMBIENT) — and follows a look, palette or theme change. An app names a preset to
 *   override, `none` to switch the look's own off. Every colour the renderers use is sampled
 *   off the --ak-* tokens (token-color.js) at mount and again on every change.
 *
 *   FIVE WAYS IT STOPS, each a gate: the tab is hidden (visibilitychange); the host is
 *   off-screen (IntersectionObserver); the person set Less motion (the kit's own switch, the
 *   `ak-motion` event); the operating system asks for reduced motion (one still frame, then
 *   nothing); the weather switch is Off (`ak-ambient`). Canvas presets are time-gated to 30
 *   frames a second at most and to 1.5 device pixels per CSS pixel at most.
 *
 *   THE FIRST FRAME IS SYNCHRONOUS. The Canvas 2D tier paints at mount, before any WebGL
 *   attempt, and stamps data-ak-ambient-painted on the layer in the same tick: the Design
 *   Book's bench photographs a preview 1200 ms after load and reads that stamp, so a layer that
 *   waited for anything would bench as unpainted.
 * @structure setWeather() · weatherLevel() · ambient(spec) → { el, preset, set, pause, resume,
 *   still, stats, destroy }
 * @usage
 *   const sky = AIMEAT.atelier.ambient({ target: app.el });          // the look decides
 *   const sky = AIMEAT.atelier.ambient({ target: host, preset: 'waves', alpha: 0.8 });
 *   sky.set({ preset: 'dust' }); sky.pause(); sky.stats().frames;
 * @version-history
 *   v0.47.0 — 2026-09-05 — Initial (wish-atelier-ambient-visuals, stage 3).
 */
import { el, resolve, reducedMotion, injectStyle } from './dom.js';
import { tokenRgb } from './token-color.js';
import { RENDERERS, CSS_PRESETS, BASE_ALPHA, PEAK, FPS, PRESET_IDS, mulberry32 } from './ambient-presets.js';
import { glWaves } from './ambient-gl.js';

const NONE = 'none';
const WEATHER_ATTR = 'data-ak-weather';
const WEATHER_KEY = 'ak.ambient';
const LEVELS = ['off', 'calm', 'full'];
const MAX_DPR = 1.5;
const MAX_FPS = 30;
/** The registry's bounds (src/data/atelier-ambients.ts AMBIENT_BOUNDS), clamped to here. */
const BOUNDS = { alpha: [0, 1], speed: [0.25, 2] };
/** How long to wait for the stylesheet before deciding the look names no ambient. */
const STYLE_WAIT_MS = 2000;
const HOST_CLASS = 'ak-ambient-host';

// ── The weather switch's state ───────────────────────────────────────────────────────────────

let weatherRestored = false;

/** Put the remembered level back on the root, once. */
function restoreWeather() {
  if (weatherRestored || typeof document === 'undefined') return;
  weatherRestored = true;
  let saved = null;
  try { saved = localStorage.getItem(WEATHER_KEY); } catch { /* storage blocked: full it is */ }
  if (saved && LEVELS.indexOf(saved) >= 0 && !document.documentElement.hasAttribute(WEATHER_ATTR)) {
    document.documentElement.setAttribute(WEATHER_ATTR, saved);
  }
}

/**
 * The viewer's weather: how much of the ambient shows. 'full' when nothing was chosen.
 * @returns {'off'|'calm'|'full'}
 */
export function weatherLevel() {
  restoreWeather();
  const v = document.documentElement.getAttribute(WEATHER_ATTR);
  return /** @type {any} */ (LEVELS.indexOf(v) >= 0 ? v : 'full');
}

/**
 * Set the weather for this origin: the root carries it (ambient.css reads it as opacity),
 * storage remembers it, and the window announces it as 'ak-ambient' so every layer and every
 * control follows.
 * @param {'off'|'calm'|'full'} level
 * @returns {'off'|'calm'|'full'}
 */
export function setWeather(level) {
  const next = /** @type {'off'|'calm'|'full'} */ (LEVELS.indexOf(level) >= 0 ? level : 'full');
  weatherRestored = true;
  document.documentElement.setAttribute(WEATHER_ATTR, next);
  try { localStorage.setItem(WEATHER_KEY, next); } catch { /* storage blocked, this page still obeys */ }
  try {
    window.dispatchEvent(new CustomEvent('ak-ambient', { detail: { level: next } }));
  } catch { /* no window to tell */ }
  return next;
}

// ── The layer ────────────────────────────────────────────────────────────────────────────────

/** @param {number} v @param {number[]} range */
function clamp(v, range) {
  return Math.min(range[1], Math.max(range[0], v));
}

/** @param {number[]} c */
function luma(c) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** @param {string} id */
function known(id) {
  return id === NONE || !!RENDERERS[id] || !!CSS_PRESETS[id];
}

/**
 * @typedef {object} AmbientHandle
 * @property {HTMLElement} el  the layer
 * @property {() => string} preset  the preset in force ('none' when off)
 * @property {(patch: { preset?: string|null, alpha?: number|null, speed?: number|null, fps?: number, gl?: boolean }) => void} set
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {() => void} still  draw one frame at the current clock
 * @property {() => { preset: string, state: string, running: boolean, frames: number, fps: number,
 *   gl: boolean, alpha: number, alphaSource: 'option'|'token'|'preset', speed: number, level: string }} stats
 * @property {() => void} destroy
 */

/**
 * The ambient layer behind `target`. A `preset` of null (or none given) means the look decides;
 * a string names one preset or 'none'.
 * @param {{ target?: string|Element, preset?: string|null, alpha?: number, speed?: number,
 *   fps?: number, gl?: boolean, seed?: number }} [spec]
 * @returns {AmbientHandle}
 */
export function ambient(spec) {
  const s = spec || {};
  injectStyle();
  restoreWeather();
  const host = resolve(s.target, document.body);
  /** The caller's wishes, which set() may change; undefined means "the look decides". */
  const opts = {
    preset: s.preset == null ? undefined : String(s.preset),
    alpha: s.alpha == null ? undefined : clamp(Number(s.alpha), BOUNDS.alpha),
    speed: s.speed == null ? undefined : clamp(Number(s.speed), BOUNDS.speed),
    fps: s.fps > 0 ? Math.min(s.fps, MAX_FPS) : 0,
    gl: s.gl !== false,
  };
  const seed = s.seed > 0 ? Math.floor(s.seed) : 1234567;

  const layer = el('div', {
    class: 'ak-ambient',
    'aria-hidden': 'true',
    'data-ak-ambient': NONE,
    'data-ak-ambient-state': 'paused',
  });
  host.insertBefore(layer, host.firstChild);
  host.classList.add(HOST_CLASS);

  const state = {
    preset: NONE,
    alpha: 1,
    alphaSource: /** @type {'option'|'token'|'preset'} */ ('token'),
    speed: 1,
    fps: 0,
    /** @type {any} */ surface: null,
    /** @type {any} */ palette: null,
    w: 0, h: 0, dpr: 1,
    clock: 0, last: 0, raf: 0, frames: 0, running: false,
    gates: {
      hidden: !!document.hidden, offscreen: false, less: reducedMotion(),
      off: weatherLevel() === 'off', paused: false,
    },
    destroyed: false, warned: false, resolveQueued: false, styleWait: 0, styleWaiting: false,
  };

  // ── Reading the look ──

  /** @param {string} name */
  function readToken(name) {
    return getComputedStyle(host).getPropertyValue(name).trim();
  }

  /** The preset that should be in force, or null while the stylesheet has not answered yet. */
  function wantedPreset() {
    if (opts.preset !== undefined) {
      if (known(opts.preset)) return opts.preset;
      warnOnce(opts.preset);
      return NONE;
    }
    const raw = readToken('--ak-ambient');
    if (!raw) return null;
    if (known(raw)) return raw;
    warnOnce(raw);
    return NONE;
  }

  /** @param {string} id */
  function warnOnce(id) {
    if (state.warned) return;
    state.warned = true;
    console.warn('aimeat-atelier: "' + id + '" is not an ambient this kit ships (' + PRESET_IDS.join(', ') + ', or none).');
  }

  /** @param {string} preset */
  function wantedAlpha(preset) {
    if (opts.alpha !== undefined) { state.alphaSource = 'option'; return opts.alpha; }
    if (opts.preset !== undefined) {
      state.alphaSource = 'preset';
      return BASE_ALPHA[preset] != null ? BASE_ALPHA[preset] : 1;
    }
    state.alphaSource = 'token';
    const raw = parseFloat(readToken('--ak-ambient-alpha'));
    return isFinite(raw) ? clamp(raw, BOUNDS.alpha) : 1;
  }

  function wantedSpeed() {
    if (opts.speed !== undefined) return opts.speed;
    if (opts.preset !== undefined) return 1;
    const raw = parseFloat(readToken('--ak-ambient-speed'));
    return isFinite(raw) ? clamp(raw, BOUNDS.speed) : 1;
  }

  function samplePalette() {
    const bg = tokenRgb(host, '--ak-bg');
    const ink = tokenRgb(host, '--ak-ink');
    return {
      dark: luma(bg) < luma(ink),
      bg, ink,
      accent: tokenRgb(host, '--ak-accent'),
      spectrum2: tokenRgb(host, '--ak-spectrum-2', '--ak-accent'),
      spectrum3: tokenRgb(host, '--ak-spectrum-3', '--ak-accent'),
    };
  }

  // ── The surface: a canvas loop or the CSS drift ──

  function markPainted() {
    if (!layer.hasAttribute('data-ak-ambient-painted')) layer.setAttribute('data-ak-ambient-painted', '1');
  }

  function unmountSurface() {
    stopLoop();
    const su = state.surface;
    if (su) {
      if (su.gl) { su.gl.destroy(); su.gl = null; }
      if (su.canvas) { su.canvas.width = 0; su.canvas.height = 0; }
      if (su.off) { su.off.width = 0; su.off.height = 0; }
    }
    state.surface = null;
    state.w = 0;
    state.h = 0;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    layer.removeAttribute('data-ak-ambient-painted');
  }

  /** @param {string} preset */
  function mountSurface(preset) {
    unmountSurface();
    layer.setAttribute('data-ak-ambient', preset);
    if (preset === NONE) return;
    if (CSS_PRESETS[preset]) {
      layer.appendChild(el('div', { class: 'ak-ambient__drift' }));
      state.surface = { kind: 'css' };
      state.fps = 0;
      markPainted();
      return;
    }
    const canvas = /** @type {HTMLCanvasElement} */ (el('canvas', { class: 'ak-ambient__canvas' }));
    canvas.addEventListener('webglcontextlost', onContextLost);
    layer.appendChild(canvas);
    state.surface = {
      kind: 'canvas', renderer: RENDERERS[preset], canvas,
      ctx: null, off: null, offCtx: null, rstate: null, gl: null, glFailed: false,
    };
    state.fps = Math.min(opts.fps || FPS[preset] || MAX_FPS, MAX_FPS);
    size(true);
  }

  /** A canvas that held WebGL can never open 2D again, so the element is replaced. */
  function onContextLost(ev) {
    ev.preventDefault();
    const su = state.surface;
    if (state.destroyed || !su || su.kind !== 'canvas') return;
    const fresh = /** @type {HTMLCanvasElement} */ (el('canvas', { class: 'ak-ambient__canvas' }));
    layer.replaceChild(fresh, su.canvas);
    su.canvas.removeEventListener('webglcontextlost', onContextLost);
    su.canvas = fresh;
    su.gl = null;
    su.glFailed = true;
    su.ctx = null;
    state.w = 0;
    size(true);
    draw();
  }

  /**
   * Size the canvas to the layer and (re)build the renderer's state. `force` rebuilds even at
   * the same size, which is what a palette change needs.
   * @param {boolean} [force]
   */
  function size(force) {
    const su = state.surface;
    if (!su || su.kind !== 'canvas') return;
    const box = layer.getBoundingClientRect();
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (!force && w === state.w && h === state.h && dpr === state.dpr && su.rstate) return;
    state.w = w;
    state.h = h;
    state.dpr = dpr;
    su.canvas.width = Math.round(w * dpr);
    su.canvas.height = Math.round(h * dpr);
    const r = su.renderer;
    const rng = mulberry32(seed);
    if (r.scale > 1) {
      const ow = Math.max(1, Math.ceil(w / r.scale));
      const oh = Math.max(1, Math.ceil(h / r.scale));
      if (!su.off) {
        su.off = document.createElement('canvas');
        su.offCtx = su.off.getContext('2d');
      }
      su.off.width = ow;
      su.off.height = oh;
      su.rstate = r.setup(ow, oh, state.palette, rng);
    } else {
      su.rstate = r.setup(w, h, state.palette, rng);
    }
    if (su.gl) { su.gl.setPalette(state.palette); return; }
    if (!su.ctx) su.ctx = su.canvas.getContext('2d');
    if (su.ctx) su.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** After the first 2D frame is on screen, the wave may trade up to the shader. */
  function tryGl() {
    const su = state.surface;
    if (!su || su.kind !== 'canvas' || state.preset !== 'waves' || !opts.gl || su.gl || su.glFailed) return;
    // The 2D context, once opened, owns the element: the shader needs a fresh canvas.
    const fresh = /** @type {HTMLCanvasElement} */ (el('canvas', { class: 'ak-ambient__canvas' }));
    fresh.width = su.canvas.width;
    fresh.height = su.canvas.height;
    const gl = glWaves(fresh, state.palette, PEAK.waves);
    if (!gl) { su.glFailed = true; return; }
    fresh.addEventListener('webglcontextlost', onContextLost);
    su.canvas.removeEventListener('webglcontextlost', onContextLost);
    layer.replaceChild(fresh, su.canvas);
    su.canvas = fresh;
    su.ctx = null;
    su.gl = gl;
    gl.frame(state.clock);
  }

  function draw() {
    const su = state.surface;
    if (!su || su.kind !== 'canvas' || !state.w || !state.h) return;
    const t = state.clock;
    if (su.gl) {
      su.gl.frame(t);
    } else if (su.ctx) {
      const r = su.renderer;
      if (r.scale > 1) {
        r.frame(su.offCtx, su.rstate, t, su.off.width, su.off.height, state.palette);
        const ctx = su.ctx;
        ctx.clearRect(0, 0, state.w, state.h);
        ctx.save();
        ctx.globalAlpha = PEAK[state.preset];
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(su.off, 0, 0, state.w, state.h);
        ctx.restore();
      } else {
        r.frame(su.ctx, su.rstate, t, state.w, state.h, state.palette);
      }
    } else {
      return;
    }
    state.frames++;
    markPainted();
  }

  // ── The loop and the gates ──

  function tick(now) {
    state.raf = 0;
    if (!state.running || state.destroyed) return;
    const interval = 1000 / (state.fps || MAX_FPS);
    if (now - state.last >= interval - 1) {
      const dt = state.last ? Math.min((now - state.last) / 1000, 0.1) : 0;
      state.last = now;
      state.clock += dt * state.speed;
      draw();
    }
    state.raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    state.running = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  /** Decide, from the gates, whether the layer runs, pauses or stands still — and say so. */
  function evaluate() {
    const g = state.gates;
    const off = state.preset === NONE;
    const canRun = !off && !g.hidden && !g.offscreen && !g.off && !g.paused && !g.less;
    const next = off || (!g.less && !canRun) ? 'paused' : g.less ? 'still' : 'running';
    if (layer.getAttribute('data-ak-ambient-state') !== next) layer.setAttribute('data-ak-ambient-state', next);
    const canvasLoop = state.surface && state.surface.kind === 'canvas';
    if (canRun && canvasLoop && !state.running) {
      state.running = true;
      state.last = 0;
      state.raf = requestAnimationFrame(tick);
      tryGl();
    } else if (!canRun && state.running) {
      stopLoop();
      // Leaving the running state for Less motion shows the picture where it stopped.
      if (g.less) draw();
    }
  }

  // ── Resolving: the look, the palette, the surface ──

  function queueResolve() {
    if (state.resolveQueued || state.destroyed) return;
    state.resolveQueued = true;
    requestAnimationFrame(function () {
      state.resolveQueued = false;
      resolveNow();
    });
  }

  function waitForStyle() {
    if (state.styleWaiting || state.destroyed) return;
    state.styleWaiting = true;
    const link = /** @type {HTMLLinkElement|null} */ (document.getElementById('ak-style'));
    const done = function () {
      if (!state.styleWaiting) return;
      state.styleWaiting = false;
      if (state.styleWait) { clearTimeout(state.styleWait); state.styleWait = 0; }
      queueResolve();
    };
    if (link) link.addEventListener('load', done, { once: true });
    state.styleWait = setTimeout(done, STYLE_WAIT_MS);
  }

  function resolveNow() {
    if (state.destroyed) return;
    const wanted = wantedPreset();
    if (wanted === null) { waitForStyle(); return; }
    state.palette = samplePalette();
    const alpha = wantedAlpha(wanted);
    const speed = wantedSpeed();
    if (alpha !== state.alpha) {
      state.alpha = alpha;
      layer.style.setProperty('--ak-ambient-level', String(alpha));
    }
    if (speed !== state.speed) {
      state.speed = speed;
      layer.style.setProperty('--ak-ambient-speed', String(speed));
    }
    if (wanted !== state.preset) {
      state.preset = wanted;
      mountSurface(wanted);
      host.dispatchEvent(new CustomEvent('ak-ambient-preset', { bubbles: true, detail: { preset: wanted } }));
    } else if (state.surface && state.surface.kind === 'canvas') {
      size(true);
    }
    evaluate();
    if (!state.running) draw();
  }

  // ── Listening ──

  const onVisibility = function () { state.gates.hidden = !!document.hidden; evaluate(); };
  const onMotion = function () { state.gates.less = reducedMotion(); evaluate(); };
  const onWeather = function () { state.gates.off = weatherLevel() === 'off'; evaluate(); };
  const onPalette = function () { queueResolve(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('ak-motion', onMotion);
  window.addEventListener('ak-ambient', onWeather);
  window.addEventListener('aimeat-theme-change', onPalette);
  window.addEventListener('aimeat-palette-change', onPalette);
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (media && media.addEventListener) media.addEventListener('change', onMotion);

  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(function () { if (state.destroyed) return; size(false); if (!state.running) draw(); })
    : null;
  if (ro) ro.observe(layer);
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(function (entries) {
      const e = entries[entries.length - 1];
      state.gates.offscreen = !!e && !e.isIntersecting;
      evaluate();
    })
    : null;
  if (io) io.observe(layer);
  const moHost = new MutationObserver(onPalette);
  moHost.observe(host, { attributes: true, attributeFilter: ['data-ak-look', 'style', 'class'] });
  const moRoot = new MutationObserver(onPalette);
  moRoot.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });

  resolveNow();

  return {
    el: layer,
    preset() { return state.preset; },

    /** @param {{ preset?: string|null, alpha?: number|null, speed?: number|null, fps?: number, gl?: boolean }} patch */
    set(patch) {
      if (!patch || state.destroyed) return;
      if ('preset' in patch) opts.preset = patch.preset == null ? undefined : String(patch.preset);
      if ('alpha' in patch) opts.alpha = patch.alpha == null ? undefined : clamp(Number(patch.alpha), BOUNDS.alpha);
      if ('speed' in patch) opts.speed = patch.speed == null ? undefined : clamp(Number(patch.speed), BOUNDS.speed);
      if ('fps' in patch) {
        opts.fps = patch.fps > 0 ? Math.min(patch.fps, MAX_FPS) : 0;
        if (state.preset !== NONE && !CSS_PRESETS[state.preset]) {
          state.fps = Math.min(opts.fps || FPS[state.preset] || MAX_FPS, MAX_FPS);
        }
      }
      if ('gl' in patch) opts.gl = patch.gl !== false;
      resolveNow();
    },

    pause() { state.gates.paused = true; evaluate(); },
    resume() { state.gates.paused = false; evaluate(); },
    still() { draw(); },

    stats() {
      const su = state.surface;
      return {
        preset: state.preset,
        state: layer.getAttribute('data-ak-ambient-state') || 'paused',
        running: state.running,
        frames: state.frames,
        fps: state.fps,
        gl: !!(su && su.gl),
        alpha: state.alpha,
        alphaSource: state.alphaSource,
        speed: state.speed,
        level: weatherLevel(),
      };
    },

    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      unmountSurface();
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      moHost.disconnect();
      moRoot.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('ak-motion', onMotion);
      window.removeEventListener('ak-ambient', onWeather);
      window.removeEventListener('aimeat-theme-change', onPalette);
      window.removeEventListener('aimeat-palette-change', onPalette);
      if (media && media.removeEventListener) media.removeEventListener('change', onMotion);
      if (state.styleWait) clearTimeout(state.styleWait);
      host.classList.remove(HOST_CLASS);
      if (layer.parentNode) layer.parentNode.removeChild(layer);
    },
  };
}
