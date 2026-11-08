/**
 * @file public/views/profile/receivers/commands.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two ready commands the incoming webhook's key-once view shows under the API key:
 *   one for a POSIX shell (macOS, Linux, Git Bash) and one for Windows PowerShell, each with the
 *   address, the API key and an example message already in it, so a person pastes and runs it with
 *   nothing to edit. The example message comes from the incoming webhook's data description (CSM)
 *   when it has one, else from the sample the page was opened with (the living document's gear
 *   sends `&sample=`), else `{"value": 1}`. Nothing here stores the key: the commands are built from
 *   the key the dialog holds and leave with the dialog.
 *
 *   QUOTING. POSIX: every value in single quotes, a single quote inside becomes '\'' (close, an
 *   escaped quote, open again); nothing inside single quotes is expanded, `!` included. PowerShell
 *   (5.1 and 7): every value in single quotes, a single quote inside is doubled. PowerShell also
 *   reads the typographic quotes U+2018, U+2019, U+201A and U+201B as single quotes, so each of those
 *   is doubled too. `$`, backticks, `%` and `&` are text inside a single-quoted string in both shells.
 *   The PowerShell line uses Invoke-RestMethod, a cmdlet, so no native argument passing rewrites the
 *   JSON's double quotes, and it names charset=utf-8 so Windows PowerShell 5.1 sends the body as
 *   UTF-8.
 * @structure posixQuote · psQuote · absoluteAddress · commandAddress · bashCommand ·
 *   powershellCommand · exampleFromSchema · sampleFromAddress · exampleBody · DEFAULT_EXAMPLE ·
 *   SAMPLE_MAX
 * @usage import { bashCommand, powershellCommand, commandAddress } from './commands.js';
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial: the ready commands with the API key in them (developer, 2026-11-08:
 *     "rimpsun JOKA TEKEE SEN ETTEI MUN TARVI KOPIOIDA MITÄÄN"; secaudit2026nov08b round 15d).
 */

import { swallowed } from '/js/swallowed.js';

/** The example message when nothing better is known. */
export const DEFAULT_EXAMPLE = '{"value":1}';

/** The longest sample, in characters of JSON, the page takes from its address. */
export const SAMPLE_MAX = 1000;

