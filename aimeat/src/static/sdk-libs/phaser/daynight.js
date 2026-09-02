/**
 * @file phaser/daynight.js
 * @description One clock for the whole picture. The time of day, in game hours, drives the
 *   parallax backdrop's time word, an ambient tint over the world, the lamps that show in the
 *   dark, and the weather, so a game says dayNight(this, { create: true, speed: 0.6 }) and the
 *   evening arrives on its own: the sky turns, the world dims, the windows come on, the rain
 *   starts. The three things this module drives are parallax.js, fx.js and its own overlay; it
 *   owns no palette and no particle of its own.
 *
 *   FOUR PHASES ON THREE WORDS. The clock has dawn (5 to 7), day (7 to 17), dusk (17 to 20) and
 *   night (20 to 5), every boundary an hour in spec.phases. The parallax wears day, dusk or
 *   night, so dawn wears the parallax's dusk: both are the low warm sun, and the backdrop has no
 *   fourth palette. The parallax is told once at the start, so the backdrop agrees with the
 *   clock it was handed, and then exactly once per boundary, which is one rebuild each.
 *
 *   THE AMBIENT IS CONTINUOUS. A full-camera rectangle at scroll factor 0 follows the hour
 *   through six keyframes: dark (the darker of the page's two tones, alpha 0.45) until dawn
 *   begins, warm (the warn token, alpha 0.18) in the middle of dawn, clear when day begins, clear
 *   until dusk begins, warm in the middle of dusk, dark again when night begins. Between two
 *   keyframes the colour and the alpha ride a smoothstep, so a night falls over the whole of dusk
 *   and nothing snaps; at every boundary the two sides agree, which is what makes it continuous.
 *   It sits at 790: over every gameplay depth and UNDER the weather at 800 (fx.js), so rain and
 *   snow stay crisp on a darkened world rather than being dimmed with it. A lamp is a soft disc of
 *   one theme tone drawn once as a radial gradient, added over the ambient at 791, and it shows
 *   in proportion to how dark the ambient is: nothing at noon, half at the middle of dusk, all of
 *   it at night. It is a picture of a light, not a light pipeline.
 *
 *   WEATHER IS A SCHEDULE. A word (clear, rain, snow, fog, storm) is one fx weather layer, and a
 *   change stops the old layer (it drains) and starts the new. auto rolls a forecast from the
 *   seed, one stream per game day: fog at dawn half the time, rain in the evening (dusk and the
 *   night before midnight) a little under half the time, a third of those rains a storm, a rare
 *   shower by day, clear otherwise. Snow is climate rather than weather, so auto never rolls it;
 *   a winter game says weather: 'snow'. A storm is rain at 1.6 density with 140 px/s of wind and
 *   a lightning flash every 6 to 14 seconds: the ambient rectangle goes to the lighter of the
 *   page's two tones for 80 ms, and 40 ms later again for 50 ms. Both ends are stated, so a
 *   flash is finite whatever the frame rate.
 *
 *   LESS MOTION KEEPS THE TIME AND DROPS THE TRANSITION. The clock runs, because time passing is
 *   meaning and not decoration; the ambient jumps to the phase's own value at the boundary
 *   instead of sliding to it; a lightning strike is one soft 120 ms flash, or none at all when
 *   spec.lightning is false.
 *
 *   NO COLOUR IS WRITTEN HERE. Night is the darker of bg and ink, the flash is the lighter, dawn
 *   and dusk are the warn token, a lamp is any theme word or a number the game already has.
 * @structure constants · normalisePhases · phaseOf · keyframes / ambientAt / ambientStill ·
 *   forecast · dayNight(scene, spec) → handle (hour, phase, day, weather, set, pause, resume, on,
 *   update, sunPosition, parallax, fx, ambient, destroy)
 * @usage
 *   const sky = AIMEAT.phaser.dayNight(this, { create: true, preset: 'hills', speed: 0.6 });
 *   sky.on('phase', (name) => toast(this, name));
 *   sky.set({ hour: 18, weather: 'storm' });   sky.hour();   sky.phase();   sky.destroy();
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the game-hour clock, four phases on the parallax's three
 *     words, the six-keyframe ambient, the lamps, the weather schedule with the seeded forecast,
 *     the finite storm flash, and the less-motion answer.
 */
