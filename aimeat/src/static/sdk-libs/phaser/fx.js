/**
 * @file phaser/fx.js
 * @description The particle effects kit: seventeen named presets in three families, every one of
 *   them drawn on the theme's colours. Rain, snow and fog cover the whole camera; fire, smoke and
 *   a trail ride on a game object; an explosion, a splash or a footstep happens once at a point
 *   and is gone. A game names the effect and the place, and this module owns the texture, the
 *   emitter, the depth and the end.
 *
 *   THREE FAMILIES, THREE ENDINGS. A burst (at) is exploded once and its emitter is destroyed
 *   when the last particle has died, with a real-time timer as the guard for a paused scene. A
 *   weather layer and a follow emitter stand until stop() or destroy(): stop() emits nothing
 *   more and takes the emitter down once its last particle is gone, destroy() takes it down now.
 *   A follow emitter also goes when the object it follows is destroyed, and everything this
 *   handle started goes with the scene's own shutdown, so nothing runs after the game that
 *   asked for it.
 *
 *   ONE WEATHER AT A TIME. A second weather() call drains the first (it stops emitting and is
 *   gone once its particles have fallen) unless the caller says stack: true, because two layers
 *   at once is almost always the leftover of a scene that forgot the first.
 *
 *   NO COLOUR IS WRITTEN HERE. A preset names token words and a caller may pass a word or a
 *   number; the texture is drawn once per shape and colour list and kept on the scene's texture
 *   manager (fx-parts.js). A preset with several colours draws them side by side in ONE texture
 *   as frames and the emitter picks a frame per particle, which is how confetti gets four true
 *   theme colours without tinting, since a tint multiplies the pixel and darkens a coloured
 *   texture.
 *
 *   set() SWAPS RATHER THAN EDITS. Phaser's setConfig adds emit zones on top of the ones it has,
 *   and its op setters change only the current value, not a range; both were checked in the
 *   4.2.1 bundle. So a change of density, wind or colour builds a fresh emitter and drains the
 *   old one. Call it on a change, not every frame.
 *
 *   DEPTH. The HUD draws at 900 and its toast at 950 (hud.js); juice numbers sit at 960; menus
 *   and wipes start at OVERLAY_DEPTH minus 20. Weather goes at 800, above the world and under
 *   the HUD; a burst at 850; a follow emitter one step over the object it follows, or one step
 *   under it when the preset is a trail. A caller's depth is honoured, but held under the
 *   overlay band so an effect never covers a menu.
 *
 *   LESS MOTION IS ANSWERED PER FAMILY. Weather still runs, at 35 percent of the density, half
 *   the speed and no wind. A burst becomes a single short puff: four particles of the preset's
 *   colour that fade where they were thrown. A follow emitter stands down: follow() returns a
 *   handle with no emitter and active false, whose stop() and destroy() do nothing.
 * @structure tone · fx(scene, opts) returning weather / at / follow / preset / define / kinds /
 *   destroy; the data is ./fx-presets.js and the pure parts (shapes, zones, flow) ./fx-parts.js
 * @usage
 *   const fx = AIMEAT.phaser.fx(this);
 *   const sky = fx.weather('rain', { density: 1.4, wind: 120 });
 *   fx.at(x, y, 'explosion');
 *   const torch = fx.follow(lamp, 'fire');
 *   sky.set({ wind: -60 });   torch.stop();   sky.destroy();
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the seventeen presets, the three families, the frame strip
 *     per colour list, the swap on set(), and the per-family less-motion answer.
 */
import { reducedMotion } from '../atelier/dom.js';
import { look, OVERLAY_DEPTH } from './tokens.js';
import { PRESETS, ALIASES } from './fx-presets.js';
import { strip, box, ring, fitZones, merge, slowed, mean, flow } from './fx-parts.js';

