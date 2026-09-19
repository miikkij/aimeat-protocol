/**
 * @file src/services/decide/scrub-detect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detectors behind the decide scrubber (TARGET-080, Module A). Pure functions and
 *   regular expressions, no state and no I/O: each pass takes a piece of text that holds no
 *   placeholder and a callback that turns an original value into its placeholder. The stateful half
 *   (which placeholder a value got, the report, restore) lives in scrub.ts.
 *
 *   CHECKSUMS DECIDE, NOT SHAPES. An IBAN counts only when mod-97 gives 1 and a henkilötunnus only
 *   when its date is real and its check character is right, so an order number or a reference that
 *   looks similar stays in the text. A Y-tunnus (business id) is public and is never touched.
 *
 *   BOUNDARIES ARE UNICODE. `\b` treats `ä` as a non-word character, so "Mäkelä" would split at the
 *   umlaut. Every pattern here uses a `(?<![\p{L}\p{N}])` style look-around instead.
 * @structure
 *   - PiiClass, PII_CLASSES     — the six classes, in detection order
 *   - PLACEHOLDER_SPLIT         — splits text into plain runs and existing placeholders
 *   - ibanValid, hetuValid      — checksum validators
 *   - scrubEmails … scrubAddresses — one pass per pattern class
 *   - buildNameMatchers, scrubNames — the person pass, built from the known names
 *   - scrubLiterals             — exact values learnt from field-name hints
 * @usage
 *   import { scrubEmails } from './scrub-detect.js';
 *   const out = scrubEmails('mail me at a@b.fi', (orig) => '[EMAIL_1]');
 * @version-history
 *   v1.0.0 — 2026-09-19 — TARGET-080 Module A, initial.
 */

/** A kind of personal data the scrubber replaces. */
export type PiiClass = 'email' | 'phone' | 'hetu' | 'iban' | 'address' | 'person';

/** Every class, in the order the passes run (earlier wins). */
export const PII_CLASSES: readonly PiiClass[] = Object.freeze(
  ['email', 'iban', 'hetu', 'phone', 'address', 'person'] as PiiClass[],
);

/** Turns an original value into the placeholder that replaces it. */
export type Replacer = (original: string) => string;

/** Capturing split: odd indexes of `s.split(PLACEHOLDER_SPLIT)` are placeholders. */
export const PLACEHOLDER_SPLIT = /(\[(?:EMAIL|PHONE|HETU|IBAN|ADDRESS|PERSON)_\d+\])/;

/** Global form, for restore. */
export const PLACEHOLDER_GLOBAL = /\[(?:EMAIL|PHONE|HETU|IBAN|ADDRESS|PERSON)_\d+\]/g;

const NOT_BEFORE = '(?<![\\p{L}\\p{N}_])';
const NOT_AFTER = '(?![\\p{L}\\p{N}_])';

/** Escape a string for use inside a RegExp. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

// ── email ─────────────────────────────────────────────────────────────────────────────────────────

const EMAIL_RE =
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[A-Za-z]{2,}(?![\p{L}\p{N}])/gu;

/** Replace every e-mail address. */
export function scrubEmails(s: string, rep: Replacer): string {
  return s.replace(EMAIL_RE, (m) => rep(m));
}

// ── iban ──────────────────────────────────────────────────────────────────────────────────────────

/** True when the compact IBAN (no spaces) passes the ISO 13616 mod-97 check. */
export function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const code = ch.charCodeAt(0);
    const digits = code >= 65 ? String(code - 55) : ch;
    for (const d of digits) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

const IBAN_RE = /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}/gu;

/**
 * Replace every valid IBAN. A greedy candidate may run into a following code ("… 85 EUR"), so the
 * longest prefix that ends at a group edge before that code and passes the checksum wins; the rest
 * stays as text.
 */