import { reducedMotion } from '../atelier/dom.js';
import { look } from './tokens.js';
import { rng, mix, luminance, css } from './parallax-layers.js';
import { parallax } from './parallax.js';
import { fx } from './fx.js';

/** The ambient: over every gameplay depth, under the weather at 800 (fx.js), under the HUD at
 *  900 (hud.js). The lamps sit one step over the ambient so they lighten it. */
const AMBIENT_DEPTH = 790;
const LIGHT_DEPTH = 791;

/** How much of the dark pole the night lays over the world, and of the warm tone dawn and dusk. */
const NIGHT_ALPHA = 0.45;
const WARM_ALPHA = 0.18;

/** A lightning flash: the light pole at this alpha, lit for 80 ms, dark for 40, lit for 50. Under
 *  less motion one softer flash of 120 ms. */
const FLASH_ALPHA = 0.55;
const FLASH_STEPS = [{ ms: 80, lit: true }, { ms: 40, lit: false }, { ms: 50, lit: true }];
const STILL_FLASH_ALPHA = 0.25;
const STILL_FLASH_STEPS = [{ ms: 120, lit: true }];
const FLASH_GAP_MIN = 6000;
const FLASH_GAP_MAX = 14000;

/** The clock's defaults: noon, and a whole day in eight minutes. */
const DEFAULT_HOUR = 12;
const DEFAULT_SPEED = 0.05;
const DEFAULT_PHASES = { dawn: 5, day: 7, dusk: 17, night: 20 };

/** The parallax word each phase wears. Dawn wears dusk: the parallax has no fourth palette. */
/** @type {Record<string, 'day'|'dusk'|'night'>} */
const PHASE_TIME = { dawn: 'dusk', day: 'day', dusk: 'dusk', night: 'night' };

/** The fx weather layer each word stands for. Clear is no layer. */
const WEATHER_LAYERS = {
  clear: null,
  rain: { kind: 'rain' },
  snow: { kind: 'snow' },
  fog: { kind: 'fog' },
  storm: { kind: 'rain', density: 1.6, wind: 140 },
};

/** The forecast's odds, per game day. */
const FOG_AT_DAWN = 0.5;
const RAIN_IN_EVENING = 0.45;
const STORM_SHARE = 0.35;
const SHOWER_BY_DAY = 0.12;

/** A lamp's texture is this many pixels square and is scaled to the lamp's radius. */
const LIGHT_TEXTURE = 128;
const LIGHT_RADIUS = 80;
const LIGHT_ALPHA = 0.9;

/** How high the sun's arc reaches, as a share of the viewport's height. */
const SUN_ARC = 0.85;

/** A frame that crosses more whole hours than this (a tab that slept) fires this many at most. */
const HOUR_EVENTS_CAP = 48;

/** The phase names, in order, for a picker. */
export const DAYNIGHT_PHASES = ['dawn', 'day', 'dusk', 'night'];
/** The weather words, for a picker. */
export const DAYNIGHT_WEATHERS = ['clear', 'rain', 'snow', 'fog', 'storm', 'auto'];

/** One handle, one id, so the lamp textures of two clocks in one game never meet. */
let nextId = 1;

/**
 * @typedef {object} DayNightLight
 * @property {number} x            in the world, like any sprite
 * @property {number} y
 * @property {number} [radius]     Default 80.
 * @property {string|number} [tone]  a theme word (warn, ch3, surface, accent, ...) or a number.
 *   Default warn, the colour of a window at night.
 * @property {number} [alpha]      how bright at full night, 0..1. Default 0.9.
 * @property {number} [scrollFactor]  Default 1: the lamp is in the world.
 */

