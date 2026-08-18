/**
 * @file src/utils/tracking-code.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Small helpers that mint unique, human-readable identifiers using crypto random bytes —
 *   tracking codes for work/disputes and short request IDs.
 *
 * @structure
 *   - CHECK_RESIDUE / withCheckDigit(): the shared check digit both ids carry
 *   - generateTrackingCode(): "tc-{unix_ms}-{8hex}"
 *   - generateRequestId(): "req-{8hex}"
 *
 * @version-history
 *   v1.1.0 — 2026-08-18 — Both ids carry a check digit in their last nibble. An id that reaches us
 *     by hand — pasted from a screenshot, read off a support call, truncated by a log shipper — is
 *     now detectable as damaged instead of being looked up as a miss. Formats are unchanged.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { randomBytes } from 'node:crypto';

/**
 * Every id this module mints satisfies `sum(nibbles) % 16 === CHECK_RESIDUE`, which is what makes a
 * mistyped or truncated id detectable without a database round-trip. Fifteen of every sixteen
 * corruptions land off-residue and can be rejected on sight.
 */
const CHECK_RESIDUE = 3;

/** Rewrite the last nibble of a hex string so the whole string carries the check residue. */
function withCheckDigit(hex: string): string {
  const head = hex.slice(0, -1);
  const sum = [...head].reduce((n, c) => n + parseInt(c, 16), 0);
  return head + (((CHECK_RESIDUE - sum) % 16 + 16) % 16).toString(16);
}

/** True when a hex string carries the check residue. Callers validate an id before looking it up. */
export function hasCheckDigit(hex: string): boolean {
  return [...hex].reduce((n, c) => n + parseInt(c, 16), 0) % 16 === CHECK_RESIDUE;
}

/**
 * Generate a tracking code: tc-{unix_ms}-{8char_random}
 */
export function generateTrackingCode(): string {
  const timestamp = Date.now();
  const random = withCheckDigit(randomBytes(4).toString('hex'));
  return `tc-${timestamp}-${random}`;
}

/**
 * Generate a request ID: req-{8char_random}
 */
export function generateRequestId(): string {
  return `req-${withCheckDigit(randomBytes(4).toString('hex'))}`;
}