/** One POSIX shell argument in single quotes. */
export const posixQuote = (text) => "'" + String(text).replace(/'/g, "'\\''") + "'";

/** One PowerShell string in single quotes: a single quote, straight or typographic, is doubled. */
export const psQuote = (text) => "'" + String(text).replace(/['‘’‚‛]/g, (q) => q + q) + "'";

/**
 * The address as a full URL. The server names it from its public base (config.baseUrl); a node
 * without one answers a path, and the page then puts its own origin in front: this page is served by
 * the node itself, never by an app origin.
 */
export function absoluteAddress(address, origin) {
  const a = String(address || '');
  if (/^https?:\/\//i.test(a)) return a;
  return String(origin || '').replace(/\/$/, '') + (a.startsWith('/') ? a : '/' + a);
}

/** The address a command calls: the full address, the last part a prefix target needs, and the test switch. */
export function commandAddress(r, origin, dryRun) {
  const sub = r?.target?.kind === 'prefix' ? '/example' : '';
  return absoluteAddress(r?.address, origin) + sub + (dryRun ? '?dry_run=true' : '');
}

/** The call for sh, bash and zsh. */
export function bashCommand({ url, key, body }) {
  return 'curl -X POST ' + posixQuote(url)
    + " -H 'Content-Type: application/json'"
    + ' -H ' + posixQuote('Authorization: Bearer ' + key)
    + ' -d ' + posixQuote(body);
}

/** The same call for Windows PowerShell 5.1 and PowerShell 7, on one line. */
export function powershellCommand({ url, key, body }) {
  return 'Invoke-RestMethod -Method Post -Uri ' + psQuote(url)
    + ' -Headers @{ Authorization = ' + psQuote('Bearer ' + key) + ' }'
    + " -ContentType 'application/json; charset=utf-8'"
    + ' -Body ' + psQuote(body);
}

const pick = (list) => (Array.isArray(list) && list.length ? list[0] : undefined);

/** A text that fits minLength and maxLength. */
function textOf(s) {
  let v = 'test';
  const min = Number.isInteger(s.minLength) ? s.minLength : 0;
  const max = Number.isInteger(s.maxLength) ? s.maxLength : Infinity;
  while (v.length < min) v += ' test';
  return v.slice(0, Math.max(min, Math.min(max, v.length)));
}

/** A number that fits minimum, maximum and multipleOf. */
function numberOf(s, integer) {
  let v = typeof s.minimum === 'number' ? s.minimum
    : typeof s.exclusiveMinimum === 'number' ? s.exclusiveMinimum + 1 : 1;
  if (typeof s.maximum === 'number' && v > s.maximum) v = s.maximum;
  if (typeof s.exclusiveMaximum === 'number' && v >= s.exclusiveMaximum) v = s.exclusiveMaximum - 1;
  if (typeof s.multipleOf === 'number' && s.multipleOf > 0) v = Math.ceil(v / s.multipleOf) * s.multipleOf;
  return integer ? Math.ceil(v) : v;
}

function typeOf(s) {
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
  if (t) return t;
  if (s.properties) return 'object';
  if (s.items) return 'array';
  return '';
}

/**
 * One value that a JSON Schema takes, for an example message: a value the schema names (const,
 * examples, example, default, the first enum value) when it names one, else a value built to its
 * rules. A string whose `pattern` the page cannot satisfy gets a placeholder `<field>`, the one value
 * a person then writes in.
 */
export function exampleFromSchema(schema, name = 'value', depth = 0) {
  const s = schema && typeof schema === 'object' ? schema : {};
  if (depth > 8) return null;
  if ('const' in s) return s.const;
  if (pick(s.examples) !== undefined) return pick(s.examples);
  if ('example' in s) return s.example;
  if ('default' in s) return s.default;
  if (pick(s.enum) !== undefined) return pick(s.enum);
  if (pick(s.oneOf)) return exampleFromSchema(s.oneOf[0], name, depth + 1);
  if (pick(s.anyOf)) return exampleFromSchema(s.anyOf[0], name, depth + 1);
  if (Array.isArray(s.allOf) && s.allOf.length) {
    const parts = s.allOf.map((p) => exampleFromSchema(p, name, depth + 1));
    if (parts.every((p) => p && typeof p === 'object' && !Array.isArray(p))) return Object.assign({}, ...parts);
    return parts[0];
  }
  switch (typeOf(s)) {
    case 'object': {
      const props = s.properties && typeof s.properties === 'object' ? s.properties : {};
      const required = Array.isArray(s.required) ? s.required : [];
      const names = required.length ? required : Object.keys(props).slice(0, 8);
      const out = {};
      for (const k of names) out[k] = exampleFromSchema(props[k], k, depth + 1);
      return out;
    }
    case 'array': {
      if (s.maxItems === 0) return [];
      const n = Math.max(1, Number.isInteger(s.minItems) ? s.minItems : 1);
      const item = exampleFromSchema(s.items, name, depth + 1);
      const list = [];
      for (let i = 0; i < n; i += 1) list.push(item);
      return list;
    }
    case 'string': {
      if (s.format === 'date-time') return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      if (s.format === 'date') return new Date().toISOString().slice(0, 10);
      if (s.format === 'time') return '12:00:00';
      if (s.format === 'email') return 'alice@example.com';
      if (s.format === 'uri' || s.format === 'url' || s.format === 'iri') return 'https://example.com';
      if (s.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
      if (typeof s.pattern === 'string') return '<' + name + '>';
      return textOf(s);
    }
    case 'integer': return numberOf(s, true);
    case 'number': return numberOf(s, false);
    case 'boolean': return true;
    case 'null': return null;
    default: return 1;
  }
}

/**
 * The sample the page was opened with (`&sample=`), as compact JSON, or '' when there is none the
 * page takes: it must parse as JSON and be at most SAMPLE_MAX characters. It is only ever the
 * example message of the commands.
 */
export function sampleFromAddress(text) {
  if (typeof text !== 'string' || !text || text.length > SAMPLE_MAX * 3) return '';
  try {
    const out = JSON.stringify(JSON.parse(text));
    return out && out.length <= SAMPLE_MAX ? out : '';
  } catch (e) {
    swallowed('receivers: the sample on the address is not JSON', e);
    return '';
  }
}

/**
 * The example message, as compact JSON: the data description's, the address's sample, or the default.
 * @param {{ jsonSchema?: any, sample?: string }} [from]
 * @returns {string}
 */
export function exampleBody({ jsonSchema, sample } = {}) {
  if (jsonSchema && typeof jsonSchema === 'object') return JSON.stringify(exampleFromSchema(jsonSchema));
  return sampleFromAddress(sample) || DEFAULT_EXAMPLE;
}
