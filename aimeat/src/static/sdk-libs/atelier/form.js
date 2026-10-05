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
 *
 *   ONE SCHEMA CHECKS THE FORM. What the fields declare (required, format, pattern, minLength,
 *   maxLength, min, max, sameAs) and the host's own `schema` fold into one JSON Schema
 *   (form-check.js), checked by the same core as AIMEAT.validate (validate/core.js). So the form
 *   says in the person's language what is wrong ("Y-tunnuksen tarkistusnumero ei täsmää"), shows
 *   what a field of a format expects before anything is typed, and refuses exactly what a
 *   workspace locked with the same schema refuses on the node. A field is checked when the person
 *   leaves it, then on every keystroke until it is right; a field that passes its rules is marked.
 *
 *   SOME FIELDS MUST BE RIGHT BEFORE THE NEXT STEP. `gate: true` holds the submit button
 *   (aria-disabled, still focusable) and says under it which fields are still missing; pressing it
 *   anyway shows every problem and moves focus to the first. `gate(button, names)` does the same
 *   for a button of the host's own, such as Next in a form of several steps, over the named
 *   fields only. `ready(names)` and `missing(names)` answer the same question in code, and
 *   `onValidity` reports it on every change.
 * @structure form(spec) → { el, set, values, setValues, setError, clearErrors, check, ready,
 *   missing, gate, destroy }
 * @usage  AIMEAT.atelier.form({ target: host, fields: [
 *           { name: 'title', label: 'What', type: 'text', required: true },
 *           { name: 'due', label: 'When', type: 'date' } ],
 *           onSubmit(values) { return save(values); } });
 *         AIMEAT.atelier.form({ target: host, submit: false, fields: [
 *           { name: 't', label: 'Lämpötila', type: 'range', min: -20, max: 45, step: 0.5,
 *             unit: '°C', value: 22, onInput(v) { doc.set('t', v); } } ] });
 * @parts form root · field · label · input · req · hint · error · range · readout · alert · gate · bar · submit · cancel
 * @tokens form --ak-range-track · --ak-range-thumb
 * @fork form Copy .ak-form* and .ak-input* out of data.css and build the fields yourself; you keep the tokens, and you give up the label/hint/error wiring, the announced refusal with focus on the first problem, the submit guard and the range's reading.
 * @version-history
 *   v0.66.0 — 2026-10-05 — Validation from one JSON Schema: field `format`, `pattern`, `minLength`,
 *     `sameAs` and `messages`, the host's `schema`, a format's hint under its field, the check when a
 *     field is left and the mark when it is right, `gate`, `check()`, `ready()`, `missing()`,
 *     `gate(button, names)` and `onValidity`. A refusal now says what to do ("Fill in this field.")
 *     next to the field instead of "Label: required". Types email, url and tel carry their format.
 *   v0.62.0 — 2026-10-01 — `type: 'model'`: a select of the models a `capability` can use, read from
 *     AIMEAT.ai.models() when the library is on the page, and a text field without it. Two apps
 *     wrote a free-text model field by hand (postinjalostamo, puhe). The other kinds are unchanged.
 *   v0.55.0 — 2026-09-28 — A `toggle` field is the kit's switch (role="switch", the knob stretches
 *     when pressed and travels on two edge springs) and a `range` field shows its filled share
 *     and stretches when pulled past an end (controls.js switchMotion and rangeMotion).
 *   v0.54.0 — 2026-09-28 — A field's `width` (short, date, medium, long, full) caps the control at
 *     the width its content needs; the settings-page layout rule in the Atelier spec names it.
 *   v0.53.0 — 2026-09-05 — `type: 'range'` (min, max, step, unit, the live reading beside the
 *     track, the 40px floor and aria-valuetext); per-field onInput/onChange on every control
 *     beside the submit path; `submit: false` for a form that is only controls; an optional
 *     field `id` for a host that does its own label wiring. The parts, tokens and fork sentence
 *     declared, so describe('form') answers.
 *   v0.3.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 3).
 */
