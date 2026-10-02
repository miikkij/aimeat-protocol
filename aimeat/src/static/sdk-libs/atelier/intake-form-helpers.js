/**
 * @file atelier/intake-form-helpers.js
 * @description The constants and helpers the public-form components (intake-form.js: intakeForm
 *   and intakeAdmin) share: the field types, the honeypot name, the node's form id rule, the page's
 *   AIMEAT.intake, the signed-out check, what a copied link carries, the sample form and the sample
 *   list, a label written per language read in the page language, the fields relabelled for the
 *   visitor, and whether an app's create(name) answered a definition still to be saved.
 *
 *   PURE EXTRACTION from intake-form.js on 2026-10-02, moved when the per-language labels, the
 *   app's create(name) and the row actions took that file past the 800-line ceiling. The helpers
 *   moved unchanged; inLanguage, labelled and isDefinition were written in the same change.
 * @structure TYPES · HONEYPOT · FORM_ID_RE · intakeOf · signedOut · linkedFormId · linkedWorkspace ·
 *   unset · sampleForm · inLanguage · labelled · SAMPLE_FORMS · isDefinition
 * @usage import { intakeOf, labelled, sampleForm } from './intake-form-helpers.js';
 * @version-history
 *   v0.63.0 — 2026-10-02 — Extracted from intake-form.js; inLanguage, labelled and isDefinition added.
 */
import { i18n } from './i18n.js';
import { ti } from './intake-connect-i18n.js';
import { isPlaceholder } from './members-shared.js';

/** The ten types fields() answers, in the order the Create form offers them. */
export const TYPES = ['text', 'textarea', 'email', 'tel', 'url', 'number', 'date', 'select', 'radio', 'checkbox'];

/** The honeypot every form made here carries: a name a crawler fills and a person never sees. */
export const HONEYPOT = 'company_url';

/** The node's form id rule (routes/organisms/intake.ts FORM_ID_RE). */
export const FORM_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** The page's AIMEAT.intake, or null. */
export function intakeOf() {
  const ns = /** @type {any} */ (window).AIMEAT;
  return ns && ns.intake ? ns.intake : null;
}

/** True when the page knows for certain that nobody is signed in. */
export function signedOut() {
  const ns = /** @type {any} */ (window).AIMEAT;
  const auth = ns && ns.auth;
  return !!(auth && typeof auth.getSession === 'function' && !auth.getSession());
}

/** The form id a copied link carries (`?form=`), or ''. */
export function linkedFormId() {
  try {
    return new URLSearchParams(window.location.search || '').get('form') || '';
  } catch {
    return '';
  }
}

/** The organism and workspace a copied link carries (`?org=&ws=`), or null. */
export function linkedWorkspace() {
  try {
    const q = new URLSearchParams(window.location.search || '');
    const org = q.get('org') || '';
    const ws = q.get('ws') || '';
    return org && ws ? { org: org, ws: ws } : null;
  } catch {
    return null;
  }
}

/** Whether a prop is missing or still a fill's placeholder. */
export function unset(v) {
  return !v || isPlaceholder(v);
}

/**
 * The sample form: every type once, in the shape fields() answers. Built at draw time so the
 * labels follow the language.
 * @returns {{ title: string, honeypot_field: string, fields: any[] }}
 */
export function sampleForm() {
  const opt = function (keys) { return keys.map(function (k) { return { value: k, label: ti('intake.sample.' + k) }; }); };
  return {
    title: '',
    honeypot_field: HONEYPOT,
    fields: [
      { name: 'name', label: ti('intake.sample.name'), type: 'text', required: true, maxLength: 200 },
      { name: 'email', label: ti('intake.sample.email'), type: 'email', required: true, maxLength: 320 },
      { name: 'phone', label: ti('intake.sample.phone'), type: 'tel', required: false, maxLength: 40 },
      { name: 'site', label: ti('intake.sample.site'), type: 'url', required: false, maxLength: 400 },
      { name: 'people', label: ti('intake.sample.people'), type: 'number', required: false },
      { name: 'day', label: ti('intake.sample.day'), type: 'date', required: false },
      { name: 'topic', label: ti('intake.sample.topic'), type: 'select', required: true, options: opt(['order', 'question', 'other']) },
      { name: 'found', label: ti('intake.sample.found'), type: 'radio', required: false, options: opt(['friend', 'search', 'social']) },
      { name: 'message', label: ti('intake.sample.message'), type: 'textarea', required: true, maxLength: 4000 },
      { name: 'consent', label: ti('intake.sample.consent'), type: 'checkbox', required: false },
    ],
  };
}

