/**
 * @file phaser/designer-parts.js
 * @description The parts the two designer panels (designer-fx.js, designer-parallax.js) are built
 *   from, so neither writes a slider twice: a labelled range with its live read-out, a pair of
 *   them under one legend, a select, a switch, a button, the status line with the code box under
 *   it, the clipboard call, and the writer that turns a config into the JavaScript a person pastes.
 *
 *   EVERY CONTROL IS A REAL CONTROL WITH A LABEL. A range is an input, a switch is a checkbox, a
 *   picker is a select, and each one carries a label or a screen-reader label, so the keyboard
 *   and a screen reader work without either panel doing anything about it.
 *
 *   THE CODE WRITER WRITES SOURCE, NOT JSON. Keys are bare where JavaScript allows it, strings are
 *   single-quoted, a short object sits on one line and a long one opens out, so what lands in a
 *   scene file reads like something a person wrote. Numbers are rounded to three decimals: a
 *   slider's 0.30000000000000004 is not what anyone meant.
 *
 *   NO COLOUR AND NO STYLE IS WRITTEN HERE. Every part sets class names on the Atelier contract
 *   (ak-input, ak-btn, ak-toggle, ak-form__label) and its own ak-designer__* names, and
 *   aimeat-phaser/designer.css dresses them off the --ak-* tokens.
 * @structure fmt · quote · toSource · rangeField · pairField · selectField · toggleField ·
 *   button · notes · copyText
 * @usage  import { rangeField, toSource, notes } from './designer-parts.js';   // the designers only
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the controls and the code writer designer-fx.js and
 *     designer-parallax.js share.
 */
import { el, clear, uid } from '../atelier/dom.js';

/** The widest a one-line object literal may be before it opens out. */
const ONE_LINE = 72;

/**
 * A number as the read-out beside a slider shows it: as many decimals as the step has.
 * @param {number} value
 * @param {number} step
 * @returns {string}
 */
export function fmt(value, step) {
  const n = Number(value);
  if (!isFinite(n)) return '0';
  const digits = step >= 1 ? 0 : (step >= 0.1 ? 1 : 2);
  return n.toFixed(digits);
}

/**
 * A string as a single-quoted JavaScript literal.
 * @param {string} text
 * @returns {string}
 */
export function quote(text) {
  return "'" + String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
}

/** @param {string} key @returns {string} the key as JavaScript writes it, bare when it can be */
function keySource(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key);
}

/**
 * A value as JavaScript source. Undefined keys and functions are left out, numbers are rounded
 * to three decimals, and an object opens out only when it would not fit on one line.
 * @param {any} value
 * @param {number} [depth]  how many levels in this value sits, for the indent
 * @returns {string}
 */
export function toSource(value, depth) {
  const level = depth || 0;
  const pad = '  '.repeat(level + 1);
  const close = '  '.repeat(level);
  if (Array.isArray(value)) {
    const items = value.map(function (v) { return toSource(v, level + 1); });
    const flat = items.every(function (item) { return item.indexOf('\n') < 0; });
    const oneLine = '[' + items.join(', ') + ']';
    if (flat && oneLine.length <= ONE_LINE) return oneLine;
    return '[\n' + items.map(function (item) { return pad + item; }).join(',\n') + '\n' + close + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter(function (k) {
      return value[k] !== undefined && typeof value[k] !== 'function';
    });
    if (!keys.length) return '{}';
    const parts = keys.map(function (k) { return keySource(k) + ': ' + toSource(value[k], level + 1); });
    const oneLine = '{ ' + parts.join(', ') + ' }';
    const flat = parts.every(function (part) { return part.indexOf('\n') < 0; });
    if (flat && oneLine.length <= ONE_LINE) return oneLine;
    return '{\n' + parts.map(function (part) { return pad + part; }).join(',\n') + '\n' + close + '}';
  }
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number') return isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0';
  if (typeof value === 'boolean') return String(value);
  return 'null';
}