/**
 * @typedef {object} DayNightSpec
 * @property {number} [hour]       0..24, the clock's start. Default 12.
 * @property {number} [speed]      game hours per real second. Default 0.05; 0 freezes the clock.
 * @property {{ dawn?: number, day?: number, dusk?: number, night?: number }} [phases]  the hour
 *   each phase begins, in rising order. Default 5, 7, 17 and 20; night runs across midnight.
 * @property {'clear'|'rain'|'snow'|'fog'|'storm'|'auto'} [weather]  Default clear.
 * @property {number} [seed]       the forecast and the storm's timing follow from it. Default 1.
 * @property {boolean} [lightning]  false: a storm has no flash. Default true.
 * @property {DayNightLight[]} [lights]  lamps that show when the ambient is dark.
 * @property {any} [parallax]      a parallax handle to drive. Told the time once now, then at
 *   each boundary.
 * @property {any} [fx]            an fx handle to draw the weather with.
 * @property {boolean} [create]    build what was not passed: a parallax from preset and an fx
 *   handle. Both are destroyed with this handle.
 * @property {string} [preset]     the parallax preset when creating. Default hills.
 * @property {{ night?: number, warm?: number }} [ambient]  the two alphas. Default 0.45 and 0.18.
 * @property {number} [depth]      the ambient's depth. Default 790, under the weather at 800.
 * @property {boolean} [auto]      Default true: bound to the scene's update. false leaves
 *   update(delta) to the caller.
 * @property {any} [theme]         a theme handle. Default: read off the element the game booted into.
 */

/**
 * @typedef {object} DayNightHandle
 * @property {() => number} hour          the clock, 0 up to 24
 * @property {() => string} phase         dawn, day, dusk or night
 * @property {() => number} day           how many midnights the clock has passed
 * @property {() => string} weather       the word in effect (under auto, what the forecast chose)
 * @property {(patch: { hour?: number, speed?: number, weather?: string, seed?: number,
 *   lights?: DayNightLight[], lightning?: boolean, phases?: any }) => void} set
 *   hour moves the hands (the day count stays) and fires the boundary events once for where it
 *   landed; weather crossfades; seed rerolls the forecast; lights replaces the lamps.
 * @property {() => void} pause           the clock and the storm stand still; the picture stays
 * @property {() => void} resume
 * @property {(event: 'phase'|'hour'|'day'|'weather'|'lightning', fn: (a?: any, b?: any) => void)
 *   => () => void} on   phase (name, hour) at each boundary; hour (whole hour) at each; day
 *   (count) at midnight; weather (word, previous) at each change; lightning (flashes) at each
 *   strike. Returns the way to stop listening.
 * @property {(delta?: number) => void} update   one frame, delta in ms. Called for you when auto.
 * @property {() => { x: number, y: number, elevation: number, up: boolean }} sunPosition
 *   in viewport units: x 0 at the left edge to 1 at the right over the day arc, y 0 at the top
 *   to 1 at the horizon; at night the same arc runs under the horizon (y over 1, up false), so
 *   a moon can be drawn at its mirror. elevation is -1..1.
 * @property {any} parallax   the parallax handle driven, given or made, or null
 * @property {any} fx         the fx handle used, given or made, or null
 * @property {any} ambient    the overlay rectangle, for a game that wants to read it
 * @property {() => void} destroy   the overlay, the lamps, the weather layer and, when this
 *   handle made them, the parallax and the fx
 */

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
 * The page's two poles, whichever mode it is in: dark is the darker of bg and ink.
 * @param {any} th
 * @returns {{ light: number, dark: number }}
 */
function poles(th) {
  const bgIsLight = luminance(th.bg) >= luminance(th.ink);
  return { light: bgIsLight ? th.bg : th.ink, dark: bgIsLight ? th.ink : th.bg };
}

/** @param {number} h @returns {number} the hour folded into 0 up to 24 */
function wrap(h) {
  return ((h % 24) + 24) % 24;
}

/** @param {number} t @returns {number} 0..1 with a soft start and a soft end */
function smooth(t) {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}

/**
 * The four boundaries, validated: each an hour in 0..24 and in rising order, or the defaults
 * with a warning, because a night that starts before its dusk has no phase at all.
 * @param {any} raw
 * @returns {{ dawn: number, day: number, dusk: number, night: number }}
 */
function normalisePhases(raw) {
  const out = Object.assign({}, DEFAULT_PHASES);
  const q = raw && typeof raw === 'object' ? raw : {};
  for (const name of DAYNIGHT_PHASES) {
    if (typeof q[name] === 'number' && isFinite(q[name])) out[name] = q[name];
  }
  const ok = out.dawn >= 0 && out.dawn < out.day && out.day < out.dusk && out.dusk < out.night && out.night < 24;
  if (ok) return out;
  console.warn('[aimeat-phaser] dayNight: phases want dawn < day < dusk < night, each an hour in 0..24; '
    + 'the defaults (5, 7, 17, 20) are used.');
  return Object.assign({}, DEFAULT_PHASES);
}

