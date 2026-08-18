/**
 * @file password-generation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Generate a clean, human-transcribable password that is GUARANTEED to pass
 *   validatePasswordStrength (>= 8 chars, at least one uppercase, one lowercase, one digit,
 *   not a common weak password). Used when the system issues a login credential the user did
 *   not type themselves (e.g. the first-login credentials email for provisioned-code "key"
 *   accounts). The alphabet excludes hyphens and other separators (so the credential never
 *   carries misleading dashes) and drops visually ambiguous characters (0/O, 1/l/I) so the
 *   password survives being read from an email and typed into a login form.
 * @structure generateReadablePassword(length?) -> string.
 * @usage const pw = generateReadablePassword(); // e.g. "kR7fmXt9qBdP" — always validator-clean
 * @version-history
 *   v1.0.0 — 2026-07-07 — Initial (TARGET-011 VIP-session first-login credentials).
 */
import { randomInt } from 'node:crypto';

// Unambiguous character classes — no hyphens, no separators, no 0/O/1/l/I lookalikes.
const LOWER = 'abcdefghijkmnpqrstuvwxyz'; // no l
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O
const DIGIT = '23456789';                 // no 0, 1
const ALL = LOWER + UPPER + DIGIT;

/** Pick one random character from `set` using a cryptographically-unbiased index. */
function pick(set: string): string {
  return set[randomInt(set.length)];
}

/** Fisher-Yates shuffle (crypto-unbiased) so the guaranteed class chars are not positional. */
function shuffle(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

/**
 * Generate a password of `length` characters (default 14, minimum 8) that always contains at
 * least two lowercase letters, two uppercase letters and two digits — so it passes
 * validatePasswordStrength for every possible output, and no dashes appear in it.
 */
export function generateReadablePassword(length = 14): string {
  const len = Math.max(8, Math.floor(length));
  const guaranteed = [
    pick(LOWER), pick(LOWER),
    pick(UPPER), pick(UPPER),
    pick(DIGIT), pick(DIGIT),
  ];
  const rest: string[] = [];
  for (let i = guaranteed.length; i < len; i++) rest.push(pick(ALL));
  return shuffle([...guaranteed, ...rest]).join('');
}
