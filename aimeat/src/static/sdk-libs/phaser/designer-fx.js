/**
 * @file phaser/designer-fx.js
 * @description The particle designer: fx.js's presets as a panel of sliders beside the canvas, so
 *   an effect is tuned by looking at it rather than by editing a number, reloading and guessing.
 *
 *   IT IS DOM ON PURPOSE. A slider, a picker and a switch are controls the browser and every
 *   assistive technology already understand; drawing them into the canvas would cost the labels,
 *   the focus ring and the keyboard for a uniform look. So the stage is the canvas and the panel
 *   is a page, on the same --ak-* tokens.
 *
 *   THE PANEL OWNS ONE TEMPORARY PRESET. Every change is written into a preset of the shape
 *   fx-presets.js uses, registered under a name of the panel's own with fx.define(), and fired
 *   again through the same door a game uses: fx.at(), fx.weather() or fx.follow(). So what the
 *   person sees is what the copied code will draw, and there is no second renderer to drift.
 *
 *   ONLY WHAT WAS TOUCHED IS WRITTEN. The preset's own config is the floor and a slider lays its
 *   value over it, so an untouched alpha curve stays the preset's curve (fog's four-point fade
 *   cannot be said with two sliders) and the exported config is the preset plus the changes.
 *
 *   A TINT IS AN OPTION ON THE STAGE AND A COLOUR LIST IN THE CODE. Live, the colour word rides
 *   the call as colour: word, which is what lets a weather layer take it through set() without a
 *   rebuild; the copied define() carries it as colours: [word] so the pasted preset stands alone.
 *   Both draw the same one-colour strip.
 *
 *   NOTHING MOVES IN THE PANEL. No transition, no animation: the less-motion switch has the
 *   effect it has on the stage (fx.js answers it per family) and none here.
 * @structure the tables (FAMILIES, WORDS, CONTROLS) · readPair / pairMode / writePair / top ·
 *   baseOf · fxDesigner(spec) → { el, definition, code, play, stop, reset, destroy }
 * @usage  const panel = AIMEAT.phaser.fxDesigner({ target: '#tools', fx: fx, scene: this,
 *           family: 'at', preset: 'sparks', x: 480, y: 270 });
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the preset picker, the sliders per family, tint and additive,
 *     Play / Stop / Reset to preset, Copy as JS and Export JSON.
 */
import { el, clear, resolve, uid } from '../atelier/dom.js';
import { PRESETS, ALIASES } from './fx-presets.js';
import { merge } from './fx-parts.js';
import {
  rangeField, pairField, selectField, toggleField, button, notes, copyText, toSource, quote,
} from './designer-parts.js';

/** The three families and the word the panel shows for each. */
const FAMILIES = { at: 'Bursts', weather: 'Weather', follow: 'Follow' };

/** The words a tint may be: every one a colour boot.js reads off the theme, so fx.js's tone()
 *  resolves it. (light and dark are parallax words; fx has no such poles.) */
const WORDS = ['accent', 'ink', 'inkDim', 'ok', 'warn', 'err', 'ch1', 'ch2', 'ch3', 'ch4', 'surface', 'bg', 'line'];

/** The prefix of the panel's own preset names, kept out of the picker. */
const TEMP = 'ak-designer';

/** How often a burst is fired again while a slider is being dragged, in ms. */
const BURST_PACE = 160;

/** What fx.preset() adds to a config that is not the preset's own. */
const ASSEMBLED = { texture: 1, frame: 1, emitting: 1, emitZone: 1, deathZone: 1 };

/** Where a preset's config keys go when no family is given. */
const DEFAULT_COUNT = 12;

/**
 * @typedef {object} Control
 * @property {string} key       the emitter config key, or count / density / wind
 * @property {string} label
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {string} [unit]
 * @property {'range'|'life'} [pair]  two sliders: a random range (min / max) or a value over the
 *   particle's life (start / end). The preset's own shape wins when it has one.
 * @property {string[]} families
 * @property {boolean} [radial]  only when the preset moves by speed and angle, not speedX / speedY
 */