import { el, clear, resolve, uid, enter, whileBusy, attention } from './dom.js';
import { t, i18n } from './i18n.js';
import { switchMotion, rangeMotion } from './controls.js';
import { tai } from './ai-task-i18n.js';
import { compile } from '../validate/core.js';
import { schemaFromFields } from './form-check.js';

/**
 * @typedef {object} FormField
 * @property {string} name
 * @property {string} label
 * @property {'text'|'number'|'range'|'date'|'textarea'|'select'|'checkbox'|'toggle'|'model'} [type]
 * @property {string} [capability]  a model field's capability: which models it lists ('text' by
 *   default, or 'vision', 'files', 'image', 'speech', 'transcription', 'embed')
 * @property {boolean} [required]
 * @property {string} [hint]
 * @property {any} [value]
 * @property {Array<{ value: string, label: string }>} [options]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string} [unit]  what the number is measured in; shown in a range's reading
 * @property {number} [maxLength]
 * @property {number} [minLength]
 * @property {string} [format]  a JSON Schema format: email, uri, date, fi-business-id, fi-personal-id,
 *   iban, fi-postal-code, phone (AIMEAT.validate.formats() lists them)
 * @property {string} [pattern]  a regular expression the whole value must match
 * @property {string} [sameAs]  the name of a field this one must equal
 * @property {Record<string, string|Record<string, string>>} [messages]  the words for one rule of this
 *   field ({ pattern: 'Kirjoita kolme kirjainta.' }), text or per language
 * @property {string} [id]  the control's id, when the host wires its own label or readout to it
 * @property {'short'|'date'|'medium'|'long'|'full'} [width]  how wide the control is drawn: short
 *   (a number, about 10 characters), date (18), medium (a name, 30), long (a URL or a sentence,
 *   32rem) or full. Omitted, the control fills its column as before.
 * @property {(value: any, field: FormField) => void} [onInput]  every keystroke, every drag
 * @property {(value: any, field: FormField) => void} [onChange]  when the person lets go
 */

/** The types whose value is a number rather than the string the DOM hands back. */
const NUMERIC = ['number', 'range'];

/** The schema keywords that make a field's right value worth marking as right. */
const RULE_KEYS = ['format', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum',
  'exclusiveMaximum', 'multipleOf', 'const', 'enum', 'x-same-as'];

/**
 * The control of a `model` field. With AIMEAT.ai on the page it is a select of the models the
 * capability can use (AIMEAT.ai.models), with "the default model" (an empty value) first; the value
 * the field holds stays chosen while the list loads, and a value the list does not have is kept as
 * its own option rather than dropped. Without the library it is a text field. A row's value is its
 * `ref` ("type:id"), or its bare `id` when the field already holds that id, so a value an app saved
 * before this field existed still matches its row.
 * @param {FormField} field
 * @param {string} id
 * @param {string} describedBy
 * @returns {{ input: HTMLElement, ensure: ((value: string) => void)|null }}
 */
function modelControl(field, id, describedBy) {
  const ns = /** @type {any} */ (window).AIMEAT;
  const lib = ns && ns.ai && typeof ns.ai.models === 'function' ? ns.ai : null;
  const current = field.value != null ? String(field.value) : '';
  if (!lib) {
    const text = /** @type {HTMLInputElement} */ (el('input', {
      id: id, type: 'text', class: 'ak-input', 'data-ak-part': 'input', 'data-ak-model': 'text',
      autocomplete: 'off', spellcheck: 'false', maxlength: field.maxLength || null, 'aria-describedby': describedBy,
    }));
    text.value = current;
    return { input: text, ensure: null };
  }
  const select = /** @type {HTMLSelectElement} */ (el('select', {
    id: id, class: 'ak-input', 'data-ak-part': 'input', 'data-ak-model': 'select', 'aria-describedby': describedBy, 'aria-busy': 'true',
  }));
  /** @type {any[]|null} */
  let rows = null;
  let failed = false;
  const has = function (v) { return Array.prototype.some.call(select.options, function (o) { return o.value === v; }); };
  const extra = function (v) { return el('option', { value: v }, rows ? tai('modelField.notListed', { model: v }) : v); };
  /** @param {string} keep the value to keep chosen */
  function fill(keep) {
    clear(select);
    select.appendChild(el('option', { value: '' }, tai('modelField.default')));
    for (const r of rows || []) {
      const v = keep && keep === r.id ? r.id : String(r.ref || r.id || '');
      if (!v || has(v)) continue;
      select.appendChild(el('option', { value: v }, String(r.name || r.id || v)));
    }
    if (keep && !has(keep)) select.appendChild(extra(keep));
    if (!rows) select.appendChild(el('option', { value: '', disabled: true }, tai(failed ? 'modelField.failed' : 'modelField.loading')));
    select.value = keep || '';
  }
  fill(current);
  Promise.resolve().then(function () { return lib.models({ capability: field.capability || 'text' }); }).then(
    function (list) { rows = Array.isArray(list) ? list : []; },
    function (e) { failed = true; console.debug('aimeat-atelier: model list not read', e); },
  ).then(function () {
    select.removeAttribute('aria-busy');
    // The list could not be read: keep the default and the held value, and say so in the list.
    fill(select.value);
  });
  return {
    input: select,
    ensure: function (v) { if (v && !has(v)) select.appendChild(extra(v)); },
  };
}