/**
 * @param {{ dawn: number, day: number, dusk: number, night: number }} ph
 * @param {number} h
 * @returns {string}
 */
function phaseOf(ph, h) {
  if (h >= ph.night || h < ph.dawn) return 'night';
  if (h < ph.day) return 'dawn';
  if (h < ph.dusk) return 'day';
  return 'dusk';
}

/**
 * The six keyframes the ambient rides through, in hour order. The night hold between the last
 * and the first, across midnight, has the same value at both ends.
 * @param {{ dawn: number, day: number, dusk: number, night: number }} ph
 * @param {number} dark
 * @param {number} warm
 * @param {{ night: number, warm: number }} alphas
 * @returns {Array<{ at: number, colour: number, alpha: number }>}
 */
function keyframes(ph, dark, warm, alphas) {
  return [
    { at: ph.dawn, colour: dark, alpha: alphas.night },
    { at: (ph.dawn + ph.day) / 2, colour: warm, alpha: alphas.warm },
    { at: ph.day, colour: warm, alpha: 0 },
    { at: ph.dusk, colour: warm, alpha: 0 },
    { at: (ph.dusk + ph.night) / 2, colour: warm, alpha: alphas.warm },
    { at: ph.night, colour: dark, alpha: alphas.night },
  ];
}

/**
 * The ambient at an hour: the keyframe pair the hour falls between, blended on a smoothstep.
 * @param {Array<{ at: number, colour: number, alpha: number }>} keys
 * @param {number} h
 * @returns {{ colour: number, alpha: number }}
 */
function ambientAt(keys, h) {
  const last = keys[keys.length - 1];
  if (h < keys[0].at || h >= last.at) return { colour: last.colour, alpha: last.alpha };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (h >= a.at && h < b.at) {
      const t = smooth((h - a.at) / (b.at - a.at));
      return { colour: mix(a.colour, b.colour, t), alpha: a.alpha + (b.alpha - a.alpha) * t };
    }
  }
  return { colour: last.colour, alpha: last.alpha };
}

/**
 * The ambient under less motion: the phase's own value, held until the next boundary.
 * @param {string} phase
 * @param {number} dark
 * @param {number} warm
 * @param {{ night: number, warm: number }} alphas
 * @returns {{ colour: number, alpha: number }}
 */
function ambientStill(phase, dark, warm, alphas) {
  if (phase === 'night') return { colour: dark, alpha: alphas.night };
  if (phase === 'day') return { colour: warm, alpha: 0 };
  return { colour: warm, alpha: alphas.warm };
}

/**
 * The forecast for one hour of one game day. Four rolls from a stream the seed and the day
 * agree on, so the same seed gives the same week on every visit.
 * @param {number} seed
 * @param {number} day
 * @param {string} phase
 * @param {number} hour
 * @param {{ dawn: number, day: number, dusk: number, night: number }} ph
 * @returns {string}
 */
function forecast(seed, day, phase, hour, ph) {
  const roll = rng(((Math.floor(seed) * 1000003) + (day * 7919) + 1) >>> 0);
  const fog = roll();
  const rain = roll();
  const storm = roll();
  const shower = roll();
  if (phase === 'dawn') return fog < FOG_AT_DAWN ? 'fog' : 'clear';
  const evening = phase === 'dusk' || (phase === 'night' && hour >= ph.night);
  if (evening) {
    if (rain < RAIN_IN_EVENING) return storm < STORM_SHARE ? 'storm' : 'rain';
    return 'clear';
  }
  if (phase === 'day') return shower < SHOWER_BY_DAY ? 'rain' : 'clear';
  return 'clear';
}

/**
 * The clock for one scene.
 * @param {any} scene
 * @param {DayNightSpec} [spec]
 * @returns {DayNightHandle}
 */