/**
 * @typedef {object} RangeSpec
 * @property {string} label
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {string} [unit]     shown after the read-out (' px/s', ' ms')
 * @property {number} value
 * @property {(value: number) => void} [onInput]   every movement, with the number
 * @property {(value: number) => void} [onChange]  when the movement settles
 * @property {boolean} [srOnly]  the label is for a screen reader only (one half of a pair)
 */

/**
 * One slider, labelled, with its own live read-out.
 * @param {HTMLElement} host
 * @param {RangeSpec} spec
 * @returns {{ input: HTMLInputElement, set: (value: number) => void }}
 */
export function rangeField(host, spec) {
  const id = uid('akd');
  const out = el('output', { class: 'ak-designer__value', for: id });
  const input = /** @type {HTMLInputElement} */ (el('input', {
    id: id, type: 'range', class: 'ak-input ak-designer__range',
    min: String(spec.min), max: String(spec.max), step: String(spec.step),
    on: {
      input: function () {
        show();
        if (spec.onInput) spec.onInput(Number(input.value));
      },
      change: function () {
        show();
        if (spec.onChange) spec.onChange(Number(input.value));
      },
    },
  }));
  function show() {
    out.textContent = fmt(Number(input.value), spec.step) + (spec.unit || '');
  }
  const label = el('label', { class: spec.srOnly ? 'ak-sr-only' : 'ak-form__label', for: id, text: spec.label });
  const control = el('div', { class: 'ak-designer__control' }, [input, out]);
  host.appendChild(el('div', {
    class: spec.srOnly ? 'ak-designer__half' : 'ak-form__field ak-designer__field',
  }, [label, control]));
  const api = {
    input: input,
    /** @param {number} value */
    set: function (value) {
      input.value = String(value);
      show();
    },
  };
  api.set(spec.value);
  return api;
}

/**
 * @typedef {object} PairSpec
 * @property {string} label
 * @property {[string, string]} words  what the two halves are: min / max, or start / end
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {string} [unit]
 * @property {[number, number]} value
 * @property {(value: [number, number]) => void} [onInput]
 * @property {(value: [number, number]) => void} [onChange]
 */

/**
 * Two sliders under one legend, for a value that is a range or a start and an end.
 * @param {HTMLElement} host
 * @param {PairSpec} spec
 * @returns {{ inputs: HTMLInputElement[], set: (value: [number, number]) => void }}
 */
export function pairField(host, spec) {
  const box = el('fieldset', { class: 'ak-designer__field ak-designer__pair' }, el('legend', {
    class: 'ak-form__label', text: spec.label + ' (' + spec.words[0] + ' / ' + spec.words[1] + ')',
  }));
  host.appendChild(box);
  /** @type {Array<{ input: HTMLInputElement, set: (value: number) => void }>} */
  const halves = [];
  /** @returns {[number, number]} */
  const pair = function () {
    return [Number(halves[0].input.value), Number(halves[1].input.value)];
  };
  for (let i = 0; i < 2; i += 1) {
    halves.push(rangeField(box, {
      srOnly: true, label: spec.label + ', ' + spec.words[i],
      min: spec.min, max: spec.max, step: spec.step, unit: spec.unit, value: spec.value[i],
      onInput: function () { if (spec.onInput) spec.onInput(pair()); },
      onChange: function () { if (spec.onChange) spec.onChange(pair()); },
    }));
  }
  return {
    inputs: [halves[0].input, halves[1].input],
    /** @param {[number, number]} value */
    set: function (value) {
      halves[0].set(value[0]);
      halves[1].set(value[1]);
    },
  };
}

/** @typedef {{ value: string, text: string }} Choice */

/**
 * @param {HTMLSelectElement} select
 * @param {Choice[]} options
 * @returns {void}
 */
function fill(select, options) {
  clear(select);
  for (const option of options) select.appendChild(el('option', { value: option.value, text: option.text }));
}

