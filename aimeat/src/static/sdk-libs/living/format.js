/**
 * @file living/format.js
 * @description HOW A NUMBER IS WRITTEN DOWN, in ONE place. A living document prints the same
 *   quantity in four different spots — the answer under a formula, the reading beside a slider,
 *   a value row, and the middle of a sentence — and until this module existed each of those had
 *   its own idea of what a number looks like. So a dew point came out as 15.7529759484 in the
 *   figure and as 15.8 in the caption, from the same node, in the same second.
 *
 *   `format` IS A DISPLAY INSTRUCTION AND NOTHING ELSE. It changes what is printed; it never
 *   changes what flows on through the graph. A formula whose answer is rounded to one decimal
 *   still hands the full number to everything standing on it, which is the difference between
 *   this and the round(expr, 1) a document used to have to write — that one put the rounding
 *   into the maths, and the printed formula then said something the author did not mean.
 *
 *   ONE VOCABULARY, TWO SHAPES. The words are the ones the sentence template already used after
 *   its bar ({{ t | 1 }}, {{ t | unit }}), so `"format": "1"` on a figure and `{{ t | 1 }}` in
 *   the caption print the same thing by construction. An object is the long form for the three
 *   things a word cannot carry: thousands separators, a currency, and where the unit goes.
 *
 *   THE DEFAULT IS DELIBERATELY LOCALE-FREE. With no grouping, no locale and no currency asked
 *   for, a number is written with toFixed or trimNumber — never through Intl — so a document
 *   reads the same on every machine that opens it. Ask for `group` or a `locale` and Intl takes
 *   over, which is the moment a person has said they want the local convention.
 *
 *   A FORMAT IS PER RECORD, NOT PER LANGUAGE, WITH ONE DOOR OUT. How many decimals a reading is
 *   worth and whether the unit goes before or after the number are facts about the measurement,
 *   so they do not change when the words do. The decimal separator and the thousands separator
 *   are not: 1 234,5 in Finnish is 1,234.5 in English, and a document that carries both languages
 *   would otherwise have to carry two formats to say one thing. `locale: "auto"` is that door —
 *   it hands the number to Intl in whatever language the page is reading, and nothing else about
 *   the format moves.
 * @structure FORMATS · parseFormat(spec) · formatError(spec) · formatNumber(n, spec, lang) ·
 *   formatParts(value, spec, defaultPlace, lang) · formatValue(value, spec, lang)
 * @usage
 *   import { formatParts, formatValue } from './format.js';
 *   formatValue({ n: 15.7529759484, u: celsius }, 1);            // '15.8'
 *   formatValue({ n: 15.7529759484, u: celsius }, { decimals: 1, unit: 'after' });  // '15.8 °C'
 *   formatParts(q, '2');   // { number: '15.75', unit: '°C', place: 'none', text: '15.75' }
 *   formatNumber(1234.5, { decimals: 1, group: true, locale: 'auto' }, 'fi');  // '1 234,5'
 * @version-history
 *   v0.4.0 — 2026-09-06 — `locale: "auto"` writes the number in the language the page is reading,
 *     so one record's one format serves every language it carries. Every printer takes the
 *     language as its last argument and ignores it unless the format asked for "auto".
 *   v0.3.0 — 2026-09-05 — Initial: `format` stops being a documented field nothing read.
 */
import { isError, isQuantity, asText, trimNumber } from './formula-eval.js';
import { unitLabel } from './units.js';

/** The named ways a value is written out. A bare number is that many decimals. */
export const FORMATS = ['unit', 'plain', 'int', 'percent', 'upper', 'lower', 'text', '<digits>'];

/** Where a quantity's unit goes when the printer assembles the whole line itself. */
const PLACES = ['after', 'before', 'none'];