export function scrubIbans(s: string, rep: Replacer): string {
  return s.replace(IBAN_RE, (m, offset: number, whole: string) => {
    for (let end = m.length; end >= 15; end--) {
      const next = end < m.length ? m[end] : whole[offset + end];
      if (next !== undefined && /[\p{L}\p{N}]/u.test(next)) continue;
      // Shorten only past a letter group ("… 85 EUR"); cutting digits off an invalid IBAN would
      // find a valid-looking prefix about once in 97 tries.
      if (end < m.length && !/^ [A-Z]/.test(m.slice(end))) continue;
      const cand = m.slice(0, end).trimEnd();
      if (cand.length !== end) continue;
      if (ibanValid(cand)) return rep(cand) + m.slice(end);
    }
    return m;
  });
}

// ── hetu ──────────────────────────────────────────────────────────────────────────────────────────

const HETU_CHECK = '0123456789ABCDEFHJKLMNPRSTUVWXY';
const HETU_RE = /(?<![\p{L}\p{N}])(\d{2})(\d{2})(\d{2})([-+A-FUVWXY])(\d{3})([0-9A-Y])(?![\p{L}\p{N}])/gu;

/** True when `s` is a Finnish henkilötunnus with a real date and the right check character. */
export function hetuValid(s: string): boolean {
  const m = /^(\d{2})(\d{2})(\d{2})([-+A-FUVWXY])(\d{3})([0-9A-Y])$/.exec(s.toUpperCase());
  if (!m) return false;
  const [, dd, mm, yy, sep, nnn, check] = m;
  const century = sep === '+' ? 1800 : /[A-F]/.test(sep) ? 2000 : 1900;
  const year = century + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  return HETU_CHECK[Number(dd + mm + yy + nnn) % 31] === check;
}

/** Replace every valid henkilötunnus; an invalid one stays. */
export function scrubHetus(s: string, rep: Replacer): string {
  return s.replace(HETU_RE, (m) => (hetuValid(m) ? rep(m) : m));
}

// ── phone ─────────────────────────────────────────────────────────────────────────────────────────

/** Candidate: optional `+`, digit groups joined by one space or dash, a group may be parenthesised. */
const PHONE_RE = /(?<![\p{L}\p{N}+\-./,:])(?:\+ ?)?\(?\d+\)?(?:[ -]\(?\d+\)?)*/gu;

/** Shapes that look like a number run but are not phones. */
const NOT_PHONE: readonly RegExp[] = [
  /^\d{7}-\d$/,                       // Y-tunnus
  /^\d{4}-\d{4}$/,                    // year range
  /^\d{4}-\d{1,2}-\d{1,2}$/,          // ISO date
  /^\d{1,2}-\d{1,2}-\d{2,4}$/,        // dd-mm-yyyy
];

