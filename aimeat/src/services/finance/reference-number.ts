/**
 * @file src/services/finance/reference-number.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Payment reference generation and validation: the Finnish national
 *   reference (viitenumero, 7-3-1 check digit) and the international RF creditor
 *   reference (ISO 11649, mod-97). Pure functions, no I/O.
 *
 *   The base digits are derived from the invoice's sequential number, so a reference
 *   always resolves back to exactly one invoice of one seller (findInvoiceByReference).
 *
 * @usage finnishReference('2026' + '14') → '2026143'; rfReference('202614') → 'RF...'
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */

/**
 * Finnish viitenumero check digit: weights 7,3,1 repeating from the RIGHTMOST base digit,
 * check = (10 − (sum mod 10)) mod 10, appended to the base. Base must be 3–19 digits.
 */
export function finnishReference(baseDigits: string): string {
  if (!/^[0-9]{3,19}$/.test(baseDigits)) {
    throw new Error(`viite base must be 3-19 digits, got "${baseDigits}"`);
  }
  const weights = [7, 3, 1];
  let sum = 0;
  const digits = baseDigits.split('').reverse();
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[i]) * weights[i % 3];
  }
  const check = (10 - (sum % 10)) % 10;
  return baseDigits + String(check);
}

/** Validates a Finnish viitenumero (base + check digit). */
export function isValidFinnishReference(ref: string): boolean {
  if (!/^[0-9]{4,20}$/.test(ref)) return false;
  return finnishReference(ref.slice(0, -1)) === ref;
}

/**
 * ISO 11649 RF creditor reference over the given alphanumeric reference: check digits
 * are 98 − ((reference + "RF00") as digits mod 97), zero-padded to 2.
 */
export function rfReference(reference: string): string {
  if (!/^[0-9A-Za-z]{1,21}$/.test(reference)) {
    throw new Error(`RF reference base must be 1-21 alphanumerics, got "${reference}"`);
  }
  const upper = reference.toUpperCase();
  const numeric = (upper + 'RF00').split('').map((ch) => {
    if (ch >= '0' && ch <= '9') return ch;
    return String(ch.charCodeAt(0) - 55);   // A=10 ... Z=35
  }).join('');
  const check = 98 - mod97(numeric);
  return `RF${String(check).padStart(2, '0')}${upper}`;
}

/** Validates an RF creditor reference (ISO 11649). */
export function isValidRfReference(ref: string): boolean {
  if (!/^RF[0-9]{2}[0-9A-Za-z]{1,21}$/.test(ref)) return false;
  const rearranged = (ref.slice(4) + ref.slice(0, 4)).toUpperCase();
  const numeric = rearranged.split('').map((ch) => {
    if (ch >= '0' && ch <= '9') return ch;
    return String(ch.charCodeAt(0) - 55);
  }).join('');
  return mod97(numeric) === 1;
}

/** Chunked mod-97 over an arbitrarily long digit string (avoids BigInt for a hot path). */
function mod97(digits: string): number {
  let remainder = 0;
  for (let i = 0; i < digits.length; i += 7) {
    remainder = Number(String(remainder) + digits.slice(i, i + 7)) % 97;
  }
  return remainder;
}