/** @type {Control[]} */
const CONTROLS = [
  { key: 'count', label: 'Particles per burst', min: 1, max: 120, step: 1, families: ['at'] },
  { key: 'density', label: 'Density', min: 0, max: 3, step: 0.05, families: ['weather', 'follow'] },
  { key: 'wind', label: 'Wind', min: -300, max: 300, step: 5, unit: ' px/s', families: ['weather'] },
  { key: 'speed', label: 'Speed', pair: 'range', min: 0, max: 800, step: 5, unit: ' px/s', families: ['at', 'weather', 'follow'] },
  { key: 'angle', label: 'Angle', pair: 'range', min: -360, max: 360, step: 5, unit: ' deg', families: ['at', 'weather', 'follow'], radial: true },
  { key: 'lifespan', label: 'Lifespan', pair: 'range', min: 50, max: 10000, step: 50, unit: ' ms', families: ['at', 'weather', 'follow'] },
  { key: 'scale', label: 'Scale', pair: 'life', min: 0, max: 4, step: 0.05, families: ['at', 'weather', 'follow'] },
  { key: 'alpha', label: 'Alpha', pair: 'life', min: 0, max: 1, step: 0.05, families: ['at', 'weather', 'follow'] },
  { key: 'gravityY', label: 'Gravity', min: -800, max: 800, step: 10, families: ['at', 'weather', 'follow'] },
  { key: 'rotate', label: 'Rotation', pair: 'range', min: -360, max: 360, step: 5, unit: ' deg', families: ['at', 'weather', 'follow'] },
  { key: 'quantity', label: 'Particles per emission', min: 1, max: 20, step: 1, families: ['follow'] },
  { key: 'frequency', label: 'Time between emissions', min: 0, max: 1000, step: 5, unit: ' ms', families: ['follow'] },
];

/**
 * A config value as the two numbers a pair of sliders shows. A curve of several values is read
 * as its peak and its last value, which is the nearest two sliders can say.
 * @param {any} value
 * @returns {[number, number]}
 */
export function readPair(value) {
  if (typeof value === 'number') return [value, value];
  if (value && typeof value === 'object') {
    if (typeof value.start === 'number') return [value.start, typeof value.end === 'number' ? value.end : value.start];
    if (typeof value.min === 'number') return [value.min, typeof value.max === 'number' ? value.max : value.min];
    if (Array.isArray(value.values) && value.values.length) {
      return [Math.max.apply(null, value.values), value.values[value.values.length - 1]];
    }
  }
  return [0, 0];
}

/**
 * How a pair is written back: the shape the preset already uses, else the control's own.
 * @param {any} value
 * @param {'range'|'life'} fallback
 * @returns {'range'|'life'}
 */
export function pairMode(value, fallback) {
  if (value && typeof value === 'object') {
    if (typeof value.start === 'number') return 'life';
    if (typeof value.min === 'number') return 'range';
  }
  return fallback;
}

/**
 * @param {'range'|'life'} mode
 * @param {number} a
 * @param {number} b
 * @returns {any}
 */
export function writePair(mode, a, b) {
  return mode === 'life' ? { start: a, end: b } : { min: Math.min(a, b), max: Math.max(a, b) };
}

/** The larger of a pair value. @param {any} value @returns {number} */
function top(value) {
  const pair = readPair(value);
  return Math.max(pair[0], pair[1]);
}

/**
 * The preset a name stands for, in the shape fx-presets.js uses: a built-in through its alias,
 * or an app's own preset read back from the config fx.preset() assembles for it. The read-back
 * keeps the texture the app's preset already drew, so a tint has nothing to apply to there.
 * @param {any} fx
 * @param {string} name
 * @param {string} family
 * @returns {any|null}
 */
function baseOf(fx, name, family) {
  const known = PRESETS[ALIASES[name] || name];
  if (known && known[family]) return known;
  const cfg = typeof fx.preset === 'function' ? fx.preset(name, family) : null;
  if (!cfg || typeof cfg !== 'object') return null;
  /** @type {any} */
  const config = {};
  for (const key in cfg) if (!ASSEMBLED[key]) config[key] = cfg[key];
  /** @type {any} */
  const fam = { life: top(config.lifespan) || 1000, config: config };
  if (family === 'at') fam.count = DEFAULT_COUNT;
  if (family === 'weather') {
    fam.zone = 'top';
    fam.rate = (1000 / Math.max(1, Number(config.frequency) || 1000)) * (Number(config.quantity) || 1);
    delete config.frequency;
    delete config.quantity;
  }
  /** @type {any} */
  const out = { texture: cfg.texture };
  if (cfg.frame !== undefined) out.frame = cfg.frame;
  out[family] = fam;
  return out;
}

