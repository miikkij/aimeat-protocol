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
 * @structure form(spec) → { el, set, values, setValues, setError, clearErrors, destroy }
 * @usage  AIMEAT.atelier.form({ target: host, fields: [
 *           { name: 'title', label: 'What', type: 'text', required: true },
 *           { name: 'due', label: 'When', type: 'date' } ],
 *           onSubmit(values) { return save(values); } });
 * @version-history
 *   v0.3.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 3).
 */
import { el, clear, resolve, uid, enter, whileBusy, attention } from './dom.js';
import { t } from './i18n.js';

/**
 * @typedef {object} FormField
 * @property {string} name
 * @property {string} label
 * @property {'text'|'number'|'date'|'textarea'|'select'|'checkbox'|'toggle'} [type]
 * @property {boolean} [required]
 * @property {string} [hint]
 * @property {any} [value]
 * @property {Array<{ value: string, label: string }>} [options]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [maxLength]
 */

/**
 * The declared form.
 * @param {{
 *   target?: string|Element, fields: FormField[],
 *   submitLabel?: string, cancel?: { label?: string, onClick?: () => void },
 *   onSubmit: (values: Record<string, any>) => any,
 * }} spec
 * @returns {{
 *   el: HTMLElement, values: () => Record<string, any>,
 *   setValues: (values: Record<string, any>) => void,
 *   setError: (name: string, message: string) => void, clearErrors: () => void,
 *   set: (patch: { fields?: FormField[] }) => void, destroy: () => void,
 * }}
 */
export function form(spec) {
  /** @type {Map<string, { field: FormField, input: HTMLElement, error: HTMLElement, wrap: HTMLElement }>} */
  const controls = new Map();
  const root = el('form', { class: 'ak-root ak-form', novalidate: true });
  if (spec.target) resolve(spec.target).appendChild(root);

  /** @param {FormField} field @returns {HTMLElement} */
  function buildControl(field) {
    const type = field.type || 'text';
    const id = uid('ak-f');
    const hintId = id + '-hint';
    const errId = id + '-err';
    const describedBy = (field.hint ? hintId + ' ' : '') + errId;

    let input;
    if (type === 'textarea') {
      input = el('textarea', { id: id, class: 'ak-input ak-input--area', rows: 3, maxlength: field.maxLength || null, 'aria-describedby': describedBy });
      /** @type {HTMLTextAreaElement} */ (input).value = field.value != null ? String(field.value) : '';
    } else if (type === 'select') {
      input = el('select', { id: id, class: 'ak-input', 'aria-describedby': describedBy },
        (field.options || []).map(function (o) {
          return el('option', { value: o.value, selected: field.value === o.value ? true : null }, o.label);
        }));
    } else if (type === 'checkbox' || type === 'toggle') {
      input = el('input', {
        id: id, type: 'checkbox', class: type === 'toggle' ? 'ak-toggle' : 'ak-check',
        checked: field.value ? true : null, 'aria-describedby': describedBy,
      });
    } else {
      input = el('input', {
        id: id, type: type, class: 'ak-input',
        min: field.min != null ? String(field.min) : null,
        max: field.max != null ? String(field.max) : null,
        maxlength: field.maxLength || null,
        'aria-describedby': describedBy,
      });
      if (field.value != null) /** @type {HTMLInputElement} */ (input).value = String(field.value);
    }

    const label = el('label', { class: 'ak-form__label', for: id }, [
      field.label,
      field.required ? el('span', { class: 'ak-form__req', 'aria-hidden': 'true', text: '*' }) : null,
      field.required
        ? el('span', { class: 'ak-sr-only', text: ' (' + t('required') + ')' })
        : null,
    ]);
    const hint = field.hint ? el('p', { class: 'ak-form__hint', id: hintId, text: field.hint }) : null;
    const error = el('p', { class: 'ak-form__error', id: errId, role: 'alert' });
    error.hidden = true;

    const inline = type === 'checkbox' || type === 'toggle';
    const wrap = el('div', { class: 'ak-form__field' + (inline ? ' ak-form__field--inline' : '') },
      inline ? [input, label, hint, error] : [label, input, hint, error]);
    controls.set(field.name, { field: field, input: input, error: error, wrap: wrap });
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
    for (const [name, c] of controls) {
      const type = c.field.type || 'text';
      if (type === 'checkbox' || type === 'toggle') out[name] = /** @type {HTMLInputElement} */ (c.input).checked;
      else if (type === 'number') {
        const raw = /** @type {HTMLInputElement} */ (c.input).value;
        out[name] = raw === '' ? null : Number(raw);
      } else out[name] = /** @type {HTMLInputElement} */ (c.input).value;
    }
    return out;
  }

  /** Required + range, in words next to the field. @returns {string|null} first bad field name */
  function validate() {
    clearErrors();
    let firstBad = null;
    for (const [name, c] of controls) {
      const f = c.field;
      const type = f.type || 'text';
      const v = values()[name];
      let problem = null;
      if (f.required && (v === '' || v == null || v === false)) problem = f.label + ': ' + t('required').toLowerCase();
      else if (type === 'number' && v != null && Number.isNaN(v)) problem = f.label + ': ' + t('required').toLowerCase();
      else if (type === 'number' && v != null && f.min != null && v < f.min) problem = f.label + ' ≥ ' + f.min;
      else if (type === 'number' && v != null && f.max != null && v > f.max) problem = f.label + ' ≤ ' + f.max;
      if (problem) {
        setError(name, problem);
        if (!firstBad) firstBad = name;
      }
    }
    return firstBad;
  }

  const submitBtn = el('button', { type: 'submit', class: 'ak-btn ak-btn--primary', 'data-ak-noguard': true },
    spec.submitLabel || t('save'));
  const bar = el('div', { class: 'ak-form__bar' }, [
    spec.cancel ? el('button', {
      type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-noguard': true,
      on: { click: function () { if (spec.cancel && spec.cancel.onClick) spec.cancel.onClick(); } },
    }, (spec.cancel.label || t('cancel'))) : null,
    submitBtn,
  ]);

  /** @param {FormField[]} fields */
  function render(fields) {
    controls.clear();
    clear(root);
    for (const field of fields) root.appendChild(buildControl(field));
    root.appendChild(bar);
    enter(root);
  }
  render(spec.fields || []);

  root.addEventListener('submit', function (ev) {
    ev.preventDefault();
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