/**
 * A stored label in the page language. Text is itself; an object of languages ({ en, fi, es }) is
 * read in the page language, then English, then the first language that has text.
 * @param {unknown} v
 * @returns {string} '' when there is nothing to read
 */
export function inLanguage(v) {
  if (v == null) return '';
  if (typeof v !== 'object') return String(v);
  const by = /** @type {Record<string, unknown>} */ (v);
  const lang = String(i18n.lang() || 'en').slice(0, 2);
  for (const k of [lang, 'en']) {
    if (typeof by[k] === 'string' && by[k]) return /** @type {string} */ (by[k]);
  }
  for (const k in by) {
    if (typeof by[k] === 'string' && by[k]) return /** @type {string} */ (by[k]);
  }
  return '';
}

/**
 * The fields as the visitor reads them. fields() turns a label object into text, so a label (or a
 * choice's label) written per language is read here from the stored definition; then the app's
 * label(field) answers last, a string replacing the label and null keeping it.
 * @param {any} def   the descriptor (or the sample)
 * @param {any[]} list fields() of it
 * @param {((field: any, lang: string) => string|null|undefined)|undefined} labelFn
 * @returns {any[]}
 */
export function labelled(def, list, labelFn) {
  /** @type {Map<string, any>} */
  const raw = new Map();
  for (const f of (def && Array.isArray(def.fields) ? def.fields : [])) {
    if (f && typeof f === 'object') raw.set(String(f.key != null ? f.key : f.name), f);
  }
  return list.map(function (f) {
    const r = raw.get(f.name);
    const out = Object.assign({}, f);
    if (r && r.label && typeof r.label === 'object') out.label = inLanguage(r.label) || f.name;
    if (r && Array.isArray(r.options) && Array.isArray(f.options)) {
      /** @type {Map<string, string>} */
      const words = new Map();
      for (const o of r.options) {
        if (o && typeof o === 'object' && o.value != null && o.label && typeof o.label === 'object') {
          words.set(String(o.value), inLanguage(o.label));
        }
      }
      if (words.size) {
        out.options = f.options.map(function (o) {
          return words.has(o.value) ? { value: o.value, label: words.get(o.value) || o.value } : o;
        });
      }
    }
    if (typeof labelFn === 'function') {
      try {
        const own = labelFn(Object.assign({}, out), i18n.lang());
        if (typeof own === 'string' && own) out.label = own;
      } catch (e) {
        console.warn('[atelier] intakeForm label() threw; the stored label stays:', e);
      }
    }
    return out;
  });
}

/** The owner's list in the sample, shaped like listForms() answers. */
export const SAMPLE_FORMS = [
  { form_id: 'contact-us', title: 'Contact us', enabled: true, discoverable: true, mode: 'publish', allowed_fields: ['name', 'email', 'message'], submissions: 12 },
  { form_id: 'frm_q7k2m9x4w1p8z3n6', title: 'Autumn party RSVP', enabled: true, discoverable: false, mode: 'draft', allowed_fields: ['name', 'people'], submissions: 1 },
];

/**
 * Whether create(name) answered a definition still to be saved, rather than defineForm's own
 * answer (form_id and submit_url) or nothing.
 * @param {any} v
 */
export function isDefinition(v) {
  return !!(v && typeof v === 'object' && !v.submit_url && (Array.isArray(v.allowed_fields) || Array.isArray(v.fields)));
}
