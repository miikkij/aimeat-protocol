/**
 * @file validate/formats.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The value formats AIMEAT adds to JSON Schema's own (email, uri, date and the rest
 *   come with the validator): a Finnish Business ID, a Finnish personal identity code, an IBAN, a
 *   Finnish postal code and a phone number. Each test checks the check digit or the date where the
 *   format has one, because a value that only looks right is the mistake a person actually makes.
 *
 *   TWO COPIES, ONE BEHAVIOUR. The node checks the same formats in its schema locks
 *   (src/services/input-formats.ts), so a rule the browser accepts is a rule the node accepts. The
 *   served bundle cannot import server code, so the node carries a copy, and
 *   test/unit/validate-formats.test.ts feeds both copies the same values. Change both, or the test
 *   fails.
 *
 *   A test answers `true`, or the reason the value fails: 'shape' (not the format at all), 'check'
 *   (the check digit or check character does not match), 'date' (no such day) or 'length' (an IBAN
 *   of the wrong length for its country). The reason picks the message the person reads.
 * @structure IBAN_LENGTHS · FORMAT_TESTS { fi-business-id, fi-personal-id, iban, fi-postal-code, phone } · formatPasses
 * @usage import { FORMAT_TESTS, formatPasses } from './formats.js';
 *   FORMAT_TESTS['fi-business-id']('0737546-2')   // true
 *   FORMAT_TESTS['fi-business-id']('0737546-3')   // 'check'
 * @version-history
 *   v1.0.0 - 2026-10-05 - Initial (wish-sy-tteiden-validointi-sovelluksiin-yksi-json-schema-ui-lle-a).
 */

/** IBAN length per country (ISO 13616 registry). A country not listed is checked by mod 97 alone. */
export const IBAN_LENGTHS = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21,
  CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27,
  GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26,
  IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24,
  ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24,
  TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};

/** The check characters of a Finnish personal identity code, indexed by the remainder mod 31. */
const HETU_CHECK = '0123456789ABCDEFHJKLMNPRSTUVWXY';

/** The century each separator of a personal identity code stands for (the 2023 additions included). */
const HETU_CENTURY = { '+': 1800, '-': 1900, Y: 1900, X: 1900, W: 1900, V: 1900, U: 1900, A: 2000, B: 2000, C: 2000, D: 2000, E: 2000, F: 2000 };

/**
 * Whether a calendar day exists.
 * @param {number} y @param {number} m 1 to 12 @param {number} d
 * @returns {boolean}
 */
function realDay(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[m - 1];
}

/**
 * The remainder of a long digit string mod 97, computed in pieces so no number exceeds 2^53.
 * @param {string} digits
 * @returns {number}
 */
function mod97(digits) {
  let rest = 0;
  for (let i = 0; i < digits.length; i += 7) rest = Number(String(rest) + digits.slice(i, i + 7)) % 97;
  return rest;
}

/**
 * One format test: true, or the reason the value fails.
 * @typedef {(value: string) => true | 'shape' | 'check' | 'date' | 'length'} FormatTest
 */

/** @type {Record<string, FormatTest>} */
export const FORMAT_TESTS = {
  /** Y-tunnus: seven digits, a hyphen and a check digit (weights 7 9 10 5 8 4 2, mod 11). */
  'fi-business-id': function (value) {
    const m = /^(\d{7})-(\d)$/.exec(String(value).trim());
    if (!m) return 'shape';
    const weights = [7, 9, 10, 5, 8, 4, 2];
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += Number(m[1][i]) * weights[i];
    const rest = sum % 11;
    if (rest === 1) return 'check';
    return (rest === 0 ? 0 : 11 - rest) === Number(m[2]) ? true : 'check';
  },

  /** Henkilötunnus: DDMMYY, a century separator, a three-digit individual number and a check character. */
  'fi-personal-id': function (value) {
    const m = /^(\d{2})(\d{2})(\d{2})([-+ABCDEFUVWXY])(\d{3})([0-9A-Y])$/.exec(String(value).trim().toUpperCase());
    if (!m) return 'shape';
    const year = HETU_CENTURY[/** @type {keyof typeof HETU_CENTURY} */ (m[4])] + Number(m[3]);
    if (!realDay(year, Number(m[2]), Number(m[1]))) return 'date';
    return HETU_CHECK[Number(m[1] + m[2] + m[3] + m[5]) % 31] === m[6] ? true : 'check';
  },

  /** IBAN: country, two check digits and the account, spaces allowed; length per country, then mod 97. */
  iban: function (value) {
    const compact = String(value).replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return 'shape';
    const expected = IBAN_LENGTHS[/** @type {keyof typeof IBAN_LENGTHS} */ (compact.slice(0, 2))];
    if (expected && compact.length !== expected) return 'length';
    const moved = compact.slice(4) + compact.slice(0, 4);
    const digits = moved.replace(/[A-Z]/g, function (c) { return String(c.charCodeAt(0) - 55); });
    return mod97(digits) === 1 ? true : 'check';
  },

  /** Postinumero: five digits. */
  'fi-postal-code': function (value) {
    return /^\d{5}$/.test(String(value).trim()) ? true : 'shape';
  },

  /** A phone number: an optional +, then 6 to 15 digits; spaces, hyphens, dots and brackets are allowed between them. */
  phone: function (value) {
    const s = String(value).trim();
    if (!/^\+?[\d\s().-]+$/.test(s)) return 'shape';
    const digits = s.replace(/\D/g, '');
    return digits.length >= 6 && digits.length <= 15 ? true : 'shape';
  },
};

/**
 * Whether a value passes a named AIMEAT format. A format this file does not define passes, the way
 * JSON Schema treats an unknown format.
 * @param {string} name
 * @param {unknown} value
 * @returns {boolean}
 */
export function formatPasses(name, value) {
  const test = FORMAT_TESTS[name];
  if (!test || typeof value !== 'string') return true;
  return test(value) === true;
}
