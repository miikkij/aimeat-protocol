/**
 * @file validate/core.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Checks a value against a JSON Schema and says, per field and in the person's
 *   language, what is wrong and what the field expects. Pure computation: no fetch, no storage, no
 *   DOM. The served AIMEAT.validate and the Atelier form both run this file.
 *
 *   ONE RULE FOR THE PERSON, THE AGENT AND THE NODE. The schema is data, so the same object locks a
 *   workspace space on the node (PUT /v1/memory/:key/schema, aimeat_workspace_update), is read by an
 *   agent before it writes, and checks a form here before anything is sent. The node's validator is
 *   Ajv in draft-07 strict mode, so this file speaks draft-07: `dependencies` and `if`/`then` for
 *   rules between fields (Ajv refuses `dependentRequired`), and only formats both sides know. The
 *   annotation keywords below are registered on the node as well (src/services/input-formats.ts).
 *
 *   WHY @cfworker/json-schema AND NOT AJV. Ajv compiles a schema into code with `new Function`, and
 *   a published app runs under a CSP without 'unsafe-eval' (src/routes/apps/read.ts). This
 *   validator interprets the schema instead. MIT, no dependencies.
 *
 *   KEYWORDS THIS FILE ADDS, all prefixed x- so a standard validator ignores them:
 *     x-hint      string or { en, fi, es }: what the field expects, shown before anything is typed
 *     x-messages  { <rule>: string or { en, fi, es } }: the words for one rule of one field
 *     x-same-as   the name of a sibling property this one must equal (a repeated email or password)
 *
 *   AN EMPTY ANSWER IS NO ANSWER. A form hands back '' for a field nobody filled in. Before the
 *   check, '' and null are taken out of an object (keepEmpty: true turns that off), so an empty
 *   optional field passes and an empty required field reads as missing rather than as a wrong format.
 * @structure lang · compile(schema) → { check, field, ready, missing, hint, label } · check · hint ·
 *   addFormat · formats
 * @usage
 *   const form = compile({ type: 'object', required: ['ytunnus'],
 *     properties: { ytunnus: { type: 'string', title: 'Y-tunnus', format: 'fi-business-id' } } });
 *   form.check({ ytunnus: '0737546-3' }, { lang: 'fi' }).fields.ytunnus.message
 *   // 'Y-tunnuksen tarkistusnumero ei täsmää. Tarkista numerot.'
 *   form.ready(values, ['ytunnus', 'email'])   // true when both are filled in correctly
 * @version-history
 *   v1.0.0 - 2026-10-05 - Initial (wish-sy-tteiden-validointi-sovelluksiin-yksi-json-schema-ui-lle-a).
 */
import { Validator, format as FORMAT_TABLE } from '@cfworker/json-schema';
import { FORMAT_TESTS } from './formats.js';
import { MESSAGES, FORMAT_HINTS, FORMAT_MESSAGES, LIST_WORD } from './messages.js';

/** The languages this file writes. Anything else reads as English. */
const LANGS = ['en', 'fi', 'es'];

/** Formats a page added with addFormat(): name → { test, hint, message }. */
const CUSTOM = {};

for (const name of Object.keys(FORMAT_TESTS)) {
  FORMAT_TABLE[name] = function (/** @type {string} */ v) { return FORMAT_TESTS[name](v) === true; };
}

/**
 * Keywords whose error only says that something below them failed. The failures below are
 * reported instead, so a person reads one message per problem rather than three.
 */
const WRAPPERS = new Set(['properties', 'patternProperties', 'additionalProperties', 'unevaluatedProperties',
  'allOf', 'if', '$ref', '$recursiveRef', 'items', 'prefixItems', 'additionalItems', 'unevaluatedItems',
  'dependentSchemas', 'propertyNames', 'contains']);

/**
 * The language to write in: the caller's, else the platform's choice, else the page's, else English.
 * @param {string} [wanted]
 * @returns {string}
 */