export function dayNight(scene, spec) {
  const id = nextId++;
  const s = /** @type {any} */ (spec || {});
  const th = s.theme || look(scene);
  const p = poles(th);
  const auto = s.auto !== false;
  const depth = typeof s.depth === 'number' ? s.depth : AMBIENT_DEPTH;
  const alphas = {
    night: s.ambient && typeof s.ambient.night === 'number' ? s.ambient.night : NIGHT_ALPHA,
    warm: s.ambient && typeof s.ambient.warm === 'number' ? s.ambient.warm : WARM_ALPHA,
  };

  let phases = normalisePhases(s.phases);
  let keys = keyframes(phases, p.dark, th.warn, alphas);
  let hour = wrap(typeof s.hour === 'number' && isFinite(s.hour) ? s.hour : DEFAULT_HOUR);
  let speed = typeof s.speed === 'number' && isFinite(s.speed) ? Math.max(0, s.speed) : DEFAULT_SPEED;
  let seed = typeof s.seed === 'number' && isFinite(s.seed) ? s.seed : 1;
  let lightning = s.lightning !== false;
  let day = 0;
  let phase = phaseOf(phases, hour);
  let paused = false;
  let gone = false;

  /** The weather asked for (a word or auto) and the word in effect. */
  let weatherMode = typeof s.weather === 'string' ? s.weather : 'clear';
  let weatherNow = 'clear';
  /** @type {any} the fx weather layer now falling, or null */
  let layer = null;
  let warnedNoFx = false;

  /** The storm: ms until the next strike (below zero: none due), and the strike under way. */
  let flashIn = -1;
  /** @type {Array<{ ms: number, lit: boolean }>} */
  let flashSteps = [];
  let flashLeft = 0;
  let flashLit = false;
  let flashRoll = rng((seed ^ 0x5bd1e995) >>> 0);

  /** @type {Record<string, Array<(a?: any, b?: any) => void>>} */
  const listeners = { phase: [], hour: [], day: [], weather: [], lightning: [] };

  /** The word the parallax was last told, so a boundary is one set() and never two. */
  /** @type {'day'|'dusk'|'night'|null} */
  let timeWord = null;
  let px = s.parallax || null;
  let fxh = s.fx || null;
  const made = { parallax: false, fx: false };
  if (s.create) {
    if (!px) {
      timeWord = PHASE_TIME[phase];
      px = parallax(scene, { preset: s.preset || 'hills', time: timeWord, seed: seed, theme: th });
      made.parallax = true;
    }
    if (!fxh) {
      fxh = fx(scene, { theme: th });
      made.fx = true;
    }
  }

  /** @type {any} the ambient rectangle */
  let rect = null;
  /** @type {Array<{ image: any, alpha: number }>} */
  let lamps = [];
  /** @type {string[]} lamp textures this handle made */
  const textures = [];
  let lastColour = -1;
  let lastAlpha = -1;

  /** @returns {{ w: number, h: number }} */
  function viewport() {
    const cam = scene.cameras && scene.cameras.main;
    const w = (scene.scale && scene.scale.width) || (cam && cam.width) || 960;
    const h = (scene.scale && scene.scale.height) || (cam && cam.height) || 540;
    return { w: w, h: h };
  }

  /** @returns {number} Phaser's additive blend, without needing the engine on the page to say so */
  function addBlend() {
    const P = typeof window !== 'undefined' ? /** @type {any} */ (window).Phaser : undefined;
    return P && P.BlendModes && typeof P.BlendModes.ADD === 'number' ? P.BlendModes.ADD : 1;
  }

  /**
   * @param {string} name
   * @param {any} [a]
   * @param {any} [b]
   */
  function emit(name, a, b) {
    for (const fn of listeners[name].slice()) fn(a, b);
  }

  /* ── The parallax ──────────────────────────────────────────────────────────────────────── */

  /** The parallax wears the phase's word, when it is not wearing it already. */
  function applyTime() {
    const word = PHASE_TIME[phase];
    if (word === timeWord) return;
    timeWord = word;
    if (px && typeof px.set === 'function') px.set({ time: word });
  }

  /* ── The weather ───────────────────────────────────────────────────────────────────────── */

  function scheduleFlash() {
    flashIn = lightning ? FLASH_GAP_MIN + flashRoll() * (FLASH_GAP_MAX - FLASH_GAP_MIN) : -1;
  }

  function endStorm() {
    flashIn = -1;
    flashSteps = [];
    flashLit = false;
  }

  /**
   * Put a weather word into effect: the old layer drains, the new one starts.
   * @param {string} word
   */
  function applyWeather(word) {
    if (!Object.prototype.hasOwnProperty.call(WEATHER_LAYERS, word)) {
      console.warn('[aimeat-phaser] dayNight: no weather is named "' + word + '". The words are '
        + DAYNIGHT_WEATHERS.join(', ') + '; clear is used.');
      word = 'clear';
    }
    if (word === weatherNow) return;
    const previous = weatherNow;
    weatherNow = word;
    if (layer) {
      layer.stop();
      layer = null;
    }
    const recipe = WEATHER_LAYERS[word];
    if (recipe && fxh && typeof fxh.weather === 'function') {
      /** @type {any} */
      const opts = {};
      if (typeof recipe.density === 'number') opts.density = recipe.density;
      if (typeof recipe.wind === 'number') opts.wind = recipe.wind;
      layer = fxh.weather(recipe.kind, opts) || null;
    } else if (recipe && !fxh && !warnedNoFx) {
      warnedNoFx = true;
      console.warn('[aimeat-phaser] dayNight: weather "' + word + '" was asked for with no fx handle '
        + '(pass fx, or create: true), so the schedule runs and nothing falls.');
    }
    if (word === 'storm') scheduleFlash();
    else endStorm();
    emit('weather', word, previous);
  }

  /** What the mode says the weather is now: the word itself, or the forecast under auto. */
  function wantedWeather() {
    return weatherMode === 'auto' ? forecast(seed, day, phase, hour, phases) : weatherMode;
  }

  /**
   * The storm's clock: count down to the next strike, and step the strike under way.
   * @param {number} dt  ms
   * @param {boolean} still
   */
  function stormStep(dt, still) {
    if (flashSteps.length) {
      flashLeft -= dt;
      if (flashLeft > 0) return;
      flashSteps.shift();
      if (flashSteps.length) {
        flashLeft = flashSteps[0].ms;
        flashLit = flashSteps[0].lit;
      } else {
        flashLit = false;
        if (weatherNow === 'storm') scheduleFlash();
      }
      return;
    }
    if (flashIn < 0) return;
    flashIn -= dt;
    if (flashIn > 0) return;
    flashIn = -1;
    const steps = still ? STILL_FLASH_STEPS : FLASH_STEPS;
    flashSteps = steps.map(function (step) { return { ms: step.ms, lit: step.lit }; });
    flashLeft = flashSteps[0].ms;
    flashLit = true;
    emit('lightning', still ? 1 : 2);
  }

  /* ── The clock ─────────────────────────────────────────────────────────────────────────── */

  /**
   * Move the hands. A frame's advance fires every whole hour it crossed and a midnight it passed;
   * a jump fires the hour and the phase once, for where it landed.
   * @param {number} next   the hour to land on, unwrapped for a frame, 0..24 for a jump
   * @param {boolean} jump
   */
  function advance(next, jump) {
    const before = hour;
    const wholeBefore = Math.floor(before);
    let hourChanged = false;
    if (jump) {
      hour = wrap(next);
      if (Math.floor(hour) !== wholeBefore) {
        hourChanged = true;
        emit('hour', Math.floor(hour));
      }
    } else {
      let raw = next;
      const crossed = Math.min(HOUR_EVENTS_CAP, Math.floor(raw) - wholeBefore);
      while (raw >= 24) {
        raw -= 24;
        day += 1;
        emit('day', day);
      }
      hour = raw;
      for (let k = 1; k <= crossed; k++) {
        hourChanged = true;
        emit('hour', (wholeBefore + k) % 24);
      }
    }
    const ph = phaseOf(phases, hour);
    const phaseChanged = ph !== phase;
    if (phaseChanged) {
      phase = ph;
      applyTime();
      emit('phase', ph, hour);
    }
    if (weatherMode === 'auto' && (hourChanged || phaseChanged)) applyWeather(wantedWeather());
  }

  /* ── The picture ───────────────────────────────────────────────────────────────────────── */

  function buildAmbient() {
    if (!scene.add || typeof scene.add.rectangle !== 'function') return;
    const view = viewport();
    rect = scene.add.rectangle(0, 0, view.w, view.h, p.dark, 0);
    rect.setOrigin(0, 0).setScrollFactor(0).setDepth(depth).setVisible(false);
  }

  /**
   * One radial disc of one tone, drawn once per tone and kept on the texture manager.
   * @param {number} colour
   * @returns {string|null}
   */
  function lightTexture(colour) {
    if (!scene.textures || typeof scene.textures.createCanvas !== 'function') return null;
    const key = 'ak-daynight-' + id + '-light-' + ((colour >>> 0) & 0xffffff).toString(16);
    if (scene.textures.exists(key)) return key;
    const tex = scene.textures.createCanvas(key, LIGHT_TEXTURE, LIGHT_TEXTURE);
    if (!tex) return null;
    const ctx = typeof tex.getContext === 'function' ? tex.getContext() : tex.context;
    const half = LIGHT_TEXTURE / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, css(colour, 1));
    grad.addColorStop(0.35, css(colour, 0.55));
    grad.addColorStop(1, css(colour, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, LIGHT_TEXTURE, LIGHT_TEXTURE);
    if (typeof tex.refresh === 'function') tex.refresh();
    textures.push(key);
    return key;
  }

  function clearLights() {
    for (const L of lamps) if (L.image && typeof L.image.destroy === 'function') L.image.destroy();
    lamps = [];
  }

  /**
   * The lamps, replaced as a set.
   * @param {any} list
   */
  function buildLights(list) {
    clearLights();
    if (!Array.isArray(list) || !scene.add || typeof scene.add.image !== 'function') return;
    for (const raw of list) {
      if (!raw || typeof raw.x !== 'number' || typeof raw.y !== 'number') continue;
      const key = lightTexture(tone(th, p, raw.tone, th.warn));
      if (!key) continue;
      const radius = typeof raw.radius === 'number' && raw.radius > 0 ? raw.radius : LIGHT_RADIUS;
      const image = scene.add.image(raw.x, raw.y, key);
      image.setOrigin(0.5, 0.5).setDepth(depth + (LIGHT_DEPTH - AMBIENT_DEPTH))
        .setDisplaySize(radius * 2, radius * 2).setAlpha(0).setVisible(false);
      if (typeof image.setBlendMode === 'function') image.setBlendMode(addBlend());
      if (typeof raw.scrollFactor === 'number') image.setScrollFactor(raw.scrollFactor);
      lamps.push({ image: image, alpha: typeof raw.alpha === 'number' ? Math.max(0, Math.min(1, raw.alpha)) : LIGHT_ALPHA });
    }
  }

  /**
   * The ambient and the lamps for this frame.
   * @param {boolean} still
   */
  function paint(still) {
    const a = still ? ambientStill(phase, p.dark, th.warn, alphas) : ambientAt(keys, hour);
    let colour = a.colour;
    let alpha = a.alpha;
    if (flashLit) {
      colour = p.light;
      alpha = Math.max(alpha, still ? STILL_FLASH_ALPHA : FLASH_ALPHA);
    }
    if (rect && (colour !== lastColour || alpha !== lastAlpha)) {
      lastColour = colour;
      lastAlpha = alpha;
      rect.setFillStyle(colour, alpha);
      rect.setVisible(alpha > 0);
    }
    const dark = alphas.night > 0 ? Math.min(1, a.alpha / alphas.night) : 0;
    for (const L of lamps) {
      L.image.setAlpha(dark * L.alpha);
      L.image.setVisible(dark > 0.001);
    }
  }

  /**
   * One frame.
   * @param {number} deltaMs
   */
  function step(deltaMs) {
    if (gone) return;
    const dt = typeof deltaMs === 'number' && isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    const still = reducedMotion();
    if (!paused) {
      if (speed > 0 && dt > 0) advance(hour + (speed * dt) / 1000, false);
      stormStep(dt, still);
    }
    paint(still);
  }

  /**
   * @param {number} _time
   * @param {number} delta
   */
  function onUpdate(_time, delta) {
    step(delta);
  }

  function onResize() {
    if (gone || !rect) return;
    const view = viewport();
    if (typeof rect.setSize === 'function') rect.setSize(view.w, view.h);
    if (typeof rect.setPosition === 'function') rect.setPosition(0, 0);
  }

  /** @type {DayNightHandle} */
  const api = {
    hour() { return hour; },
    phase() { return phase; },
    day() { return day; },
    weather() { return weatherNow; },
    parallax: px,
    fx: fxh,
    get ambient() { return rect; },

    set(patch) {
      if (gone) return;
      const q = /** @type {any} */ (patch || {});
      if (typeof q.speed === 'number' && isFinite(q.speed)) speed = Math.max(0, q.speed);
      if (typeof q.lightning === 'boolean') {
        lightning = q.lightning;
        if (weatherNow === 'storm') {
          if (!lightning) endStorm();
          else if (flashIn < 0 && !flashSteps.length) scheduleFlash();
        }
      }
      if (typeof q.seed === 'number' && isFinite(q.seed)) {
        seed = q.seed;
        flashRoll = rng((seed ^ 0x5bd1e995) >>> 0);
      }
      if (q.phases) {
        phases = normalisePhases(q.phases);
        keys = keyframes(phases, p.dark, th.warn, alphas);
      }
      if (q.lights !== undefined) buildLights(q.lights);
      if (typeof q.hour === 'number' && isFinite(q.hour)) {
        advance(q.hour, true);
      } else if (q.phases) {
        advance(hour, true);
      }
      if (typeof q.weather === 'string') weatherMode = q.weather;
      if (typeof q.weather === 'string' || typeof q.seed === 'number') applyWeather(wantedWeather());
      paint(reducedMotion());
    },

    pause() { paused = true; },
    resume() { paused = false; },

    on(event, fn) {
      const bucket = listeners[event];
      if (!bucket) {
        console.warn('[aimeat-phaser] dayNight: no event is named "' + event + '". The events are '
          + Object.keys(listeners).join(', ') + '.');
        return function () { /* nothing was registered */ };
      }
      if (typeof fn !== 'function') return function () { /* nothing was registered */ };
      bucket.push(fn);
      return function () {
        const at = bucket.indexOf(fn);
        if (at >= 0) bucket.splice(at, 1);
      };
    },

    update(delta) {
      step(typeof delta === 'number' ? delta : 0);
    },

    sunPosition() {
      const rise = phases.dawn;
      const set = phases.night;
      const daySpan = set - rise;
      const t = (hour - rise) / daySpan;
      if (t >= 0 && t <= 1) {
        const e = Math.sin(t * Math.PI);
        return { x: t, y: 1 - e * SUN_ARC, elevation: e, up: true };
      }
      const u = wrap(hour - set) / (24 - daySpan);
      const e = Math.sin(u * Math.PI);
      return { x: u, y: 1 + e * SUN_ARC, elevation: 0 - e, up: false };
    },

    destroy() {
      if (gone) return;
      gone = true;
      if (scene.events && typeof scene.events.off === 'function') {
        scene.events.off('update', onUpdate);
        scene.events.off('shutdown', api.destroy);
      }
      if (auto && scene.scale && typeof scene.scale.off === 'function') scene.scale.off('resize', onResize);
      for (const name in listeners) listeners[name].length = 0;
      endStorm();
      if (layer) {
        layer.stop();
        layer = null;
      }
      clearLights();
      for (const key of textures) {
        if (scene.textures && scene.textures.exists(key)) scene.textures.remove(key);
      }
      textures.length = 0;
      if (rect && typeof rect.destroy === 'function') rect.destroy();
      rect = null;
      if (made.parallax && px && typeof px.destroy === 'function') px.destroy();
      if (made.fx && fxh && typeof fxh.destroy === 'function') fxh.destroy();
    },
  };

  buildAmbient();
  buildLights(s.lights);
  applyTime();
  applyWeather(wantedWeather());
  paint(reducedMotion());

  if (auto && scene.events && typeof scene.events.on === 'function') scene.events.on('update', onUpdate);
  if (auto && scene.scale && typeof scene.scale.on === 'function') scene.scale.on('resize', onResize);
  if (scene.events && typeof scene.events.once === 'function') scene.events.once('shutdown', api.destroy);

  return api;
}