/**
 * The declared form.
 * @param {{
 *   target?: string|Element, fields: FormField[],
 *   submitLabel?: string, submit?: boolean, cancel?: { label?: string, onClick?: () => void },
 *   onSubmit?: (values: Record<string, any>) => any,
 *   schema?: Record<string, any>, gate?: boolean,
 *   onValidity?: (state: { valid: boolean, missing: string[] }) => void,
 * }} spec
 * @returns {{
 *   el: HTMLElement, values: () => Record<string, any>,
 *   setValues: (values: Record<string, any>) => void,
 *   setError: (name: string, message: string) => void, clearErrors: () => void,
 *   check: () => any, ready: (names?: string[]) => boolean, missing: (names?: string[]) => string[],
 *   gate: (button: string|Element, names?: string[]) => { refresh: () => void, destroy: () => void },
 *   set: (patch: { fields?: FormField[] }) => void, destroy: () => void,
 * }}
 */
export function form(spec) {
  /** @type {Map<string, { field: FormField, input: HTMLElement, error: HTMLElement, wrap: HTMLElement, readout: HTMLElement|null, motion?: { sync: () => void }, ensure?: (value: string) => void }>} */
  const controls = new Map();
  const root = el('form', { class: 'ak-root ak-form', 'data-ak-part': 'root', novalidate: true });
  if (spec.target) resolve(spec.target).appendChild(root);

  /** The fields drawn now, and their rules as one compiled schema (form-check.js). */
  let drawn = spec.fields || [];
  let checker = compile(schemaFromFields(drawn, spec.schema));
  /** Fields the person has left at least once: only these show a problem before a submit. */
  const touched = new Set();
  /** The gates over buttons, each re-read after every change. @type {Array<(r: any) => void>} */
  const gates = [];
  /** A problem that belongs to no field drawn here (a rule between fields, a schema-only property). */
  const formAlert = el('p', { class: 'ak-form__error ak-form__alert', 'data-ak-part': 'alert', role: 'alert' });
  formAlert.hidden = true;
  const gateNote = spec.gate ? el('p', { class: 'ak-form__gate', 'data-ak-part': 'gate', 'aria-live': 'polite' }) : null;

  /** Whether the compiled schema asks for this field. @param {string} name */
  function isRequired(name) {
    const req = checker.schema.required;
    return Array.isArray(req) && req.indexOf(name) >= 0;
  }

  /** Whether a field has any rule a value can pass, so a right value earns the mark. @param {string} name */
  function hasRule(name) {
    if (isRequired(name)) return true;
    const p = (checker.schema.properties || {})[name] || {};
    return RULE_KEYS.some(function (k) { return p[k] != null; });
  }

  /** What the check needs besides the values: the language and the labels people see. */
  function checkOpts() {
    /** @type {Record<string, string>} */
    const labels = {};
    for (const [name, c] of controls) if (typeof c.field.label === 'string') labels[name] = c.field.label;
    return { lang: i18n.lang(), labels: labels };
  }

  /** @returns {any} the validate core's result for what the form holds now */
  function checkNow() { return checker.check(values(), checkOpts()); }

  /** The problem a field shows: its own, or a rule between fields that names it. @param {any} r @param {string} name */
  function issueOf(r, name) {
    if (r.fields[name]) return r.fields[name];
    return r.errors.find(function (/** @type {any} */ i) { return (i.fields || []).indexOf(name) >= 0; }) || null;
  }

  /** The fields among `names` (all when omitted) a result still has a problem with. @param {any} r @param {string[]} [names] */
  function missingFrom(r, names) {
    /** @type {string[]} */
    const out = [];
    for (const i of r.errors) {
      for (const f of [i.field].concat(i.fields || [])) {
        if (names ? names.indexOf(f) >= 0 : true) { if (out.indexOf(f) < 0) out.push(f); }
      }
    }
    return out;
  }

  /** Show a problem next to a field. @param {string} name @param {string} message */
  function mark(name, message) {
    const c = controls.get(name);
    if (!c) return;
    c.error.textContent = message;
    c.error.hidden = false;
    c.wrap.classList.add('ak-form__field--invalid');
    c.wrap.classList.remove('ak-form__field--valid');
    c.input.setAttribute('aria-invalid', 'true');
  }

  /** Take a field's problem away; mark it right when it has a rule and holds a value. @param {string} name */
  function unmark(name) {
    const c = controls.get(name);
    if (!c) return;
    c.error.hidden = true;
    c.error.textContent = '';
    c.wrap.classList.remove('ak-form__field--invalid');
    c.input.removeAttribute('aria-invalid');
    const v = valueOf(name);
    const filled = !(v === '' || v == null || v === false || (typeof v === 'number' && Number.isNaN(v)));
    c.wrap.classList.toggle('ak-form__field--valid', touched.has(name) && filled && hasRule(name));
  }

  /** Re-check one field the person is working on, quietly: no shake while they type. @param {string} name */
  function recheck(name) {
    const issue = issueOf(checkNow(), name);
    if (issue) mark(name, issue.message);
    else unmark(name);
  }

  /** Hold or release a button, and say under it what is still missing. */
  function gateState(/** @type {HTMLElement} */ button, /** @type {HTMLElement|null} */ note, /** @type {string[]} */ miss) {
    const held = miss.length > 0;
    if (held) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
    if (!note) return;
    const names = miss.filter(Boolean).map(function (n) {
      const c = controls.get(n);
      return c && typeof c.field.label === 'string' ? c.field.label : checker.label(n, checkOpts());
    });
    note.textContent = held ? t('fillFirst', { fields: names.length ? names.join(', ') : t('formIncomplete') }) : '';
    note.hidden = !held;
  }

  /** After any change: every gate re-reads the form, and the host hears the state. */
  function refreshGates() {
    if (!gates.length && !spec.onValidity) return;
    const r = checkNow();
    for (const g of gates) g(r);
    if (spec.onValidity) spec.onValidity({ valid: r.valid, missing: missingFrom(r) });
  }

  /**
   * Show every problem among `names` (all fields when omitted) and move focus to the first.
   * @param {string[]} [names]
   * @returns {string|null} the first field with a problem, '' for a problem of no field, null when right
   */
  function showProblems(names) {
    const r = checkNow();
    /** @type {string|null} */
    let firstBad = null;
    for (const [name, c] of controls) {
      if (names && names.indexOf(name) < 0) continue;
      touched.add(name);
      const issue = issueOf(r, name);
      if (issue) {
        mark(name, issue.message);
        attention(c.wrap, 'shake');
        if (!firstBad) firstBad = name;
      } else unmark(name);
    }
    if (!names) {
      const loose = r.errors.filter(function (/** @type {any} */ i) {
        return !controls.has(i.field) && !(i.fields || []).some(function (/** @type {string} */ f) { return controls.has(f); });
      });
      formAlert.textContent = loose.map(function (/** @type {any} */ i) { return i.message; }).join(' ');
      formAlert.hidden = loose.length === 0;
      if (!firstBad && loose.length) firstBad = '';
    }
    if (firstBad) {
      const c = controls.get(firstBad);
      if (c) /** @type {HTMLElement} */ (c.input).focus();
    }
    return firstBad;
  }

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
    // A field with a format says what the format looks like before anything is typed.
    const hintText = field.hint || checker.hint(field.name, i18n.lang());
    const required = !!field.required || isRequired(field.name);
    const describedBy = (hintText ? hintId + ' ' : '') + errId;

    let input;
    let readout = null;
    /** @type {((value: string) => void)|null} */
    let ensure = null;
    if (type === 'model') {
      const m = modelControl(field, id, describedBy);
      input = m.input;
      ensure = m.ensure;
    } else if (type === 'textarea') {
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
      required ? el('span', { class: 'ak-form__req', 'data-ak-part': 'req', 'aria-hidden': 'true', text: '*' }) : null,
      required
        ? el('span', { class: 'ak-sr-only', text: ' (' + t('required') + ')' })
        : null,
    ]);
    const hint = hintText ? el('p', { class: 'ak-form__hint', 'data-ak-part': 'hint', id: hintId, text: hintText }) : null;
    const error = el('p', { class: 'ak-form__error', 'data-ak-part': 'error', id: errId, role: 'alert' });
    error.hidden = true;

    // A slider and its reading are ONE line: the track takes the room that is left and the number
    // sits beside it, so the eye reads where the value is without leaving the control.
    const body = readout
      ? el('div', { class: 'ak-form__range', 'data-ak-part': 'range' }, [input, readout])
      : input;

    const inline = type === 'checkbox' || type === 'toggle';
    // THE WIDTH IS THE CONTENT'S: a four-digit number in a field as wide as the page reads as a
    // form nobody designed. The class caps the control, never the label or the hint.
    const width = ['short', 'date', 'medium', 'long', 'full'].indexOf(field.width || '') >= 0 ? field.width : null;
    const wrap = el('div', {
      class: 'ak-form__field' + (inline ? ' ak-form__field--inline' : '') + (type === 'range' ? ' ak-form__field--range' : '')
        + (width ? ' ak-form__field--w-' + width : ''),
      'data-ak-part': 'field', 'data-ak-field': field.name,
    }, inline ? [input, label, hint, error] : [label, body, hint, error]);
    controls.set(field.name, { field: field, input: input, error: error, wrap: wrap, readout: readout });

    // THE CONTINUOUS PATH, beside the submit one. Every control reports as it is touched and
    // again when the hand lets go, so a live document and a save-when-done form are the same
    // declaration with a different handler.
    // THE CHECK follows the person: nothing is said while a field is first typed into, the field
    // is checked when they leave it, and from then on every keystroke re-checks it, so the problem
    // goes away the moment it is fixed. A choice (a box, a switch, a list) is checked when made.
    input.addEventListener('input', function () {
      refreshReadout(field.name);
      if (field.onInput) field.onInput(valueOf(field.name), field);
      if (touched.has(field.name)) recheck(field.name);
      refreshGates();
    });
    input.addEventListener('change', function () {
      refreshReadout(field.name);
      if (field.onChange) field.onChange(valueOf(field.name), field);
      if (inline || type === 'select' || type === 'model' || type === 'range') touched.add(field.name);
      if (touched.has(field.name)) recheck(field.name);
      refreshGates();
    });
    input.addEventListener('blur', function () {
      touched.add(field.name);
      recheck(field.name);
    });
    refreshReadout(field.name);
    // The switch's knob travel and the range's fill and stretch are the same as the standalone
    // controls' (controls.js), so a declared field and a hand-placed control move alike.
    if (type === 'toggle') controls.get(field.name).motion = switchMotion(/** @type {HTMLInputElement} */ (input));
    if (type === 'range') controls.get(field.name).motion = rangeMotion(/** @type {HTMLInputElement} */ (input));
    if (ensure) controls.get(field.name).ensure = ensure;
    return wrap;
  }

  /** @param {string} name @param {string} message */
  function setError(name, message) {
    const c = controls.get(name);
    if (!c) return;
    mark(name, message);
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
    formAlert.hidden = true;
    formAlert.textContent = '';
  }

  /** @returns {Record<string, any>} */
  function values() {
    const out = {};
    for (const [name] of controls) out[name] = valueOf(name);
    return out;
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
    drawn = fields;
    checker = compile(schemaFromFields(fields, spec.schema));
    touched.clear();
    controls.clear();
    clear(root);
    for (const field of fields) root.appendChild(buildControl(field));
    root.appendChild(formAlert);
    if (gateNote) root.appendChild(gateNote);
    if (bar) root.appendChild(bar);
    enter(root);
  }
  render(spec.fields || []);
  if (spec.gate && bar) gates.push(function (r) { gateState(submitBtn, gateNote, missingFrom(r)); });
  refreshGates();

  root.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!spec.onSubmit) return;
    if (showProblems() !== null) return;
    whileBusy(submitBtn, Promise.resolve().then(function () { return spec.onSubmit(values()); }))
      .catch(function (e) {
        const named = e && e.field && controls.has(e.field);
        if (named) {
          setError(e.field, e.message || String(e));
          const c = controls.get(e.field);
          if (c) /** @type {HTMLElement} */ (c.input).focus();
        } else {
          // A refusal about no one field (a closed form, a rate limit) stands above the buttons.
          formAlert.textContent = (e && e.message) || String(e);
          formAlert.hidden = false;
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
        if (c.ensure) c.ensure(next[name] == null ? '' : String(next[name]));
        if (type === 'checkbox' || type === 'toggle') /** @type {HTMLInputElement} */ (c.input).checked = !!next[name];
        else /** @type {HTMLInputElement} */ (c.input).value = next[name] == null ? '' : String(next[name]);
        refreshReadout(name);
        if (c.motion) c.motion.sync();
        if (touched.has(name)) recheck(name);
      }
      refreshGates();
    },
    setError: setError,
    clearErrors: clearErrors,
    /** Everything the rules say about what the form holds now: { valid, errors, fields, form }. */
    check: checkNow,
    /** Whether the named fields (all, when omitted) are filled in correctly. @param {string[]} [names] */
    ready(names) { return missingFrom(checkNow(), names).length === 0; },
    /** The named fields (all, when omitted) that are not yet filled in correctly. @param {string[]} [names] */
    missing(names) { return missingFrom(checkNow(), names); },
    /**
     * Hold a button of the host's own (Next, in a form of several steps) until the named fields are
     * right. Held, it is aria-disabled and still focusable, and a line after it names what is
     * missing; pressed anyway, it shows those fields' problems and moves focus to the first.
     * @param {string|Element} target @param {string[]} [names]
     */
    gate(target, names) {
      const button = /** @type {HTMLElement} */ (resolve(target));
      const note = el('p', { class: 'ak-form__gate', 'data-ak-part': 'gate', 'aria-live': 'polite' });
      button.insertAdjacentElement('afterend', note);
      /** @param {MouseEvent} ev */
      const hold = function (ev) {
        if (missingFrom(checkNow(), names).length === 0) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        showProblems(names || Array.from(controls.keys()));
      };
      button.addEventListener('click', hold, true);
      /** @param {any} r */
      const g = function (r) { gateState(button, note, missingFrom(r, names)); };
      gates.push(g);
      g(checkNow());
      return {
        refresh() { g(checkNow()); },
        destroy() {
          button.removeEventListener('click', hold, true);
          button.removeAttribute('aria-disabled');
          if (note.parentNode) note.parentNode.removeChild(note);
          const i = gates.indexOf(g);
          if (i >= 0) gates.splice(i, 1);
        },
      };
    },
    /** @param {{ fields?: FormField[], schema?: Record<string, any> }} patch */
    set(patch) {
      if (patch && patch.schema !== undefined) spec.schema = patch.schema;
      if (patch && (patch.fields || patch.schema !== undefined)) render(patch.fields || drawn);
      refreshGates();
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
