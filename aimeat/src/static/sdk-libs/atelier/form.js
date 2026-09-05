/**
 * @file atelier/form.js
 * @description The form — declared as fields, rendered with the accessibility wiring an AI
 *   never writes by hand: every control is labelled by a real <label for>, hints and errors are
 *   bound with aria-describedby, an error is announced (role=alert) and named next to its field,
 *   required is both stated and marked, and submit answers instantly and never double-fires.
 *
 *   VALIDATION SPEAKS TO THE PERSON. A failed field says what is missing in words next to the
 *   field, focus moves to the first problem, and nothing is submitted until every named problem
 *   is fixed. The host adds its own rules by throwing from onSubmit with { field, message } —
 *   the form places the message exactly like its own.
 *
 *   A CONTROL THAT REPORTS CONTINUOUSLY IS A FIELD LIKE ANY OTHER. `onInput(value, field)` fires
 *   on every keystroke and every drag of a slider, `onChange(value, field)` when the person lets
 *   go, and `submit: false` leaves the button bar out — so a live control (a slider wired to a
 *   number that recomputes as it moves) is DECLARED here rather than hand-built beside the kit
 *   with its own markup, its own label wiring and its own idea of a touch target.
 *
 *   THE RANGE CARRIES ITS OWN READING. `type: 'range'` draws the track and, beside it, what it
 *   currently says — the number and its `unit` — in an <output> bound to the input, and mirrors
 *   the same words into aria-valuetext so the announcement and the screen agree. The track meets
 *   the kit's touch floor (--ak-touch, 40px) at every size, and the keyboard is the browser's:
 *   arrows step, Home and End go to the ends.
 * @structure form(spec) → { el, set, values, setValues, setError, clearErrors, destroy }
 * @usage  AIMEAT.atelier.form({ target: host, fields: [
 *           { name: 'title', label: 'What', type: 'text', required: true },
 *           { name: 'due', label: 'When', type: 'date' } ],
 *           onSubmit(values) { return save(values); } });
 *         AIMEAT.atelier.form({ target: host, submit: false, fields: [
 *           { name: 't', label: 'Lämpötila', type: 'range', min: -20, max: 45, step: 0.5,
 *             unit: '°C', value: 22, onInput(v) { doc.set('t', v); } } ] });
 * @parts form root · field · label · input · req · hint · error · range · readout · bar · submit · cancel
 * @tokens form --ak-range-track · --ak-range-thumb
 * @fork form Copy .ak-form* and .ak-input* out of data.css and build the fields yourself; you keep the tokens, and you give up the label/hint/error wiring, the announced refusal with focus on the first problem, the submit guard and the range's reading.
 * @version-history
 *   v0.53.0 — 2026-09-05 — `type: 'range'` (min, max, step, unit, the live reading beside the
 *     track, the 40px floor and aria-valuetext); per-field onInput/onChange on every control
 *     beside the submit path; `submit: false` for a form that is only controls; an optional
 *     field `id` for a host that does its own label wiring. The parts, tokens and fork sentence
 *     declared, so describe('form') answers.
 *   v0.3.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 3).
 */
import { el, clear, resolve, uid, enter, whileBusy, attention } from './dom.js';
import { t } from './i18n.js';

/**
 * @typedef {object} FormField
 * @property {string} name
 * @property {string} label
 * @property {'text'|'number'|'range'|'date'|'textarea'|'select'|'checkbox'|'toggle'} [type]
 * @property {boolean} [required]
 * @property {string} [hint]
 * @property {any} [value]
 * @property {Array<{ value: string, label: string }>} [options]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string} [unit]  what the number is measured in; shown in a range's reading
 * @property {number} [maxLength]
 * @property {string} [id]  the control's id, when the host wires its own label or readout to it
 * @property {(value: any, field: FormField) => void} [onInput]  every keystroke, every drag
 * @property {(value: any, field: FormField) => void} [onChange]  when the person lets go
 */

/** The types whose value is a number rather than the string the DOM hands back. */
const NUMERIC = ['number', 'range'];

/**
 * The declared form.
 * @param {{
 *   target?: string|Element, fields: FormField[],
 *   submitLabel?: string, submit?: boolean, cancel?: { label?: string, onClick?: () => void },
 *   onSubmit?: (values: Record<string, any>) => any,
 * }} spec
 * @returns {{
 *   el: HTMLElement, values: () => Record<string, any>,
 *   setValues: (values: Record<string, any>) => void,
 *   setError: (name: string, message: string) => void, clearErrors: () => void,
 *   set: (patch: { fields?: FormField[] }) => void, destroy: () => void,
 * }}
 */