export function lang(wanted) {
  let l = wanted;
  const ns = typeof window !== 'undefined' ? /** @type {any} */ (window).AIMEAT : null;
  if (!l && ns && ns.auth && typeof ns.auth.getLang === 'function') l = ns.auth.getLang();
  if (!l && typeof document !== 'undefined') l = document.documentElement.lang;
  if (!l && typeof navigator !== 'undefined') l = navigator.language;
  const short = String(l || 'en').slice(0, 2).toLowerCase();
  return LANGS.indexOf(short) >= 0 ? short : 'en';
}

/**
 * Text written once or per language, in the language asked for.
 * @param {unknown} text
 * @param {string} l
 * @returns {string}
 */
function inLang(text, l) {
  if (text == null) return '';
  if (typeof text !== 'object') return String(text);
  const byLang = /** @type {Record<string, unknown>} */ (text);
  if (typeof byLang[l] === 'string') return /** @type {string} */ (byLang[l]);
  if (typeof byLang.en === 'string') return /** @type {string} */ (byLang.en);
  for (const k of Object.keys(byLang)) if (typeof byLang[k] === 'string') return /** @type {string} */ (byLang[k]);
  return '';
}

/** @param {string} s @param {Record<string, unknown>} vars */
function fill(s, vars) {
  return s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : m; });
}

/** "A, B or C" in the language. @param {string[]} items @param {string} l */
function list(items, l) {
  if (items.length < 2) return items.join('');
  return items.slice(0, -1).join(', ') + ' ' + LIST_WORD[/** @type {'en'} */ (l)] + ' ' + items[items.length - 1];
}

/**
 * A copy of a value with '' and null taken out of every object in it.
 * @param {unknown} value
 * @returns {unknown}
 */
function dropEmpty(value) {
  if (Array.isArray(value)) return value.map(dropEmpty);
  if (!value || typeof value !== 'object') return value;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === '' || v === null || v === undefined) continue;
    out[k] = dropEmpty(v);
  }
  return out;
}

