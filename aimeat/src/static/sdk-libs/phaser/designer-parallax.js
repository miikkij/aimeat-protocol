/**
 * @file phaser/designer-parallax.js
 * @description The backdrop designer: a parallax stack as a panel of rows beside the canvas, one
 *   per layer, so a world behind a game is composed by looking at it rather than by editing a
 *   list of numbers and reloading.
 *
 *   THE HANDLE IS THE TRUTH. Every change goes through handle.set() or layer(name).set(), the
 *   same doors a game uses, and after each one the rows are re-read from handle.layers, whose
 *   specs carry every default filled in. So the panel never keeps a copy of the stack that can
 *   drift from what is drawn; the four things it does keep (preset, time, seed, drift) are the
 *   ones the handle does not report, and the spec may seed them from the game's own call.
 *
 *   VISIBLE IS A PREVIEW, REMOVE IS THE DECISION. A hidden layer stays in the stack and is put
 *   back to hidden after every rebuild, because set() draws the sprites again; the copied code
 *   leaves hidden layers out, so what is pasted is what was seen, and the status line says how
 *   many were left out.
 *
 *   THE CODE IS THE SHORTEST SPEC THAT DRAWS THE SAME PICTURE. A layer is written as its kind
 *   plus what differs from the kind's own defaults; the depth the handle numbered is dropped,
 *   because the order of the array says it.
 *
 *   NOTHING MOVES IN THE PANEL. No transition, no animation: the less-motion switch reaches the
 *   stage (parallax.js stops its drift and twinkle) and not the panel.
 * @structure the tables (TONES, TIMES, LAYER_CONTROLS) · word / slim / bare ·
 *   parallaxDesigner(spec) → { el, spec, code, refresh, destroy }
 * @usage  const bg = AIMEAT.phaser.parallax(this, { preset: 'hills', seed: 7 });
 *         const panel = AIMEAT.phaser.parallaxDesigner({ target: '#tools', parallax: bg,
 *           preset: 'hills', seed: 7 });
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the preset, time, seed and drift controls, one row per layer
 *     with tone / scroll / alpha / height / haze / drift / visible / remove, Add layer, Copy as JS
 *     and Export JSON.
 */
import { el, clear, resolve, uid } from '../atelier/dom.js';
import { PARALLAX_PRESETS } from './parallax.js';
import { KINDS, KIND_DEFAULTS } from './parallax-layers.js';
import {
  rangeField, selectField, toggleField, button, notes, copyText, toSource,
} from './designer-parts.js';

/** The words a tone may be: the theme's colours, and the two poles parallax.js reads. */
const TONES = ['bg', 'surface', 'ink', 'inkDim', 'line', 'accent', 'ok', 'warn', 'err',
  'ch1', 'ch2', 'ch3', 'ch4', 'light', 'dark'];

/** The times of day, and the preset's own as the first choice. */
const TIMES = [
  { value: '', text: "The preset's own" },
  { value: 'day', text: 'Day' },
  { value: 'dusk', text: 'Dusk' },
  { value: 'night', text: 'Night' },
];

/** The sliders every layer row carries. */
const LAYER_CONTROLS = [
  { key: 'scroll', label: 'Scroll', min: 0, max: 1, step: 0.01 },
  { key: 'alpha', label: 'Alpha', min: 0, max: 1, step: 0.05 },
  { key: 'height', label: 'Height', min: 0.02, max: 1, step: 0.02 },
  { key: 'haze', label: 'Haze', min: 0, max: 1, step: 0.05 },
  { key: 'drift', label: 'Drift', min: -60, max: 60, step: 1, unit: ' px/s' },
];

/** The fields every layer has; anything else on a spec is a kind's own extra and is kept as is. */
const OWN = { kind: 1, name: 1, scroll: 1, tone: 1, alpha: 1, height: 1, haze: 1, drift: 1, depth: 1 };

/** A rerolled seed is drawn below this. */
const SEED_MAX = 1000000;

