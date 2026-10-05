/**
 * @file input-formats.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The value formats AIMEAT adds to JSON Schema, on the node: a Finnish Business ID, a
 *   Finnish personal identity code, an IBAN, a Finnish postal code and a phone number, plus the
 *   annotation keywords the browser library reads (x-hint, x-messages) and the one rule it adds
 *   (x-same-as). Registered on the schema-lock validators (schema-validator.ts), so a workspace can
 *   lock a space with the same schema an app's form checks, and an agent's write is refused by the
 *   same rule that refuses a person's typing.
 *
 *   A COPY OF THE BROWSER'S, ON PURPOSE. The served library's formats live in
 *   src/static/sdk-libs/validate/formats.js, which the node cannot import (tsc emits no .js from
 *   there). test/unit/validate-formats.test.ts feeds both copies the same values; change both.
 * @structure IBAN_LENGTHS · INPUT_FORMATS · registerInputFormats(ajv)
 * @usage import { registerInputFormats } from './input-formats.js'; registerInputFormats(ajv);
 * @version-history
 *   v1.0.0 - 2026-10-05 - Initial (wish-sy-tteiden-validointi-sovelluksiin-yksi-json-schema-ui-lle-a).
 */

/** Why a value fails a format, or true when it passes. */
export type FormatVerdict = true | 'shape' | 'check' | 'date' | 'length';

/** IBAN length per country (ISO 13616 registry). A country not listed is checked by mod 97 alone. */
export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21,
  CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27,
  GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26,
  IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24,
  ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24,
  TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};

const HETU_CHECK = '0123456789ABCDEFHJKLMNPRSTUVWXY';
const HETU_CENTURY: Record<string, number> = {
  '+': 1800, '-': 1900, Y: 1900, X: 1900, W: 1900, V: 1900, U: 1900, A: 2000, B: 2000, C: 2000, D: 2000, E: 2000, F: 2000,
};

function realDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[m - 1];
}

function mod97(digits: string): number {
  let rest = 0;
  for (let i = 0; i < digits.length; i += 7) rest = Number(String(rest) + digits.slice(i, i + 7)) % 97;
  return rest;
}

/** The format tests by name; each answers true or the reason a value fails. */
export const INPUT_FORMATS: Record<string, (value: string) => FormatVerdict> = {
  'fi-business-id'(value) {
    const m = /^(\d{7})-(\d)$/.exec(String(value).trim());
    if (!m) return 'shape';
    const weights = [7, 9, 10, 5, 8, 4, 2];
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += Number(m[1][i]) * weights[i];
    const rest = sum % 11;
    if (rest === 1) return 'check';
    return (rest === 0 ? 0 : 11 - rest) === Number(m[2]) ? true : 'check';
  },
  'fi-personal-id'(value) {
    const m = /^(\d{2})(\d{2})(\d{2})([-+ABCDEFUVWXY])(\d{3})([0-9A-Y])$/.exec(String(value).trim().toUpperCase());
    if (!m) return 'shape';
    const year = HETU_CENTURY[m[4]] + Number(m[3]);
    if (!realDay(year, Number(m[2]), Number(m[1]))) return 'date';
    return HETU_CHECK[Number(m[1] + m[2] + m[3] + m[5]) % 31] === m[6] ? true : 'check';
  },
  iban(value) {
    const compact = String(value).replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return 'shape';
    const expected = IBAN_LENGTHS[compact.slice(0, 2)];
    if (expected && compact.length !== expected) return 'length';
    const moved = compact.slice(4) + compact.slice(0, 4);
    const digits = moved.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
    return mod97(digits) === 1 ? true : 'check';
  },
  'fi-postal-code'(value) {
    return /^\d{5}$/.test(String(value).trim()) ? true : 'shape';
  },
  phone(value) {
    const s = String(value).trim();
    if (!/^\+?[\d\s().-]+$/.test(s)) return 'shape';
    const digits = s.replace(/\D/g, '');
    return digits.length >= 6 && digits.length <= 15 ? true : 'shape';
  },
};

/** The part of an Ajv instance this file uses. */
interface AjvLike {
  addFormat: (name: string, format: { type: 'string'; validate: (value: string) => boolean }) => unknown;
  addKeyword: (def: Record<string, unknown>) => unknown;
}

/**
 * Teach an Ajv instance the AIMEAT formats and keywords. x-hint and x-messages are annotations
 * (the browser reads them; the node only accepts them in strict mode). x-same-as is checked:
 * a property carrying it must equal the sibling it names.
 */
export function registerInputFormats(ajv: AjvLike): void {
  for (const [name, test] of Object.entries(INPUT_FORMATS)) {
    ajv.addFormat(name, { type: 'string', validate: (value: string) => test(value) === true });
  }
  ajv.addKeyword({ keyword: 'x-hint' });
  ajv.addKeyword({ keyword: 'x-messages' });
  ajv.addKeyword({
    keyword: 'x-same-as',
    schemaType: 'string',
    errors: false,
    validate: (other: string, data: unknown, _parentSchema: unknown, cxt?: { parentData?: Record<string, unknown> }) => {
      const parent = cxt?.parentData;
      if (!parent || typeof parent !== 'object') return true;
      return parent[other] === data;
    },
  });
}