export function form(spec) {
  /** @type {Map<string, { field: FormField, input: HTMLElement, error: HTMLElement, wrap: HTMLElement, readout: HTMLElement|null }>} */
  const controls = new Map();
  const root = el('form', { class: 'ak-root ak-form', 'data-ak-part': 'root', novalidate: true });
  if (spec.target) resolve(spec.target).appendChild(root);

  /** What one field currently holds, read off its own control. @param {string} name @returns {any} */
  function valueOf(name) {
    const c = controls.get(name);
    if (!c) return undefined;
    const type = c.field.type || 'text';
    const node = /** @type {HTMLInputElement} */ (c.input);
    if (type === 'checkbox' || type === 'toggle') return node.checked;
    if (NUMERIC.indexOf(type) >= 0) return node.value === '' ? null : Number(node.value);
    return node.value;
  }

  /** What a range says it is at: the number, and what it is measured in. */
  function reading(field, raw) {
    const unit = field.unit ? ' ' + field.unit : '';
    return (raw == null || raw === '' ? '' : String(raw)) + unit;
  }

  /** @param {string} name */
  function refreshReadout(name) {
    const c = controls.get(name);
    if (!c || !c.readout) return;
    const words = reading(c.field, /** @type {HTMLInputElement} */ (c.input).value);
    c.readout.textContent = words;
    // The announcement and the screen say the same thing: without this a screen reader reads the
    // bare number and the sighted reader sees the unit, which is two different controls.
    c.input.setAttribute('aria-valuetext', words);
  }

  /** @param {FormField} field @returns {HTMLElement} */
  function buildControl(field) {
    const type = field.type || 'text';
    const id = field.id || uid('ak-f');
    const hintId = id + '-hint';
    const errId = id + '-err';
    const describedBy = (field.hint ? hintId + ' ' : '') + errId;

    let input;
    let readout = null;
    if (type === 'textarea') {
      input = el('textarea', { id: id, class: 'ak-input ak-input--area', 'data-ak-part': 'input', rows: 3, maxlength: field.maxLength || null, 'aria-describedby': describedBy });
      /** @type {HTMLTextAreaElement} */ (input).value = field.value != null ? String(field.value) : '';
    } else if (type === 'select') {
      input = el('select', { id: id, class: 'ak-input', 'data-ak-part': 'input', 'aria-describedby': describedBy },
        (field.options || []).map(function (o) {
          return el('option', { value: o.value, selected: field.value === o.value ? true : null }, o.label);
        }));
    } else if (type === 'checkbox' || type === 'toggle') {
      input = el('input', {
        id: id, type: 'checkbox', class: type === 'toggle' ? 'ak-toggle' : 'ak-check',
        'data-ak-part': 'input',
        checked: field.value ? true : null, 'aria-describedby': describedBy,
      });
    } else {
      input = el('input', {
        id: id, type: type === 'range' ? 'range' : type,
        class: 'ak-input' + (type === 'range' ? ' ak-input--range' : ''),
        'data-ak-part': 'input',
        min: field.min != null ? String(field.min) : null,
        max: field.max != null ? String(field.max) : null,
        step: field.step != null ? String(field.step) : null,
        maxlength: type === 'range' ? null : (field.maxLength || null),
        'aria-describedby': describedBy,
      });
      if (field.value != null) /** @type {HTMLInputElement} */ (input).value = String(field.value);
      if (type === 'range') readout = el('output', { class: 'ak-form__readout', 'data-ak-part': 'readout', for: id });
    }

    const label = el('label', { class: 'ak-form__label', 'data-ak-part': 'label', for: id }, [
      field.label,
      field.required ? el('span', { class: 'ak-form__req', 'data-ak-part': 'req', 'aria-hidden': 'true', text: '*' }) : null,
      field.required
        ? el('span', { class: 'ak-sr-only', text: ' (' + t('required') + ')' })
        : null,
    ]);
    const hint = field.hint ? el('p', { class: 'ak-form__hint', 'data-ak-part': 'hint', id: hintId, text: field.hint }) : null;
    const error = el('p', { class: 'ak-form__error', 'data-ak-part': 'error', id: errId, role: 'alert' });
    error.hidden = true;

    // A slider and its reading are ONE line: the track takes the room that is left and the number
    // sits beside it, so the eye reads where the value is without leaving the control.
    const body = readout
      ? el('div', { class: 'ak-form__range', 'data-ak-part': 'range' }, [input, readout])
      : input;

    const inline = type === 'checkbox' || type === 'toggle';
    const wrap = el('div', {
      class: 'ak-form__field' + (inline ? ' ak-form__field--inline' : '') + (type === 'range' ? ' ak-form__field--range' : ''),
      'data-ak-part': 'field', 'data-ak-field': field.name,
    }, inline ? [input, label, hint, error] : [label, body, hint, error]);
    controls.set(field.name, { field: field, input: input, error: error, wrap: wrap, readout: readout });

    // THE CONTINUOUS PATH, beside the submit one. Every control reports as it is touched and
    // again when the hand lets go, so a live document and a save-when-done form are the same
    // declaration with a different handler.
    input.addEventListener('input', function () {
      refreshReadout(field.name);
      if (field.onInput) field.onInput(valueOf(field.name), field);
    });
    input.addEventListener('change', function () {
      refreshReadout(field.name);
      if (field.onChange) field.onChange(valueOf(field.name), field);
    });
    refreshReadout(field.name);
    return wrap;
  }

  /** @param {string} name @param {string} message */
  function setError(name, message) {
    const c = controls.get(name);
    if (!c) return;
    c.error.textContent = message;
    c.error.hidden = false;
    c.wrap.classList.add('ak-form__field--invalid');
    c.input.setAttribute('aria-invalid', 'true');
    // The refusal moves as well as speaks: the message (role=alert) is what a screen reader
    // gets, the shake is what an eye already on the form gets. Never one without the other.
    attention(c.wrap, 'shake');
  }

  function clearErrors() {
    for (const [, c] of controls) {
      c.error.hidden = true;
      c.error.textContent = '';
      c.wrap.classList.remove('ak-form__field--invalid');
      c.input.removeAttribute('aria-invalid');
    }
  }

  /** @returns {Record<string, any>} */
  function values() {
    const out = {};
    for (const [name] of controls) out[name] = valueOf(name);
    return out;
  }

  /** Required + range, in words next to the field. @returns {string|null} first bad field name */
  function validate() {
    clearErrors();
    let firstBad = null;
    for (const [name, c] of controls) {
      const f = c.field;
      const type = f.type || 'text';
      const numeric = NUMERIC.indexOf(type) >= 0;
      const v = valueOf(name);
      let problem = null;
      if (f.required && (v === '' || v == null || v === false)) problem = f.label + ': ' + t('required').toLowerCase();
      else if (numeric && v != null && Number.isNaN(v)) problem = f.label + ': ' + t('required').toLowerCase();
      else if (numeric && v != null && f.min != null && v < f.min) problem = f.label + ' ≥ ' + f.min;
      else if (numeric && v != null && f.max != null && v > f.max) problem = f.label + ' ≤ ' + f.max;
      if (problem) {
        setError(name, problem);
        if (!firstBad) firstBad = name;
      }
    }
    return firstBad;
  }

  const wantsBar = spec.submit !== false;
  const submitBtn = el('button', { type: 'submit', class: 'ak-btn ak-btn--primary', 'data-ak-part': 'submit', 'data-ak-noguard': true },
    spec.submitLabel || t('save'));
  const bar = wantsBar ? el('div', { class: 'ak-form__bar', 'data-ak-part': 'bar' }, [
    spec.cancel ? el('button', {
      type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-part': 'cancel', 'data-ak-noguard': true,
      on: { click: function () { if (spec.cancel && spec.cancel.onClick) spec.cancel.onClick(); } },
    }, (spec.cancel.label || t('cancel'))) : null,
    submitBtn,
  ]) : null;

  /** @param {FormField[]} fields */
  function render(fields) {
    controls.clear();
    clear(root);
    for (const field of fields) root.appendChild(buildControl(field));
    if (bar) root.appendChild(bar);
    enter(root);
  }
  render(spec.fields || []);

  root.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!spec.onSubmit) return;
    const bad = validate();
    if (bad) {
      const c = controls.get(bad);
      if (c) /** @type {HTMLElement} */ (c.input).focus();
      return;
    }
    whileBusy(submitBtn, Promise.resolve().then(function () { return spec.onSubmit(values()); }))
      .catch(function (e) {
        const named = e && e.field && controls.has(e.field);
        if (named) {
          setError(e.field, e.message || String(e));
          const c = controls.get(e.field);
          if (c) /** @type {HTMLElement} */ (c.input).focus();
        } else {
          setError(controls.keys().next().value, (e && e.message) || String(e));
        }
      });
  });

  return {
    el: root,
    values: values,
    /** @param {Record<string, any>} next */
    setValues(next) {
      for (const name in next) {
        const c = controls.get(name);
        if (!c) continue;
        const type = c.field.type || 'text';
        if (type === 'checkbox' || type === 'toggle') /** @type {HTMLInputElement} */ (c.input).checked = !!next[name];
        else /** @type {HTMLInputElement} */ (c.input).value = next[name] == null ? '' : String(next[name]);
        refreshReadout(name);
      }
    },
    setError: setError,
    clearErrors: clearErrors,
    /** @param {{ fields?: FormField[] }} patch */
    set(patch) {
      if (patch && patch.fields) render(patch.fields);
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