/** A kind as a heading. @param {string} kind @returns {string} */
function word(kind) {
  const text = String(kind || '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A layer spec as the shortest thing that draws the same picture: the kind, the name when it is
 * not the kind, what differs from the kind's defaults, and the kind's own extras.
 * @param {any} spec  a built layer's spec, every default filled in
 * @returns {any}
 */
function slim(spec) {
  const d = KIND_DEFAULTS[spec.kind] || /** @type {any} */ ({});
  /** @type {any} */
  const out = { kind: spec.kind };
  if (spec.name && spec.name !== spec.kind) out.name = spec.name;
  const sx = spec.scroll && typeof spec.scroll === 'object' ? spec.scroll.x : spec.scroll;
  const sy = spec.scroll && typeof spec.scroll === 'object' ? spec.scroll.y : 0;
  if (sy) out.scroll = { x: sx, y: sy };
  else if (typeof sx === 'number' && sx !== d.scroll) out.scroll = sx;
  for (const key of ['tone', 'alpha', 'height', 'haze', 'drift']) {
    if (spec[key] !== undefined && spec[key] !== d[key]) out[key] = spec[key];
  }
  for (const key in spec) if (!OWN[key] && spec[key] !== undefined) out[key] = spec[key];
  return out;
}

/**
 * A layer spec as the handle takes it back: everything but the depth it numbered itself.
 * @param {any} spec
 * @returns {any}
 */
function bare(spec) {
  /** @type {any} */
  const out = {};
  for (const key in spec) if (key !== 'depth') out[key] = spec[key];
  return out;
}

/**
 * @typedef {object} ParallaxDesignerSpec
 * @property {Element|string} target
 * @property {any} parallax     the handle from AIMEAT.phaser.parallax(scene, spec)
 * @property {string} [preset]  what the handle was built with, since it does not say. Default hills.
 * @property {'day'|'dusk'|'night'} [time]  Default: the preset's own.
 * @property {number} [seed]    Default 1.
 * @property {number} [drift]   Default 1.
 * @property {(change: { spec: any, code: string }) => void} [onChange]  after every change
 */

/**
 * The backdrop designer.
 * @param {ParallaxDesignerSpec} spec
 * @returns {{ el: HTMLElement, spec: () => any, code: () => string, refresh: () => void,
 *   destroy: () => void }}
 */
export function parallaxDesigner(spec) {
  const s = spec || /** @type {any} */ ({});
  const handle = s.parallax;
  if (!handle || typeof handle.set !== 'function' || typeof handle.layer !== 'function') {
    throw new Error('parallaxDesigner wants the parallax handle: pass parallax: AIMEAT.phaser.parallax(scene, spec).');
  }
  const state = {
    preset: PARALLAX_PRESETS.indexOf(s.preset) >= 0 ? s.preset : 'hills',
    time: TIMES.some(function (t) { return t.value === s.time; }) ? s.time : '',
    seed: typeof s.seed === 'number' ? s.seed : 1,
    drift: typeof s.drift === 'number' ? s.drift : 1,
    /** @type {Record<string, boolean>} layer names hidden for a look, still in the stack */
    hidden: {},
  };
  const root = el('div', { class: 'ak-root ak-designer ak-designer--parallax' });
  resolve(s.target, document.body).appendChild(root);
  /** @type {Array<{ name: string, el: HTMLElement, read: (h: any) => void }>} */
  let rows = [];
  let gone = false;

  // ── What the handle does not say ─────────────────────────────────────────────────────────────

  /** The spec the copied code carries: the four settings and the visible layers, slimmed. */
  function exportSpec() {
    /** @type {any} */
    const out = { preset: state.preset };
    if (state.time) out.time = state.time;
    out.seed = state.seed;
    if (state.drift !== 1) out.drift = state.drift;
    out.layers = handle.layers
      .filter(function (h) { return !state.hidden[h.name]; })
      .map(function (h) { return slim(h.spec); });
    return out;
  }

  function code() {
    return 'const bg = AIMEAT.phaser.parallax(this, ' + toSource(exportSpec(), 0) + ');';
  }

  function json() {
    return JSON.stringify(exportSpec(), null, 2);
  }

  /** The stack as it stands, for handing back with one more layer. */
  function stack() {
    return handle.layers.map(function (h) { return bare(h.spec); });
  }

  function tell() {
    if (typeof s.onChange !== 'function') return;
    try {
      s.onChange({ spec: exportSpec(), code: code() });
    } catch (err) {
      console.warn('[aimeat-phaser] a parallaxDesigner onChange listener threw:', err);
    }
  }

  /** set() drew every sprite again; the layers hidden for a look go back to hidden. */
  function reapplyHidden() {
    for (const name in state.hidden) {
      const L = handle.layer(name);
      if (L && typeof L.setVisible === 'function') L.setVisible(false);
    }
  }

  /**
   * After a change reached the handle: hidden layers back, the rows in step, the app told.
   * @param {boolean} structural  a layer came or went, so the rows are drawn again
   */
  function after(structural) {
    reapplyHidden();
    if (structural) buildRows();
    else syncRows();
    tell();
  }

  // ── The rows ─────────────────────────────────────────────────────────────────────────────────

  /**
   * A layer's value for a slider.
   * @param {any} spec
   * @param {string} key
   * @returns {number}
   */
  function valueOf(spec, key) {
    if (key === 'scroll') {
      const sc = spec.scroll;
      if (sc && typeof sc === 'object') return typeof sc.x === 'number' ? sc.x : 0;
      return typeof sc === 'number' ? sc : 0;
    }
    return typeof spec[key] === 'number' ? spec[key] : 0;
  }

  /** The tone words, with the layer's own value first when it is not one of them. */
  function toneOptions(current) {
    const list = TONES.map(function (w) { return { value: w, text: w }; });
    const now = String(current);
    if (TONES.indexOf(now) < 0) list.unshift({ value: now, text: now });
    return list;
  }

  /**
   * One change to one layer, through its own handle.
   * @param {string} name
   * @param {string} key
   * @param {any} value
   */
  function change(name, key, value) {
    const L = handle.layer(name);
    if (!L) { buildRows(); return; }
    /** @type {any} */
    const patch = {};
    if (key === 'scroll') {
      const sc = L.spec && L.spec.scroll;
      patch.scroll = { x: value, y: sc && typeof sc === 'object' && typeof sc.y === 'number' ? sc.y : 0 };
    } else if (key === 'tone') {
      patch.tone = /^-?\d+$/.test(value) ? Number(value) : value;
    } else {
      patch[key] = value;
    }
    L.set(patch);
    after(false);
  }

  /**
   * One row: the kind, the name, the visible switch, Remove, and the sliders.
   * @param {any} h  a layer handle
   */
  function row(h) {
    const name = h.name;
    const hid = uid('akd');
    const section = el('section', { class: 'ak-designer__layer', 'aria-labelledby': hid });
    const headEl = el('div', { class: 'ak-designer__layer-head' }, el('h3', { class: 'ak-designer__kind', id: hid }, [
      word(h.kind),
      name !== h.kind ? el('span', { class: 'ak-designer__name', text: name }) : null,
    ]));
    const visible = toggleField(headEl, {
      label: 'Visible', checked: !state.hidden[name],
      onChange: function (on) {
        if (on) delete state.hidden[name];
        else state.hidden[name] = true;
        const L = handle.layer(name);
        if (L && typeof L.setVisible === 'function') L.setVisible(on);
        tell();
      },
    });
    headEl.appendChild(button('Remove', function () {
      /** @type {any} */
      const patch = {};
      patch[name] = false;
      handle.set({ layers: patch });
      delete state.hidden[name];
      after(true);
      note.say('The ' + name + ' layer is gone.');
    }, { ariaLabel: 'Remove the ' + name + ' layer' }));
    section.appendChild(headEl);

    const grid = el('div', { class: 'ak-designer__grid ak-designer__grid--layer' });
    const tone = selectField(grid, {
      label: 'Tone', options: toneOptions(h.spec.tone), value: String(h.spec.tone),
      onChange: function (v) { change(name, 'tone', v); },
    });
    /** @type {Record<string, { set: (value: number) => void }>} */
    const fields = {};
    for (const c of LAYER_CONTROLS) {
      if (c.key === 'height' && h.kind === 'sky') continue;
      fields[c.key] = rangeField(grid, {
        label: c.label, min: c.min, max: c.max, step: c.step, unit: c.unit,
        value: valueOf(h.spec, c.key),
        onChange: function (v) { change(name, c.key, v); },
      });
    }
    section.appendChild(grid);
    return {
      name: name,
      el: section,
      /** @param {any} next  the layer's handle after a rebuild */
      read: function (next) {
        tone.options(toneOptions(next.spec.tone));
        tone.set(String(next.spec.tone));
        for (const key in fields) fields[key].set(valueOf(next.spec, key));
        visible.set(!state.hidden[name]);
      },
    };
  }

  /** Draw every row again, back to front. */
  function buildRows() {
    clear(list);
    rows = handle.layers.map(row);
    for (const r of rows) list.appendChild(r.el);
  }

  /** Re-read every row from the rebuilt handles; a name that is gone means the stack changed shape. */
  function syncRows() {
    for (const r of rows) {
      const h = handle.layer(r.name);
      if (!h) { buildRows(); return; }
      r.read(h);
    }
  }

  // ── The panel ────────────────────────────────────────────────────────────────────────────────

  const top = el('div', { class: 'ak-designer__grid' });
  selectField(top, {
    label: 'Preset', value: state.preset,
    options: PARALLAX_PRESETS.map(function (name) { return { value: name, text: name }; }),
    onChange: function (v) {
      state.preset = v;
      state.hidden = {};
      handle.set({ preset: v });
      after(true);
      note.say('');
    },
  });
  selectField(top, {
    label: 'Time of day', value: state.time, options: TIMES,
    onChange: function (v) {
      state.time = v;
      handle.set({ time: v || undefined });
      after(false);
    },
  });

  const seedId = uid('akd');
  const seedInput = /** @type {HTMLInputElement} */ (el('input', {
    id: seedId, type: 'number', class: 'ak-input ak-designer__number',
    min: '0', max: String(SEED_MAX), step: '1',
    on: { change: function () { seed(Math.floor(Number(seedInput.value))); } },
  }));
  seedInput.value = String(state.seed);
  top.appendChild(el('div', { class: 'ak-form__field ak-designer__field' }, [
    el('label', { class: 'ak-form__label', for: seedId, text: 'Seed' }),
    el('div', { class: 'ak-designer__control' }, [
      seedInput,
      button('Reroll', function () { seed(Math.floor(Math.random() * SEED_MAX)); }),
    ]),
  ]));

  rangeField(top, {
    label: 'Drift', min: 0, max: 3, step: 0.1, value: state.drift,
    onChange: function (v) {
      state.drift = v;
      handle.set({ drift: v });
      after(false);
    },
  });
  root.appendChild(top);

  const list = el('div', { class: 'ak-designer__layers' });
  root.appendChild(list);

  const addRow = el('div', { class: 'ak-designer__add' });
  const addPicker = selectField(addRow, {
    label: 'Add a layer', value: KINDS[0],
    options: KINDS.map(function (kind) { return { value: kind, text: word(kind) }; }),
    onChange: function () { /* the Add button reads the picker */ },
  });
  addRow.appendChild(button('Add', function () {
    const kind = addPicker.select.value;
    handle.set({ layers: stack().concat([{ kind: kind }]) });
    after(true);
    note.say('A ' + kind + ' layer was added at the front.');
  }));
  root.appendChild(addRow);

  root.appendChild(el('div', { class: 'ak-designer__bar' }, [
    el('span', { class: 'ak-designer__push' }),
    button('Copy as JS', copy),
    button('Export JSON', exportJson),
  ]));
  const note = notes(root);

  /** A new seed, from the field or the reroll. @param {number} n */
  function seed(n) {
    const next = isFinite(n) ? Math.max(0, Math.min(SEED_MAX, n)) : state.seed;
    state.seed = next;
    seedInput.value = String(next);
    handle.set({ seed: next });
    after(false);
  }

  function hiddenWords() {
    const n = Object.keys(state.hidden).length;
    if (!n) return '';
    return n === 1 ? ' The one hidden layer was left out.' : ' The ' + n + ' hidden layers were left out.';
  }

  function copy() {
    const text = code();
    copyText(text).then(function (ok) {
      if (gone) return;
      if (ok) {
        note.say('Copied. Paste it into your scene.' + hiddenWords());
        return;
      }
      note.show(text);
      note.say('This browser keeps the clipboard closed. The code is in the box below.' + hiddenWords());
    });
  }

  function exportJson() {
    note.show(json());
    note.say('The backdrop as JSON is in the box below.' + hiddenWords());
  }

  const api = {
    el: root,

    /** The spec the code writes. @returns {any} */
    spec: exportSpec,

    /** The parallax() call. @returns {string} */
    code: code,

    /** Read the stack again, for an app that changed it itself. */
    refresh() {
      if (gone) return;
      after(true);
    },

    destroy() {
      if (gone) return;
      gone = true;
      rows = [];
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };

  buildRows();
  return api;
}