/** '#/a/b~1c' → ['a', 'b/c']. @param {string} pointer */
function segments(pointer) {
  return String(pointer || '#').replace(/^#\/?/, '').split('/').filter(Boolean).map(function (s) {
    return decodeURI(s).replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

/**
 * The schema of the property a path names, following `properties` only.
 * @param {any} schema
 * @param {string[]} path
 * @returns {any}
 */
function propSchema(schema, path) {
  let s = schema;
  for (const seg of path) {
    if (!s || typeof s !== 'object') return null;
    if (s.properties && s.properties[seg]) s = s.properties[seg];
    else if (s.items && typeof s.items === 'object' && /^\d+$/.test(seg)) s = s.items;
    else return null;
  }
  return s;
}

/** The value at a path. @param {unknown} value @param {string[]} path */
function at(value, path) {
  let v = /** @type {any} */ (value);
  for (const seg of path) { if (v == null) return undefined; v = v[seg]; }
  return v;
}

/**
 * The schema a validator keywordLocation ('#/properties/a/anyOf') points at, or null.
 * @param {any} schema @param {string} pointer
 */
function atPointer(schema, pointer) {
  let s = schema;
  for (const seg of segments(pointer)) {
    if (s == null || typeof s !== 'object') return null;
    s = s[seg];
  }
  return s == null ? null : s;
}

/**
 * The fields of an anyOf or oneOf whose every branch only asks for fields to be present
 * ([{ required: ['phone'] }, { required: ['email'] }] → ['phone', 'email']). Any other shape of
 * branch answers [], and the message then speaks of the details in general.
 * @param {any} branches
 * @returns {string[]}
 */
function choiceFields(branches) {
  if (!Array.isArray(branches)) return [];
  /** @type {string[]} */
  const out = [];
  for (const b of branches) {
    if (!b || typeof b !== 'object' || !Array.isArray(b.required)) return [];
    const extra = Object.keys(b).filter(function (k) { return k !== 'required' && k !== 'title' && k !== 'description' && k.indexOf('x-') !== 0; });
    if (extra.length) return [];
    for (const r of b.required) if (out.indexOf(r) < 0) out.push(r);
  }
  return out;
}

/** The last number in a validator message ("… (3 < 5)." → 5). @param {string} text */
function lastNumber(text) {
  const m = /(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\D*$/i.exec(text);
  return m ? Number(m[1]) : null;
}

/** The quoted names in a validator message, in order. @param {string} text @returns {string[]} */
function quoted(text) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

/**
 * One problem with a value, in the shape a form places next to a field.
 * @typedef {object} Issue
 * @property {string} field     the dotted path of the field ('' for the whole value)
 * @property {string[]} [fields] the fields a rule between fields names (anyOf, oneOf)
 * @property {string} rule      the JSON Schema keyword that refused, or 'sameAs'
 * @property {string} message   what the person reads
 * @property {string} hint      what the field expects ('' when the schema says nothing)
 * @property {Record<string, unknown>} params  the numbers and names the message used
 */

/**
 * The result of a check.
 * @typedef {object} Result
 * @property {boolean} valid
 * @property {Issue[]} errors                 every problem, in the order the schema lists them
 * @property {Record<string, Issue>} fields   the first problem per field
 * @property {Issue[]} form                   problems that belong to no one field
 */

/**
 * @typedef {object} CheckOptions
 * @property {string} [lang]                     en, fi or es
 * @property {Record<string, string>} [labels]  field → the label a person sees, for messages that name another field
 * @property {boolean} [keepEmpty]               check '' and null as given values
 */

/**
 * Compile a schema once and check values against it as often as needed.
 * @param {object} schema  a JSON Schema (draft-07)
 */
export function compile(schema) {
  const root = /** @type {any} */ (schema || {});
  const validator = new Validator(/** @type {any} */ (root), '7', false);
  const order = Object.keys(root.properties || {});

  /** Where a field stands in the schema's order; a field of no property and the whole value last. @param {string} field */
  function place(field) {
    if (!field) return order.length + 1;
    const i = order.indexOf(field.split('.')[0]);
    return i < 0 ? order.length : i;
  }

  /** @param {string} field @param {CheckOptions} opts @param {string} l */
  function label(field, opts, l) {
    if (opts.labels && opts.labels[field]) return opts.labels[field];
    const s = propSchema(root, field ? field.split('.') : []);
    return (s && inLang(s.title, l)) || field;
  }

  /** What a field expects. @param {string} field @param {string} [wanted] */
  function hint(field, wanted) {
    const l = lang(wanted);
    const s = propSchema(root, field ? field.split('.') : []);
    if (!s) return '';
    if (s['x-hint']) return inLang(s['x-hint'], l);
    if (s.format && CUSTOM[s.format] && CUSTOM[s.format].hint) return inLang(CUSTOM[s.format].hint, l);
    if (s.format) return FORMAT_HINTS[l][s.format] || '';
    return '';
  }

  /**
   * The words for one problem: the field's own x-messages first, then this file's.
   * @param {string} field @param {string} rule @param {string} key @param {Record<string, unknown>} vars @param {string} l
   */
  function words(field, rule, key, vars, l) {
    const s = propSchema(root, field ? field.split('.') : []);
    const own = s && s['x-messages'] && s['x-messages'][rule];
    return fill(own ? inLang(own, l) : MESSAGES[l][key], vars);
  }

  /** @param {unknown} values @param {CheckOptions} [options] @returns {Result} */
  function check(values, options) {
    const opts = options || {};
    const l = lang(opts.lang);
    const data = opts.keepEmpty ? values : dropEmpty(values);
    const raw = validator.validate(data).errors;
    /** @type {Issue[]} */
    const issues = [];
    /** @param {string} field @param {string} rule @param {string} message @param {Record<string, unknown>} params @param {string[]} [fields] */
    const add = function (field, rule, message, params, fields) {
      /** @type {Issue} */
      const issue = { field: field, rule: rule, message: message, hint: hint(field, l), params: params };
      if (fields) issue.fields = fields;
      issues.push(issue);
    };
    const nested = raw.filter(function (e) { return /\/(anyOf|oneOf|not)\/\d+/.test(e.keywordLocation); });

    for (const e of raw) {
      const kw = e.keyword;
      if (WRAPPERS.has(kw)) continue;
      // An error inside an anyOf or oneOf branch is a branch that did not match, not a problem
      // of its own; the anyOf or oneOf error below speaks for all its branches.
      if (nested.indexOf(e) >= 0) continue;
      const path = segments(e.instanceLocation);
      const here = path.join('.');
      const value = at(data, path);

      if (kw === 'required' || (kw === 'dependencies' && /does not have/.test(e.error))) {
        const names = quoted(e.error);
        const field = (here ? here + '.' : '') + names[names.length - 1];
        if (kw === 'dependencies') {
          const other = label((here ? here + '.' : '') + names[0], opts, l);
          add(field, 'required', words(field, 'required', 'requiredBecause', { other: other }, l), { because: names[0] });
        } else {
          add(field, 'required', words(field, 'required', 'required', {}, l), {});
        }
        continue;
      }
      if (kw === 'dependencies') continue;
      if (kw === 'format') {
        const name = quoted(e.error)[0] || '';
        const custom = CUSTOM[name];
        const reason = custom ? custom.test(value) : FORMAT_TESTS[name] ? FORMAT_TESTS[name](String(value)) : 'shape';
        const reasonKey = typeof reason === 'string' ? reason : 'shape';
        const s = propSchema(root, path);
        const own = s && s['x-messages'] && s['x-messages'].format;
        let message;
        if (own) message = inLang(own, l);
        else if (custom && custom.message) message = inLang(custom.message, l);
        else {
          const table = FORMAT_MESSAGES[l][name];
          message = table ? (table[reasonKey] || table.shape) : MESSAGES[l].format;
        }
        add(here, 'format', message, { format: name, reason: reasonKey });
        continue;
      }
      if (kw === 'anyOf' || kw === 'oneOf') {
        const names = choiceFields(atPointer(root, e.keywordLocation)).map(function (n) { return (here ? here + '.' : '') + n; });
        const many = kw === 'oneOf' && !/\(0 matches\)/.test(e.error);
        const key = !names.length ? 'choice' : many ? 'oneOf' : 'anyOf';
        const labels = names.map(function (n) { return label(n, opts, l); });
        add(here, kw, words(here, kw, key, { fields: list(labels, l) }, l), { fields: names }, names.length ? names : undefined);
        continue;
      }
      /** @type {string} */
      let key = kw;
      /** @type {Record<string, unknown>} */
      const params = {};
      if (kw === 'minLength') { params.n = lastNumber(e.error); key = params.n === 1 ? 'minLength1' : 'minLength'; }
      else if (kw === 'maxLength') { params.n = lastNumber(e.error); params.len = typeof value === 'string' ? Array.from(value).length : ''; }
      else if (kw === 'minimum' || kw === 'maximum' || kw === 'exclusiveMinimum' || kw === 'exclusiveMaximum' || kw === 'multipleOf') params.n = lastNumber(e.error);
      else if (kw === 'minItems' || kw === 'maxItems') params.n = lastNumber(e.error);
      else if (kw === 'const') {
        const s = propSchema(root, path);
        const expected = s ? s.const : undefined;
        params.value = expected;
        if (expected === true) key = 'constTrue';
      } else if (kw === 'type') {
        const want = quoted(e.error).slice(1).join(' ');
        key = /\binteger\b/.test(want) ? 'typeInteger' : /\bnumber\b/.test(want) ? 'typeNumber' : 'type';
        params.expected = want;
      } else if (kw === 'false') key = 'additional';
      else if (!MESSAGES[l][kw]) key = 'choice';
      add(here, kw === 'false' ? 'additional' : kw, words(here, kw === 'false' ? 'additional' : kw, key, params, l), params);
    }

    sameAsIssues(root, /** @type {any} */ (data), [], function (field, other) {
      add(field, 'sameAs', words(field, 'sameAs', 'sameAs', { other: label(other, opts, l) }, l), { other: other });
    });

    // The order a person reads the form in: the schema's own order of properties, whole-value
    // problems last. The validator reports `required` before the properties it walks.
    issues.sort(function (a, b) { return place(a.field) - place(b.field); });

    /** @type {Record<string, Issue>} */
    const fields = {};
    /** @type {Issue[]} */
    const form = [];
    for (const i of issues) {
      if (!i.field) form.push(i);
      else if (!fields[i.field]) fields[i.field] = i;
    }
    return { valid: issues.length === 0, errors: issues, fields: fields, form: form };
  }

  /**
   * The names among `names` that are not yet filled in correctly; every field and the whole-value
   * problems when `names` is omitted.
   * @param {unknown} values @param {string[]} [names] @param {CheckOptions} [opts]
   * @returns {string[]}
   */
  function missing(values, names, opts) {
    const r = check(values, opts);
    /** @type {string[]} */
    const out = [];
    for (const i of r.errors) {
      const touched = [i.field].concat(i.fields || []);
      for (const f of touched) {
        if (names ? names.indexOf(f) >= 0 : true) { if (out.indexOf(f) < 0) out.push(f); }
      }
    }
    return out;
  }

  return {
    schema: root,
    check: check,
    /**
     * One field's problem, the whole value checked so a rule between fields counts.
     * @param {string} name @param {unknown} values @param {CheckOptions} [opts]
     * @returns {Issue|null}
     */
    field: function (name, values, opts) {
      const r = check(values, opts);
      if (r.fields[name]) return r.fields[name];
      return r.errors.find(function (i) { return (i.fields || []).indexOf(name) >= 0; }) || null;
    },
    /** Whether every named field (or the whole value) is filled in correctly. @param {unknown} values @param {string[]} [names] @param {CheckOptions} [opts] */
    ready: function (values, names, opts) { return missing(values, names, opts).length === 0; },
    missing: missing,
    hint: hint,
    /** @param {string} field @param {CheckOptions} [opts] */
    label: function (field, opts) { const o = opts || {}; return label(field, o, lang(o.lang)); },
  };
}

/**
 * Walk the objects of a value and report every `x-same-as` that does not hold.
 * @param {any} schema @param {any} data @param {string[]} path
 * @param {(field: string, other: string) => void} report
 */
function sameAsIssues(schema, data, path, report) {
  if (!schema || typeof schema !== 'object' || !schema.properties || !data || typeof data !== 'object') return;
  for (const [name, s] of Object.entries(schema.properties)) {
    const sub = /** @type {any} */ (s);
    if (!sub || typeof sub !== 'object') continue;
    const other = sub['x-same-as'];
    if (typeof other === 'string' && data[name] !== undefined && data[name] !== data[other]) {
      report(path.concat(name).join('.'), path.concat(other).join('.'));
    }
    if (sub.properties) sameAsIssues(sub, data[name], path.concat(name), report);
  }
}

/** A small cache, so check(schema, value) in a keystroke handler does not compile every time. */
const cache = new Map();

/**
 * Check a value against a schema in one call.
 * @param {object} schema @param {unknown} values @param {CheckOptions} [opts]
 * @returns {Result}
 */
export function check(schema, values, opts) {
  const key = JSON.stringify(schema);
  let c = cache.get(key);
  if (!c) {
    c = compile(schema);
    if (cache.size >= 50) cache.delete(cache.keys().next().value);
    cache.set(key, c);
  }
  return c.check(values, opts);
}

/**
 * What a field of a schema expects, in the person's language.
 * @param {object} schema @param {string} field @param {string} [wanted]
 */
export function hint(schema, field, wanted) {
  return compile(schema).hint(field, wanted);
}

/**
 * Add a format of the page's own. It is checked in the browser only: the node refuses a schema
 * lock that names a format it does not know, so a format both sides must check belongs in
 * formats.js and src/services/input-formats.ts.
 * @param {string} name
 * @param {(value: string) => boolean|string} test  true, false, or the reason the value fails
 * @param {{ hint?: string|Record<string, string>, message?: string|Record<string, string> }} [words]
 */
export function addFormat(name, test, words) {
  const w = words || {};
  CUSTOM[name] = {
    test: function (/** @type {unknown} */ v) { const r = test(String(v)); return r === true ? true : typeof r === 'string' ? r : 'shape'; },
    hint: w.hint,
    message: w.message,
  };
  FORMAT_TABLE[name] = function (/** @type {string} */ v) { return CUSTOM[name].test(v) === true; };
}

/** The formats a schema may name here: the validator's own, AIMEAT's and the page's. @returns {string[]} */
export function formats() {
  return Object.keys(FORMAT_TABLE).sort();
}