/**
 * A labelled picker.
 * @param {HTMLElement} host
 * @param {{ label: string, options: Choice[], value: string, onChange: (value: string) => void,
 *   inline?: boolean }} spec
 * @returns {{ select: HTMLSelectElement, set: (value: string) => void,
 *   options: (options: Choice[]) => void }}
 */
export function selectField(host, spec) {
  const id = uid('akd');
  const select = /** @type {HTMLSelectElement} */ (el('select', {
    id: id, class: 'ak-input ak-designer__select',
    on: { change: function () { spec.onChange(select.value); } },
  }));
  fill(select, spec.options);
  select.value = spec.value;
  host.appendChild(el('div', {
    class: 'ak-form__field ak-designer__field' + (spec.inline ? ' ak-designer__field--inline' : ''),
  }, [
    el('label', { class: 'ak-form__label', for: id, text: spec.label }),
    select,
  ]));
  return {
    select: select,
    /** @param {string} value */
    set: function (value) { select.value = value; },
    /** @param {Choice[]} options */
    options: function (options) {
      const kept = select.value;
      fill(select, options);
      select.value = kept;
    },
  };
}

/**
 * One switch: a checkbox the browser draws, on the kit's toggle class.
 * @param {HTMLElement} host
 * @param {{ label: string, checked: boolean, onChange: (on: boolean) => void }} spec
 * @returns {{ input: HTMLInputElement, set: (on: boolean) => void }}
 */
export function toggleField(host, spec) {
  const id = uid('akd');
  const input = /** @type {HTMLInputElement} */ (el('input', {
    id: id, type: 'checkbox', class: 'ak-toggle',
    on: { change: function () { spec.onChange(input.checked); } },
  }));
  input.checked = !!spec.checked;
  host.appendChild(el('div', { class: 'ak-form__field ak-form__field--inline ak-designer__field ak-designer__field--inline' }, [
    input,
    el('label', { class: 'ak-form__label', for: id, text: spec.label }),
  ]));
  return {
    input: input,
    /** @param {boolean} on */
    set: function (on) { input.checked = !!on; },
  };
}

/**
 * A button on the kit's own classes, outside the kit's double-click guard because every button
 * here answers at once.
 * @param {string} label
 * @param {() => void} run
 * @param {{ primary?: boolean, ariaLabel?: string }} [opts]
 * @returns {HTMLButtonElement}
 */
export function button(label, run, opts) {
  const o = opts || {};
  return /** @type {HTMLButtonElement} */ (el('button', {
    type: 'button', class: 'ak-btn ' + (o.primary ? 'ak-btn--primary' : 'ak-btn--ghost'),
    'data-ak-noguard': true, 'aria-label': o.ariaLabel || null,
    on: { click: function () { run(); } },
  }, label));
}

/**
 * The status line and the code box under a panel. The box stays hidden until something is put
 * in it, and it is a real textarea so the code can be selected and copied by hand where the
 * clipboard is closed.
 * @param {HTMLElement} host
 * @returns {{ say: (words: string) => void, show: (text: string) => void, hide: () => void }}
 */
export function notes(host) {
  const status = el('p', { class: 'ak-designer__status', role: 'status' });
  const box = /** @type {HTMLTextAreaElement} */ (el('textarea', {
    class: 'ak-designer__code', readonly: true, hidden: true, rows: '10', spellcheck: 'false',
    'aria-label': 'The code and the settings, as text',
  }));
  host.appendChild(status);
  host.appendChild(box);
  return {
    say: function (words) { status.textContent = words; },
    show: function (text) {
      box.value = text;
      box.hidden = false;
    },
    hide: function () {
      box.value = '';
      box.hidden = true;
    },
  };
}

/**
 * Put text on the clipboard. Answers false, never throws, when the browser keeps it closed, so
 * the caller can show the text instead.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export function copyText(text) {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
  if (!clip || typeof clip.writeText !== 'function') return Promise.resolve(false);
  return clip.writeText(text).then(function () { return true; }, function (err) {
    console.warn('[aimeat-phaser] the clipboard refused the code:', err);
    return false;
  });
}