/** Weather: above the world, under the HUD's plate at 900. */
const WEATHER_DEPTH = 800;
/** A burst: above the weather, still under the HUD. */
const BURST_DEPTH = 850;
/** Nothing here draws over a menu or a wipe, whatever depth a caller asks for. */
const DEPTH_CEILING = OVERLAY_DEPTH - 30;

/** The view width a preset's rate is stated for. */
const REF_WIDTH = 960;
/** The frame the last particle dies on, covered. */
const SLACK = 80;

/** Less motion: the share of the density weather keeps, and of every speed. */
const STILL_DENSITY = 0.35;
const STILL_SPEED = 0.5;

/** The single short puff a burst becomes under less motion. */
const PUFF = {
  count: 4, life: 240,
  config: {
    speed: { min: 0, max: 10 }, angle: { min: 0, max: 360 }, lifespan: 240,
    alpha: { start: 0.6, end: 0 }, scale: { start: 1, end: 0.6 },
  },
};

/** An app's own presets, shared by every handle on the page. */
/** @type {Record<string, any>} */
const CUSTOM = {};

/**
 * A token word or a number, as a theme colour. Any colour boot.js puts on the theme is a word
 * here: accent, ink, inkDim, ok, warn, err, bg, surface, line, ch1 to ch4.
 * @param {any} th
 * @param {string|number|undefined} want
 * @param {number} fallback
 * @returns {number}
 */
function tone(th, want, fallback) {
  if (typeof want === 'number' && isFinite(want)) return want;
  if (typeof want === 'string' && typeof th[want] === 'number') return th[want];
  return fallback;
}

/**
 * @typedef {object} FxLayer   a weather layer or a follow emitter
 * @property {string} kind
 * @property {any} emitter      the Phaser emitter drawing it now. set() replaces it; null once gone.
 * @property {boolean} active   emitting, or standing down under less motion (then false from the start)
 * @property {(patch: { density?: number, wind?: number, colour?: string|number, config?: any }) => FxLayer} set
 *   a change of density, wind, colour or config: a fresh emitter replaces this one and the old
 *   one drains. wind applies to weather only.
 * @property {() => void} stop     emits nothing more; gone once the last particle has died
 * @property {() => void} destroy  gone now
 */

/**
 * @typedef {object} FxOptions
 * @property {any} [theme]  a theme handle. Default: read once off the element the game was
 *   booted into, so a page that changes its palette mid-game wants a fresh fx().
 */

/**
 * @typedef {object} FxHandle
 * @property {(kind: string, opts?: { density?: number, wind?: number, colour?: string|number,
 *   depth?: number, stack?: boolean, config?: any }) => FxLayer|null} weather
 *   a full-camera layer. density scales the preset's rate (1 is the preset, 0 emits nothing);
 *   wind is a sideways drift in px/s; colour replaces the preset's colours with one. Null when
 *   the preset has no weather family.
 * @property {(x: number, y: number, kind: string, opts?: { count?: number, colour?: string|number,
 *   depth?: number, scrollFactor?: number, config?: any }) => any} at
 *   a one-shot burst at a point in the world. Returns the emitter, in case the caller wants it
 *   gone sooner, or null when nothing ran.
 * @property {(target: any, kind: string, opts?: { density?: number, colour?: string|number,
 *   depth?: number, offset?: { x?: number, y?: number }, config?: any }) => FxLayer|null} follow
 *   a standing emitter on a game object, removed with the object. Null when the preset has no
 *   follow family or the target is missing.
 * @property {(name: string, family?: 'at'|'weather'|'follow') => any} preset
 *   the raw emitter config for a preset and family (default at), with texture and frame filled
 *   in, for scene.add.particles(x, y, cfg.texture, cfg). Null when unknown.
 * @property {(name: string, def: any) => string} define
 *   register an app's own preset under a name, as a preset object in the shape fx-presets.js
 *   uses or a function of the theme returning one. It wins over a built-in of the same name and
 *   is shared by every fx() handle on the page.
 * @property {(family?: 'at'|'weather'|'follow') => string[]} kinds  the names that carry a family
 * @property {() => void} destroy
 */