/**
 * @typedef {object} FxDesignerSpec
 * @property {Element|string} target
 * @property {any} fx            the handle from AIMEAT.phaser.fx(scene)
 * @property {any} [scene]       for where a burst lands when x and y are not given: the camera's centre
 * @property {'at'|'weather'|'follow'} [family]  Default at.
 * @property {string} [preset]   the preset to open on. Default: the first the family has.
 * @property {number} [x]        where a burst is fired and a follow emitter stands
 * @property {number} [y]
 * @property {any} [follow]      the game object a follow emitter rides. Default: a still point at x, y.
 * @property {(change: { family: string, preset: string, definition: any, options: any,
 *   code: string }) => void} [onChange]  after every change that reached the stage
 */

/**
 * The particle designer.
 * @param {FxDesignerSpec} spec
 * @returns {{ el: HTMLElement, definition: () => any, code: () => string, play: () => void,
 *   stop: () => void, reset: () => void, destroy: () => void }}
 */
export function fxDesigner(spec) {
  const s = spec || /** @type {any} */ ({});
  const fx = s.fx;
  if (!fx || typeof fx.define !== 'function') {
    throw new Error('fxDesigner wants the fx handle: pass fx: AIMEAT.phaser.fx(scene).');
  }
  const family = FAMILIES[s.family] ? s.family : 'at';
  const temp = uid(TEMP);
  const root = el('div', { class: 'ak-root ak-designer ak-designer--fx' });
  resolve(s.target, document.body).appendChild(root);

  /** @type {any} the preset being tuned: base, touched config keys, and the settings outside it */
  let state = null;
  /** @type {any} the weather layer or follow emitter now standing */
  let standing = null;
  /** @type {any} the last burst's emitter */
  let burst = null;
  /** @type {any} the drag pacer's timeout */
  let timer = null;
  let gone = false;

  // ── The preset ───────────────────────────────────────────────────────────────────────────────

  /** The names the picker offers: what fx knows for this family, the panel's own left out. */
  function kindsOf() {
    const list = typeof fx.kinds === 'function' ? fx.kinds(family) : Object.keys(PRESETS);
    return list.filter(function (name) { return name.indexOf(TEMP + '-') !== 0; });
  }

  /**
   * A fresh state on a base.
   * @param {string} name
   * @param {any} base
   * @returns {any}
   */
  function fresh(name, base) {
    const fam = base[family] || {};
    return {
      name: name, base: base, touched: {},
      count: typeof fam.count === 'number' ? fam.count : DEFAULT_COUNT,
      density: 1,
      wind: typeof fam.wind === 'number' ? fam.wind : 0,
      tint: '', additive: false,
    };
  }

  /** The preset's own config for this family. @returns {any} */
  function baseConfig() {
    return (state.base[family] && state.base[family].config) || {};
  }

  /** A config key as it stands: the slider's value when touched, else the preset's. */
  function current(key) {
    return state.touched[key] !== undefined ? state.touched[key] : baseConfig()[key];
  }

  /** The preset moves by speedX / speedY (a weather layer falls) rather than by speed and angle. */
  function directional() {
    const cfg = baseConfig();
    return cfg.speedY !== undefined && cfg.speed === undefined;
  }

  /**
   * The preset as fx.define() takes it. Live, the colours are the preset's own and the tint
   * rides the call; for the code, the tint is the colour list.
   * @param {boolean} forExport
   * @returns {any}
   */
  function definition(forExport) {
    const base = state.base;
    const fam = merge(base[family]);
    const config = merge(fam.config, state.touched);
    if (state.additive) config.blendMode = 'ADD';
    fam.config = config;
    if (family === 'at') fam.count = state.count;
    if (state.touched.lifespan !== undefined) fam.life = top(state.touched.lifespan);
    /** @type {any} */
    const def = {};
    if (base.texture) {
      def.texture = base.texture;
      if (base.frame !== undefined) def.frame = base.frame;
    } else {
      def.shape = base.shape || 'dot';
    }
    def.colours = forExport && state.tint ? [state.tint] : (base.colours || ['accent']).slice();
    def[family] = fam;
    return def;
  }

  /** The options the live call takes. @returns {any} */
  function liveOptions() {
    /** @type {any} */
    const o = { colour: state.tint || undefined };
    if (family === 'weather') { o.density = state.density; o.wind = state.wind; }
    if (family === 'follow') o.density = state.density;
    return o;
  }

  /** The options the copied call needs: only what differs from the preset. @returns {any|null} */
  function exportOptions() {
    /** @type {any} */
    const o = {};
    if (family !== 'at' && state.density !== 1) o.density = state.density;
    if (family === 'weather' && state.wind !== state.base.weather.wind && !(state.wind === 0 && state.base.weather.wind == null)) {
      o.wind = state.wind;
    }
    return Object.keys(o).length ? o : null;
  }

  /** The define() and the call, as a person pastes them. @returns {string} */
  function code() {
    const name = quote('my-' + state.name);
    const opts = exportOptions();
    const tail = opts ? ', ' + toSource(opts, 0) : '';
    const lines = ['fx.define(' + name + ', ' + toSource(definition(true), 0) + ');'];
    if (family === 'at') lines.push('fx.at(x, y, ' + name + tail + ');');
    else if (family === 'weather') lines.push('const sky = fx.weather(' + name + tail + ');');
    else lines.push('const rider = fx.follow(target, ' + name + tail + ');');
    return lines.join('\n');
  }

  /** The same, as JSON. @returns {string} */
  function json() {
    return JSON.stringify({
      preset: 'my-' + state.name, family: family, definition: definition(true), options: exportOptions() || {},
    }, null, 2);
  }

  // ── The stage ────────────────────────────────────────────────────────────────────────────────

  /** Where a burst lands: the spec's point, else the camera's centre, else the origin. */
  function where() {
    if (typeof s.x === 'number' && typeof s.y === 'number') return { x: s.x, y: s.y };
    const cam = s.scene && s.scene.cameras && s.scene.cameras.main;
    if (cam) return { x: (cam.scrollX || 0) + cam.width / 2, y: (cam.scrollY || 0) + cam.height / 2 };
    return { x: 0, y: 0 };
  }

  /** Fire the temporary preset through the family's own door. */
  function fire() {
    const at = where();
    if (family === 'at') {
      burst = fx.at(at.x, at.y, temp, liveOptions()) || null;
    } else if (family === 'weather') {
      // fx drains the layer before this one on its own: one weather at a time.
      standing = fx.weather(temp, liveOptions()) || null;
    } else {
      if (standing) standing.stop();
      standing = fx.follow(s.follow || at, temp, liveOptions()) || null;
    }
  }

  function cancelQueue() {
    if (timer == null) return;
    clearTimeout(timer);
    timer = null;
  }

  /** A burst again, at most every BURST_PACE ms, while a slider is dragged. */
  function queue() {
    if (family !== 'at' || timer != null) return;
    timer = setTimeout(function () {
      timer = null;
      if (!gone) apply('drag');
    }, BURST_PACE);
  }

  /**
   * Put the change on the stage. A standing layer takes density, wind and colour through set()
   * without a rebuild; everything else re-registers the preset and fires it again.
   * @param {string} key  what changed
   */
  function apply(key) {
    cancelQueue();
    fx.define(temp, definition(false));
    const cheap = standing && standing.active !== false && family !== 'at'
      && (key === 'density' || key === 'wind' || key === 'tint');
    if (cheap) standing.set(liveOptions());
    else fire();
    tell();
  }

  function tell() {
    if (typeof s.onChange !== 'function') return;
    try {
      s.onChange({ family: family, preset: state.name, definition: definition(true), options: exportOptions(), code: code() });
    } catch (err) {
      console.warn('[aimeat-phaser] an fxDesigner onChange listener threw:', err);
    }
  }

  /** Take a burst down before its particles have died. @param {any} emitter */
  function kill(emitter) {
    if (!emitter || emitter.scene === undefined) return;
    if (typeof emitter.killAll === 'function') emitter.killAll();
    if (typeof emitter.stop === 'function') emitter.stop();
  }

  // ── The panel ────────────────────────────────────────────────────────────────────────────────

  const head = el('div', { class: 'ak-designer__head' });
  const grid = el('div', { class: 'ak-designer__grid' });
  const names = kindsOf();
  const opening = names.indexOf(s.preset) >= 0 ? s.preset : names[0];
  const picker = selectField(head, {
    label: 'Preset', value: opening || '',
    options: names.map(function (name) { return { value: name, text: name }; }),
    onChange: choose,
  });
  head.appendChild(el('p', { class: 'ak-designer__caption', text: FAMILIES[family] }));
  root.appendChild(head);
  root.appendChild(grid);
  root.appendChild(el('div', { class: 'ak-designer__bar' }, [
    button('Play', play, { primary: true }),
    button('Stop', stop),
    button('Reset to preset', reset),
    el('span', { class: 'ak-designer__push' }),
    button('Copy as JS', copy),
    button('Export JSON', exportJson),
  ]));
  const note = notes(root);

  /**
   * One slider or pair, bound to a key of the state or the config.
   * @param {Control} c
   */
  function control(c) {
    const key = c.key === 'speed' && directional() ? 'speedY' : c.key;
    const label = key === 'speedY' ? 'Vertical speed' : c.label;
    const setting = key === 'count' || key === 'density' || key === 'wind';
    /** @param {number} v */
    const write = function (v) {
      if (setting) state[key] = v;
      else state.touched[key] = v;
    };
    if (c.pair) {
      const mode = pairMode(baseConfig()[key], c.pair);
      pairField(grid, {
        label: label, words: mode === 'life' ? ['start', 'end'] : ['min', 'max'],
        min: key === 'speedY' ? -c.max : c.min, max: c.max, step: c.step, unit: c.unit,
        value: readPair(current(key)),
        onInput: function (v) { state.touched[key] = writePair(mode, v[0], v[1]); queue(); },
        onChange: function (v) { state.touched[key] = writePair(mode, v[0], v[1]); apply(key); },
      });
      return;
    }
    const value = setting ? state[key] : current(key);
    rangeField(grid, {
      label: label,
      min: c.min, max: c.max, step: c.step, unit: c.unit,
      value: typeof value === 'number' ? value : 0,
      onInput: function (v) { write(v); queue(); },
      onChange: function (v) { write(v); apply(key); },
    });
  }

  /** Draw the sliders for the preset in hand. */
  function buildGrid() {
    clear(grid);
    for (const c of CONTROLS) {
      if (c.families.indexOf(family) < 0) continue;
      if (c.radial && directional()) continue;
      control(c);
    }
    selectField(grid, {
      label: 'Colour', value: state.tint,
      options: [{ value: '', text: "The preset's own" }].concat(WORDS.map(function (w) { return { value: w, text: w }; })),
      onChange: function (v) { state.tint = v; apply('tint'); },
    });
    toggleField(grid, {
      label: 'Additive blend', checked: state.additive,
      onChange: function (on) { state.additive = on; apply('additive'); },
    });
  }

  /** Open a preset. @param {string} name */
  function choose(name) {
    const base = baseOf(fx, name, family);
    if (!base) {
      note.say('The preset "' + name + '" has no ' + FAMILIES[family].toLowerCase() + ' form. Pick another.');
      if (state) picker.set(state.name);
      return;
    }
    state = fresh(name, base);
    picker.set(name);
    buildGrid();
    note.say('');
    apply('preset');
  }

  function play() {
    if (!state) return;
    fx.define(temp, definition(false));
    fire();
    note.say('');
  }

  function stop() {
    if (standing) { standing.stop(); standing = null; }
    if (burst) { kill(burst); burst = null; }
    cancelQueue();
    note.say('Stopped. Play fires it again.');
  }

  function reset() {
    if (!state) return;
    state = fresh(state.name, state.base);
    buildGrid();
    apply('reset');
    note.say('Back to the preset.');
  }

  function copy() {
    if (!state) return;
    const text = code();
    copyText(text).then(function (ok) {
      if (gone) return;
      if (ok) {
        note.say('Copied. Paste it into your scene.');
        return;
      }
      note.show(text);
      note.say('This browser keeps the clipboard closed. The code is in the box below.');
    });
  }

  function exportJson() {
    if (!state) return;
    note.show(json());
    note.say('The preset as JSON is in the box below.');
  }

  const api = {
    el: root,

    /** The preset as the code writes it, tint included. @returns {any} */
    definition() {
      return state ? definition(true) : null;
    },

    /** The define() and the call line. @returns {string} */
    code() {
      return state ? code() : '';
    },

    play: play,
    stop: stop,
    reset: reset,

    destroy() {
      if (gone) return;
      gone = true;
      cancelQueue();
      if (standing) { standing.stop(); standing = null; }
      burst = null;
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };

  if (opening) choose(opening);
  else note.say('fx has no preset with a ' + FAMILIES[family].toLowerCase() + ' form. Define one first.');
  return api;
}