/**
 * @typedef {object} Format
 * @property {number} [decimals]     exactly this many fraction digits
 * @property {number} [maxDecimals]  at most this many, trailing zeros dropped
 * @property {boolean} [group]       thousands separators (off unless asked for)
 * @property {string} [locale]       a BCP-47 tag, or "auto" for the language the page is reading;
 *   asking for either hands the number to Intl
 * @property {string} [style]        'decimal' · 'percent' (a fraction of one) · 'currency'
 * @property {string} [currency]     the ISO code, when style is 'currency'
 * @property {string} [place]        where the unit goes: 'after' · 'before' · 'none'
 * @property {string} [prefix]       literal text in front of the number
 * @property {string} [suffix]       literal text after it
 * @property {string} [word]         'upper' · 'lower', which act on the text rather than a number
 * @property {string} [unknown]      the spec as written, when it is not one this build knows
 */

/**
 * Read a format spec into the one shape the printer works from. `null` means "the default",
 * which is trimNumber and the caller placing the unit.
 * @param {any} spec
 * @returns {Format|null}
 */
export function parseFormat(spec) {
  if (spec == null || spec === '') return null;
  if (typeof spec === 'number') {
    return Number.isFinite(spec) ? { decimals: Math.max(0, Math.trunc(spec)) } : null;
  }
  if (typeof spec === 'string') {
    const f = spec.trim().toLowerCase();
    if (f === '' || f === 'text') return null;
    if (/^\d+$/.test(f)) return { decimals: Number(f) };
    if (f === 'unit') return { place: 'after' };
    if (f === 'plain') return { place: 'none' };
    if (f === 'int') return { decimals: 0 };
    if (f === 'percent') return { style: 'percent', maxDecimals: 1 };
    if (f === 'upper' || f === 'lower') return { word: f };
    // An unknown word prints the value with its unit, which is what this library did before the
    // formats had a name; the node types refuse it by name in prepare() so it is not silent.
    return { unknown: spec, place: 'after' };
  }
  if (typeof spec !== 'object' || Array.isArray(spec)) return { unknown: String(spec), place: 'after' };
  const out = {};
  if (typeof spec.decimals === 'number' && Number.isFinite(spec.decimals)) out.decimals = Math.max(0, Math.trunc(spec.decimals));
  if (typeof spec.maxDecimals === 'number' && Number.isFinite(spec.maxDecimals)) out.maxDecimals = Math.max(0, Math.trunc(spec.maxDecimals));
  if (spec.group === true) out.group = true;
  if (typeof spec.locale === 'string' && spec.locale) out.locale = spec.locale;
  if (spec.style === 'percent' || spec.style === 'currency' || spec.style === 'decimal') out.style = spec.style;
  if (typeof spec.currency === 'string' && spec.currency) out.currency = spec.currency;
  if (typeof spec.unit === 'string' && PLACES.indexOf(spec.unit) >= 0) out.place = spec.unit;
  if (typeof spec.prefix === 'string') out.prefix = spec.prefix;
  if (typeof spec.suffix === 'string') out.suffix = spec.suffix;
  if (spec.style === 'currency' && !out.currency) return { unknown: 'a currency format with no currency code' };
  return out;
}

/**
 * The refusal a format spec earns, in words, or null when it is one this build knows. Node types
 * call this in prepare(), so a typo is a line on the screen rather than a number that quietly
 * printed the wrong way.
 * @param {any} spec
 * @returns {string|null}
 */
export function formatError(spec) {
  const f = parseFormat(spec);
  if (!f || !f.unknown) return null;
  return 'a format I do not know, "' + String(f.unknown) + '". It knows ' + FORMATS.join(', ')
    + ', or an object with decimals, maxDecimals, group, locale, style, currency, unit, prefix and suffix';
}

/** Whether this spec needs Intl at all. Without one of these, the number is written by hand. */
function needsIntl(f) { return f.group === true || f.locale != null || f.style === 'currency'; }

