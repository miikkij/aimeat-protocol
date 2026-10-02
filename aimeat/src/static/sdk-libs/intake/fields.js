/**
 * @file intake/fields.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two readings a form renderer needs from the intake routes, so that no renderer
 *   derives them again: fields(form) turns whatever form shape it is given (the public descriptor
 *   from getForm, the definition passed to defineForm, an entry of listForms, or a bare field list)
 *   into one normalised list; refusalField(error) names the field a refused submission concerns,
 *   from what the node sent. Two apps had each written the first one by hand (cadence, suppilo), and
 *   one of them drew the honeypot as a visible field because the descriptor lists it.
 * @structure NODE_MAX_VALUE · fields(form) · refusalField(error)
 * @usage import { fields, refusalField } from './fields.js';
 * @version-history
 *   v1.0.1 - 2026-10-02 - A label written per language ({ en, fi, es }) reads as its English text,
 *     not as "[object Object]".
 *   v1.0.0 - 2026-10-01 - Initial: fields() and refusalField() for the kit's public-form block.
 */

/** The node refuses a submitted string longer than this (routes/organisms/intake.ts MAX_VALUE_LEN). */
export const NODE_MAX_VALUE = 8000;

/** The types a renderer draws as such; anything else is drawn as one line of text. */
const KNOWN_TYPES = ['text', 'textarea', 'email', 'tel', 'url', 'number', 'date', 'select', 'radio', 'checkbox'];
/** Types whose value is free text, so the node's length limit applies to them. */
const TEXT_TYPES = ['text', 'textarea', 'email', 'tel', 'url'];
/** Types that are drawn from a list of options and mean nothing without one. */
const CHOICE_TYPES = ['select', 'radio'];

/**
 * A stored label as text. A label written per language ({ en, fi, es }) gives its English, else the
 * first language with text; the kit's block reads the page language itself from the raw definition.
 * @param {unknown} label
 * @returns {string}
 */
function labelText(label) {
  if (label == null) return '';
  if (typeof label !== 'object') return String(label);
  const byLang = /** @type {Record<string, unknown>} */ (label);
  if (typeof byLang.en === 'string' && byLang.en) return byLang.en;
  for (const k of Object.keys(byLang)) if (typeof byLang[k] === 'string' && byLang[k]) return /** @type {string} */ (byLang[k]);
  return '';
}

/**
 * One field of a form, in the shape a renderer draws.
 * @typedef {Object} IntakeField
 * @property {string} name        The key the value is submitted under.
 * @property {string} label       What the person reads; the name when the form gives none.
 * @property {string} type        One of text, textarea, email, tel, url, number, date, select, radio, checkbox.
 * @property {boolean} required   The node refuses the submission without a value for it.
 * @property {Array<{ value: string, label: string }>} [options]  For select and radio.
 * @property {number} [maxLength] For the free-text types: the form's own limit, never above the node's.
 */

/**
 * The options of a choice field, as value and label pairs. Plain strings are both.
 * @param {unknown} raw
 * @returns {Array<{ value: string, label: string }>}
 */
function options(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Array<{ value: string, label: string }>} */
  const out = [];
  for (const o of raw) {
    if (typeof o === 'string' || typeof o === 'number') out.push({ value: String(o), label: String(o) });
    else if (o && typeof o === 'object' && o.value != null) {
      out.push({ value: String(o.value), label: o.label != null ? String(o.label) : String(o.value) });
    }
  }
  return out;
}

/**
 * A positive whole number, or undefined.
 * @param {unknown} v
 * @returns {number|undefined}
 */
function positiveInt(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * The fields of a form, normalised, in the form's order, without the honeypot.
 *
 * Accepts the public descriptor (getForm: fields[].key, honeypot_field), the definition given to
 * defineForm (fields[], allowed_fields, required_fields, honeypot_field), an entry of listForms
 * (allowed_fields only), or a bare array of field objects. A form with no `fields` list gets one
 * text field per allowed field. A select or radio with no options is drawn as text, because a
 * choice with nothing to choose cannot be answered.
 * @param {any} form
 * @returns {IntakeField[]}
 */
export function fields(form) {
  if (!form) return [];
  const list = Array.isArray(form) ? form : form.fields;
  const allowed = Array.isArray(form.allowed_fields) ? form.allowed_fields : (Array.isArray(form.allowedFields) ? form.allowedFields : []);
  const requiredRaw = Array.isArray(form.required_fields) ? form.required_fields : (Array.isArray(form.requiredFields) ? form.requiredFields : []);
  const required = new Set(requiredRaw.map(String));
  const honeypot = form.honeypot_field || form.honeypotField || null;
  const source = Array.isArray(list) && list.length ? list : allowed.map((k) => ({ key: k }));

  /** @type {IntakeField[]} */
  const out = [];
  const seen = new Set();
  for (const f of source) {
    const raw = typeof f === 'string' ? { key: f } : (f || {});
    const name = raw.key != null ? String(raw.key) : (raw.name != null ? String(raw.name) : '');
    if (!name || name === honeypot || seen.has(name)) continue;
    seen.add(name);
    let type = typeof raw.type === 'string' ? raw.type.toLowerCase() : 'text';
    if (KNOWN_TYPES.indexOf(type) === -1) type = 'text';
    const opts = options(raw.options);
    if (CHOICE_TYPES.indexOf(type) !== -1 && !opts.length) type = 'text';
    /** @type {IntakeField} */
    const field = {
      name,
      label: labelText(raw.label) || name,
      type,
      required: raw.required === true || required.has(name),
    };
    if (CHOICE_TYPES.indexOf(type) !== -1) field.options = opts;
    if (TEXT_TYPES.indexOf(type) !== -1) {
      const own = positiveInt(raw.maxLength != null ? raw.maxLength : raw.max_length);
      field.maxLength = own ? Math.min(own, NODE_MAX_VALUE) : NODE_MAX_VALUE;
    }
    out.push(field);
  }
  return out;
}

/**
 * The first segment of a JSON pointer ('/email' or '/tags/0'), unescaped.
 * @param {unknown} path
 * @returns {string|undefined}
 */
function firstSegment(path) {
  if (typeof path !== 'string') return undefined;
  const seg = path.split('/')[1];
  return seg ? seg.replace(/~1/g, '/').replace(/~0/g, '~') : undefined;
}

/**
 * The field a refused submission concerns, when the node's answer names one; else undefined.
 *
 * Read in this order: `details.field`; the two messages that name a field (MISSING_FIELD "Missing
 * required field: x", INVALID_INPUT "Field 'x' is too long"); the first schema violation of a
 * SCHEMA_VALIDATION_FAILED (its path, or the property its params name).
 * @param {{ code?: string, message?: string, details?: any } | null | undefined} error  The envelope's `error`.
 * @returns {string|undefined}
 */
export function refusalField(error) {
  if (!error) return undefined;
  const d = error.details;
  if (d && typeof d === 'object' && !Array.isArray(d) && typeof d.field === 'string') return d.field;
  const msg = String(error.message || '');
  const m = /^Missing required field: (.+)$/.exec(msg) || /^Field '([^']+)' is too long$/.exec(msg);
  if (m) return m[1];
  if (Array.isArray(d)) {
    for (const v of d) {
      if (!v || typeof v !== 'object') continue;
      const fromPath = firstSegment(v.path);
      if (fromPath) return fromPath;
      const p = v.params || {};
      if (typeof p.missingProperty === 'string') return p.missingProperty;
      if (typeof p.additionalProperty === 'string') return p.additionalProperty;
    }
  }
  return undefined;
}