/**
 * The particle effects for one scene. One handle owns everything it started, so one destroy()
 * ends all of it, and the scene's own shutdown calls it.
 * @param {any} scene
 * @param {FxOptions} [opts]
 * @returns {FxHandle}
 */
export function fx(scene, opts) {
  const o = opts || /** @type {FxOptions} */ ({});
  const th = o.theme || look(scene);
  let dead = false;

  /** Real-time timeouts still owed. Cancelled by destroy(). */
  /** @type {Set<number>} */
  const timeouts = new Set();
  /** @type {any[]} every emitter alive, whichever family made it. */
  const emitters = [];
  /** @type {any[]} the weather layers now emitting, for the one-at-a-time rule. */
  const weathers = [];
  /** @type {any[]} every weather layer alive, for the resize. */
  const layers = [];
  /** @type {any[]} every weather and follow handle alive, so destroy() closes each one. */
  const handles = [];
  let watchingResize = false;

  /**
   * A real-time wait, because particles age on the raw frame delta and not on the scene clock.
   * @param {number} wait
   * @param {() => void} run
   * @returns {void}
   */
  function later(wait, run) {
    const id = setTimeout(function () {
      timeouts.delete(id);
      if (!dead) run();
    }, Math.max(0, wait));
    timeouts.add(id);
  }

  function own(emitter) {
    emitters.push(emitter);
    return emitter;
  }

  /** Forget an emitter and take it down, once. */
  function drop(emitter) {
    const at = emitters.indexOf(emitter);
    if (at >= 0) emitters.splice(at, 1);
    if (emitter && emitter.scene !== undefined && typeof emitter.destroy === 'function') emitter.destroy();
  }

  /**
   * Stop an emitter and take it down once its longest-lived particle is gone.
   * @param {any} emitter
   * @param {number} life
   * @returns {void}
   */
  function drain(emitter, life) {
    if (!emitter) return;
    if (typeof emitter.stop === 'function') emitter.stop();
    later(life + SLACK, function () { drop(emitter); });
  }

  /**
   * @param {any} want
   * @param {number} fallback
   * @returns {number}
   */
  function depthOf(want, fallback) {
    const d = typeof want === 'number' && isFinite(want) ? want : fallback;
    return Math.min(d, DEPTH_CEILING);
  }

  /**
   * A preset by name: the app's own first, then the built-ins through their aliases.
   * @param {string} name
   * @returns {any}
   */
  function resolve(name) {
    if (typeof name !== 'string') return null;
    const custom = CUSTOM[name];
    if (custom) return typeof custom === 'function' ? custom(th) : custom;
    return PRESETS[ALIASES[name] || name] || null;
  }

  /**
   * The texture a preset draws with: the app's own when named, else the strip of its colours,
   * or of the one colour the caller asked for.
   * @param {any} preset
   * @param {string|number|undefined} want
   * @returns {{ key: string, frames: any }}
   */
  function textureOf(preset, want) {
    if (preset.texture) return { key: preset.texture, frames: preset.frame };
    const words = Array.isArray(preset.colours) && preset.colours.length ? preset.colours : ['accent'];
    const colours = want === undefined
      ? words.map(function (w) { return tone(th, w, th.accent); })
      : [tone(th, want, th.accent)];
    return strip(scene, preset.shape || 'dot', colours);
  }

  /**
   * A family's config with the texture, the frames and the caller's own keys in it.
   * @param {any} family
   * @param {{ key: string, frames: any }} tex
   * @param {any} [extra]
   * @returns {any}
   */
  function assemble(family, tex, extra) {
    const config = merge(family.config, extra);
    config.texture = tex.key;
    if (tex.frames !== undefined) config.frame = tex.frames;
    return config;
  }

  /* ── Weather ───────────────────────────────────────────────────────────────────────────── */

  function onResize() {
    for (const layer of layers) layer.refit();
  }

  function watchResize() {
    if (watchingResize || !scene.scale || typeof scene.scale.on !== 'function') return;
    watchingResize = true;
    scene.scale.on('resize', onResize);
  }

  /**
   * The emitter config for a weather layer at a view size, from its preset and settings.
   * @param {any} preset
   * @param {any} s        the layer's settings
   * @param {any} born     the emit box
   * @param {any} kept     the death box
   * @param {boolean} still
   * @returns {any}
   */
  function weatherConfig(preset, s, born, kept, still) {
    const wx = preset.weather;
    const cam = scene.cameras.main;
    const density = Math.max(0, typeof s.density === 'number' ? s.density : 1) * (still ? STILL_DENSITY : 1);
    const wind = still ? 0 : (typeof s.wind === 'number' ? s.wind : (wx.wind || 0));
    let config = merge(wx.config);
    if (typeof wx.sway === 'number') {
      const sway = still ? 0 : wx.sway;
      config.speedX = { min: wind - sway, max: wind + sway };
    }
    // 0 minus, not a leading minus: with no wind the tilt is 0 and not -0.
    if (wx.align) config.rotate = 0 - (Math.atan2(wind, mean(config.speedY)) * 180) / Math.PI;
    if (still) config = slowed(config, STILL_SPEED);
    const rate = flow(wx.rate * (cam.width / REF_WIDTH) * density);
    config.frequency = rate.frequency;
    config.quantity = rate.quantity;
    fitZones(born, kept, wx.zone, cam.width, cam.height, wind, wx.life);
    config.emitZone = { type: 'random', source: born };
    config.deathZone = { type: 'onLeave', source: kept };
    if (s.config) config = merge(config, s.config);
    const tex = textureOf(preset, s.colour);
    config.texture = tex.key;
    if (tex.frames !== undefined) config.frame = tex.frames;
    return config;
  }

  /**
   * A full-camera layer: rain, snow, fog, embers, dust, bubbles, stars, leaves or confetti.
   * @param {string} kind
   * @param {any} [wopts]
   * @returns {FxLayer|null}
   */
  function weather(kind, wopts) {
    if (dead || !scene.add || !scene.cameras || !scene.cameras.main) return null;
    const preset = resolve(kind);
    if (!preset || !preset.weather) return null;
    const settings = merge(wopts || {});
    if (!settings.stack) for (const other of weathers.slice()) other.stop();

    const born = box(0, 0, 1, 1);
    const kept = box(0, 0, 1, 1);
    const life = preset.weather.life;
    let gone = false;

    /** @type {any} */
    const layer = {
      kind: kind,
      emitter: null,
      active: true,
      refit: function () {
        if (gone) return;
        const cam = scene.cameras.main;
        const still = reducedMotion();
        const wind = still ? 0 : (typeof settings.wind === 'number' ? settings.wind : (preset.weather.wind || 0));
        fitZones(born, kept, preset.weather.zone, cam.width, cam.height, wind, life);
      },
      set: function (patch) {
        if (gone) return layer;
        for (const name in patch || {}) settings[name] = patch[name];
        const old = layer.emitter;
        layer.emitter = build();
        drain(old, life);
        return layer;
      },
      stop: function () {
        if (gone) return;
        gone = true;
        layer.active = false;
        forget();
        drain(layer.emitter, life);
        layer.emitter = null;
      },
      destroy: function () {
        if (gone) {
          if (layer.emitter) drop(layer.emitter);
          layer.emitter = null;
          return;
        }
        gone = true;
        layer.active = false;
        forget();
        drop(layer.emitter);
        layer.emitter = null;
      },
    };

    function forget() {
      let at = weathers.indexOf(layer);
      if (at >= 0) weathers.splice(at, 1);
      at = layers.indexOf(layer);
      if (at >= 0) layers.splice(at, 1);
      at = handles.indexOf(layer);
      if (at >= 0) handles.splice(at, 1);
    }

    function build() {
      const config = weatherConfig(preset, settings, born, kept, reducedMotion());
      const emitter = scene.add.particles(0, 0, config.texture, config);
      emitter.setScrollFactor(0);
      emitter.setDepth(depthOf(settings.depth, WEATHER_DEPTH));
      return own(emitter);
    }

    layer.emitter = build();
    weathers.push(layer);
    layers.push(layer);
    handles.push(layer);
    watchResize();
    return layer;
  }

  /* ── Bursts ────────────────────────────────────────────────────────────────────────────── */

  /**
   * One finite burst at a point. Exploded once; the emitter goes when its last particle has died
   * (Phaser's own complete event), or after the preset's life if the scene is not stepping.
   * @param {number} x
   * @param {number} y
   * @param {string} kind
   * @param {any} [aopts]
   * @returns {any} the emitter, or null when nothing ran
   */
  function at(x, y, kind, aopts) {
    if (dead || !scene.add) return null;
    const preset = resolve(kind);
    if (!preset || !preset.at) return null;
    const a = aopts || {};
    const still = reducedMotion();
    const family = still ? PUFF : preset.at;
    const tex = textureOf(preset, a.colour);
    const config = assemble(family, tex, still ? undefined : a.config);
    if (!still && preset.at.ring) config.emitZone = { type: 'random', source: ring(preset.at.ring) };
    config.emitting = false;

    const emitter = own(scene.add.particles(x, y, tex.key, config));
    emitter.setDepth(depthOf(a.depth, BURST_DEPTH));
    if (typeof a.scrollFactor === 'number') emitter.setScrollFactor(a.scrollFactor);
    const count = still ? PUFF.count : Math.max(1, Math.round(typeof a.count === 'number' ? a.count : family.count));
    emitter.explode(count);

    let done = false;
    const finish = function () {
      if (done) return;
      done = true;
      drop(emitter);
    };
    if (typeof emitter.once === 'function') emitter.once('complete', finish);
    later(family.life + SLACK, finish);
    return emitter;
  }

  /* ── Follow ────────────────────────────────────────────────────────────────────────────── */

  /**
   * A standing emitter on a game object: fire on a torch, bubbles from a diver, a trail. Gone
   * with the object, with stop() or destroy(), or with the scene.
   * @param {any} target
   * @param {string} kind
   * @param {any} [fopts]
   * @returns {FxLayer|null}
   */
  function follow(target, kind, fopts) {
    if (dead || !scene.add || !target) return null;
    const preset = resolve(kind);
    if (!preset || !preset.follow) return null;
    const settings = merge(fopts || {});
    const life = preset.follow.life;

    if (reducedMotion()) {
      /** @type {any} */
      const still = { kind: kind, emitter: null, active: false };
      still.set = function () { return still; };
      still.stop = function () {};
      still.destroy = function () {};
      return still;
    }

    let gone = false;
    /** @type {any} */
    const layer = {
      kind: kind,
      emitter: null,
      active: true,
      set: function (patch) {
        if (gone) return layer;
        for (const name in patch || {}) settings[name] = patch[name];
        const old = layer.emitter;
        layer.emitter = build();
        drain(old, life);
        return layer;
      },
      stop: function () {
        if (gone) return;
        gone = true;
        layer.active = false;
        unhook();
        drain(layer.emitter, life);
        layer.emitter = null;
      },
      destroy: function () {
        if (gone) {
          if (layer.emitter) drop(layer.emitter);
          layer.emitter = null;
          return;
        }
        gone = true;
        layer.active = false;
        unhook();
        drop(layer.emitter);
        layer.emitter = null;
      },
    };

    const onTargetGone = function () { layer.destroy(); };
    function unhook() {
      if (typeof target.off === 'function') target.off('destroy', onTargetGone);
      const at = handles.indexOf(layer);
      if (at >= 0) handles.splice(at, 1);
    }

    function build() {
      const tex = textureOf(preset, settings.colour);
      const config = assemble(preset.follow, tex, settings.config);
      if (typeof settings.density === 'number') {
        const rate = flow((1000 / Math.max(1, config.frequency)) * (config.quantity || 1) * Math.max(0, settings.density));
        config.frequency = rate.frequency;
        config.quantity = rate.quantity;
      }
      if (preset.follow.ring) config.emitZone = { type: 'random', source: ring(preset.follow.ring) };
      const emitter = scene.add.particles(0, 0, tex.key, config);
      const off = settings.offset || {};
      emitter.startFollow(target, off.x || 0, off.y || 0, true);
      const step = preset.follow.behind ? -1 : 1;
      emitter.setDepth(depthOf(settings.depth, (typeof target.depth === 'number' ? target.depth : 0) + step));
      if (typeof target.scrollFactorX === 'number') {
        emitter.setScrollFactor(target.scrollFactorX, target.scrollFactorY);
      }
      return own(emitter);
    }

    layer.emitter = build();
    handles.push(layer);
    if (typeof target.once === 'function') target.once('destroy', onTargetGone);
    return layer;
  }

  /* ── The table ─────────────────────────────────────────────────────────────────────────── */

  /**
   * The raw emitter config for a preset and family, for an app that wants the emitter itself.
   * @param {string} name
   * @param {'at'|'weather'|'follow'} [family]
   * @returns {any}
   */
  function presetOf(name, family) {
    if (dead) return null;
    const p = resolve(name);
    const fam = family || 'at';
    if (!p || !p[fam]) return null;
    if (fam === 'weather') {
      if (!scene.cameras || !scene.cameras.main) return null;
      return weatherConfig(p, {}, box(0, 0, 1, 1), box(0, 0, 1, 1), false);
    }
    const tex = textureOf(p, undefined);
    const config = assemble(p[fam], tex);
    if (p[fam].ring) config.emitZone = { type: 'random', source: ring(p[fam].ring) };
    if (fam === 'at') config.emitting = false;
    return config;
  }

  /**
   * @param {string} name
   * @param {any} def
   * @returns {string}
   */
  function define(name, def) {
    if (typeof name !== 'string' || !name || (!def || (typeof def !== 'object' && typeof def !== 'function'))) {
      throw new Error('fx.define wants a name and a preset object or a function of the theme.');
    }
    CUSTOM[name] = def;
    return name;
  }

  /**
   * @param {'at'|'weather'|'follow'} [family]
   * @returns {string[]}
   */
  function kinds(family) {
    /** @type {string[]} */
    const out = [];
    const seen = {};
    const add = function (name, p) {
      if (seen[name] || !p || (family && !p[family])) return;
      seen[name] = true;
      out.push(name);
    };
    for (const name in CUSTOM) add(name, resolve(name));
    for (const name in PRESETS) add(name, PRESETS[name]);
    return out;
  }

  /* ── The end ───────────────────────────────────────────────────────────────────────────── */

  function destroy() {
    if (dead) return;
    dead = true;
    if (scene.events && typeof scene.events.off === 'function') {
      scene.events.off('shutdown', destroy);
      scene.events.off('destroy', destroy);
    }
    if (watchingResize && scene.scale && typeof scene.scale.off === 'function') {
      scene.scale.off('resize', onResize);
    }
    watchingResize = false;
    for (const id of timeouts) clearTimeout(id);
    timeouts.clear();
    for (const layer of handles.slice()) layer.destroy();
    weathers.length = 0;
    layers.length = 0;
    handles.length = 0;
    for (const emitter of emitters.slice()) drop(emitter);
    emitters.length = 0;
  }

  if (scene.events && typeof scene.events.once === 'function') {
    scene.events.once('shutdown', destroy);
    scene.events.once('destroy', destroy);
  }

  return {
    weather: weather,
    at: at,
    follow: follow,
    preset: presetOf,
    define: define,
    kinds: kinds,
    destroy: destroy,
  };
}