/**
 * The BCP-47 tag Intl is actually given. "auto" is the record saying "whatever the page reads",
 * which is the ONE thing about a format that follows the language; a written-out tag is a
 * decision the record made and the page does not get to overrule it.
 * @param {Format} f @param {string} [lang]
 * @returns {string|undefined}
 */
function localeOf(f, lang) {
  if (f.locale === 'auto') return lang ? String(lang) : undefined;
  return f.locale || undefined;
}

/**
 * One number, written the way the spec asks. Never the unit: that is placed by formatParts, so a
 * display with its own unit element (the formula's answer, a control's readout) can keep it.
 * @param {number} n @param {any} spec @param {string} [lang]  the language, for `locale: "auto"`
 * @returns {string}
 */
export function formatNumber(n, spec, lang) {
  const f = parseFormat(spec) || {};
  if (!Number.isFinite(n)) return String(n);
  const scaled = f.style === 'percent' ? n * 100 : n;
  const tail = f.style === 'percent' ? ' %' : '';
  let body;
  if (needsIntl(f)) {
    /** @type {any} */
    const opts = { useGrouping: f.group === true };
    if (f.decimals != null) { opts.minimumFractionDigits = f.decimals; opts.maximumFractionDigits = f.decimals; }
    else if (f.maxDecimals != null) { opts.minimumFractionDigits = 0; opts.maximumFractionDigits = f.maxDecimals; }
    if (f.style === 'currency') { opts.style = 'currency'; opts.currency = f.currency; }
    try {
      body = new Intl.NumberFormat(localeOf(f, lang), opts).format(scaled);
    } catch {
      body = trimNumber(scaled);
    }
  } else if (f.decimals != null) {
    body = scaled.toFixed(f.decimals);
  } else if (f.maxDecimals != null) {
    const step = Math.pow(10, f.maxDecimals);
    body = trimNumber(Math.round(scaled * step) / step);
  } else {
    body = trimNumber(scaled);
  }
  return (f.prefix || '') + body + tail + (f.suffix || '');
}

/**
 * A value, split into the pieces a display puts where it wants them.
 *
 * `place` says what the SPEC asked for, so a caller with its own unit element knows whether to
 * keep it ('none', the default) or step aside because the text already carries it.
 * @param {any} value
 * @param {any} spec
 * @param {string} [defaultPlace]  where the unit goes when the spec does not say — a readout that
 *   has always shown the unit passes 'after' so a document without a format looks unchanged
 * @param {string} [lang]  the language, for `locale: "auto"`
 * @returns {{ number: string, unit: string, place: string, text: string, refused: boolean }}
 */
export function formatParts(value, spec, defaultPlace, lang) {
  const f = parseFormat(spec);
  const fallback = PLACES.indexOf(String(defaultPlace)) >= 0 ? String(defaultPlace) : 'none';
  if (isError(value)) {
    return { number: value.error, unit: '', place: 'none', text: value.error, refused: true };
  }
  if (f && f.word) {
    const cased = f.word === 'upper' ? asText(value).toUpperCase() : asText(value).toLowerCase();
    return { number: cased, unit: '', place: 'none', text: cased, refused: false };
  }
  if (isQuantity(value) || typeof value === 'number') {
    const n = isQuantity(value) ? value.n : value;
    const unit = isQuantity(value) ? unitLabel(value.u) : '';
    const number = formatNumber(n, spec, lang);
    const place = f && f.place ? f.place : fallback;
    const text = !unit || place === 'none' ? number
      : place === 'before' ? unit + ' ' + number : number + ' ' + unit;
    return { number: number, unit: unit, place: place, text: text, refused: false };
  }
  const words = asText(value);
  return { number: words, unit: '', place: 'none', text: words, refused: false };
}

/**
 * A value written out whole, which is what a sentence takes.
 * @param {any} value @param {any} spec @param {string} [lang]
 * @returns {string}
 */
export function formatValue(value, spec, lang) { return formatParts(value, spec, undefined, lang).text; }