function phoneOk(c: string): boolean {
  if (NOT_PHONE.some((re) => re.test(c))) return false;
  const digits = c.replace(/\D/g, '').length;
  if (c.startsWith('+')) return digits >= 7 && digits <= 15;
  if (c.replace(/^\(/, '').startsWith('0')) return digits >= 7 && digits <= 13;
  return false;
}

/**
 * Replace international (`+…`) and Finnish national (`0…`) phone numbers. A candidate that runs
 * into a following number group is shortened a group at a time until it fits the digit limits.
 */
export function scrubPhones(s: string, rep: Replacer): string {
  return s.replace(PHONE_RE, (m) => {
    if (NOT_PHONE.some((re) => re.test(m))) return m;
    let cand = m;
    for (;;) {
      if (phoneOk(cand)) return rep(cand) + m.slice(cand.length);
      const cut = Math.max(cand.lastIndexOf(' '), cand.lastIndexOf('-'));
      if (cut <= 0) return m;
      cand = cand.slice(0, cut);
    }
  });
}

// ── address ───────────────────────────────────────────────────────────────────────────────────────

const FI_SUFFIX =
  '(?:katu|tie|kuja|polku|väylä|ranta|puisto|raitti|kaari|rinne|mäki|tori|aukio|piha|tanhua|kaarre|portti)';
const POSTCODE_TAIL = '(?:,?\\s+\\d{5}\\s+\\p{Lu}\\p{Ll}+)?';
const FI_STREET_RE = new RegExp(
  `${NOT_BEFORE}\\p{Lu}[\\p{L}-]*${FI_SUFFIX}\\s+\\d{1,4}(?:\\s?-\\s?\\d{1,4})?(?:\\s?[a-zåäö](?![\\p{L}]))?` +
    `(?:\\s+(?:as\\.?\\s?\\d{1,4}|[A-ZÅÄÖ](?![\\p{L}])(?:\\s?\\d{1,3}(?!\\d))?))?${POSTCODE_TAIL}`,
  'gu',
);
const EN_STREET_RE = new RegExp(
  `${NOT_BEFORE}\\d{1,5}[A-Za-z]?\\s+(?:\\p{Lu}[\\p{L}'-]*\\s+){1,3}` +
    `(?:Street|St\\.|Road|Rd\\.|Avenue|Ave\\.|Lane|Drive|Way|Boulevard)(?![\\p{L}])`,
  'gu',
);
const POSTCODE_RE = new RegExp(`${NOT_BEFORE}\\d{5}[ \\t]+\\p{Lu}\\p{Ll}+${NOT_AFTER}`, 'gu');

/** Replace Finnish and English street addresses, then a standalone `00100 Helsinki`. */
export function scrubAddresses(s: string, rep: Replacer): string {
  return s
    .replace(FI_STREET_RE, (m) => rep(m))
    .replace(EN_STREET_RE, (m) => rep(m))
    .replace(POSTCODE_RE, (m) => rep(m));
}

// ── person ────────────────────────────────────────────────────────────────────────────────────────

/** Finnish case endings (and an English possessive) a name may carry; longest first. */
const NAME_SUFFIX =
  "(?:[:']?(?:lla|llä|lle|lta|ltä|ssa|ssä|sta|stä|han|hen|hin|ksi|kin|ta|tä|na|nä|in|ni|si|s|n|a|ä))?";

/** Regexes for one set of known names: full names (any case) and single tokens (Capitalised). */
export interface NameMatchers { full: RegExp | null; token: RegExp | null }

/** Build the person matchers. Names and tokens are tried longest first. */
export function buildNameMatchers(names: Iterable<string>): NameMatchers {
  const full = new Set<string>();
  const tokens = new Set<string>();
  for (const raw of names) {
    const n = raw.trim().replace(/\s+/g, ' ');
    if (n.length < 2) continue;
    full.add(n.toLowerCase());
    for (const t of n.split(/[\s-]+/)) if (t.length >= 3) tokens.add(t.toLowerCase());
  }
  const alt = (set: Set<string>): string =>
    [...set].sort((a, b) => b.length - a.length).map((x) => escapeRe(x).replace(/ /g, '\\s+')).join('|');
  return {
    full: full.size ? new RegExp(`${NOT_BEFORE}(?:${alt(full)})${NAME_SUFFIX}${NOT_AFTER}`, 'giu') : null,
    token: tokens.size ? new RegExp(`${NOT_BEFORE}(?:${alt(tokens)})${NAME_SUFFIX}${NOT_AFTER}`, 'giu') : null,
  };
}

/** Replace full names in any case, then single name tokens only where written Capitalised. */
export function scrubNames(s: string, rep: Replacer, m: NameMatchers, pass: 'full' | 'token'): string {
  if (pass === 'full') return m.full ? s.replace(m.full, (x) => rep(x)) : s;
  return m.token ? s.replace(m.token, (x) => (/^\p{Lu}/u.test(x) ? rep(x) : x)) : s;
}

// ── literals from field-name hints ────────────────────────────────────────────────────────────────

/** Replace exact occurrences of values already known to be personal data (case-insensitive). */
export function scrubLiterals(s: string, rep: Replacer, literals: Iterable<string>): string {
  const list = [...literals].filter((x) => x.length >= 3).sort((a, b) => b.length - a.length);
  if (!list.length) return s;
  const re = new RegExp(`${NOT_BEFORE}(?:${list.map(escapeRe).join('|')})${NOT_AFTER}`, 'giu');
  return s.replace(re, (x) => rep(x));
}
