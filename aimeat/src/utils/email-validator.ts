/**
 * @file src/utils/email-validator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one email-shape check the node uses. Five files carried their own copy of
 *   `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` (contacts, invitations, login-identifier, recovery, attach-email,
 *   outbound), and CodeQL flagged the regex as polynomial-ReDoS: a long value with many dots can
 *   drive the domain part into O(n²) backtracking. The fix is the same everywhere, so it lives once:
 *   reject anything past the RFC 5321 maximum of 254 characters BEFORE the regex runs, which bounds
 *   the backtracking to a trivial constant, and expose it as a named function so the rule cannot
 *   drift back into six copies (one capability, one implementation).
 * @structure isValidEmail(value) — trims, length-caps, then shape-checks. EMAIL_MAX_LENGTH.
 * @usage import { isValidEmail } from '../utils/email-validator.js';
 * @version-history
 *   v1.0.0 — 2026-08-23 — Consolidated from six inline copies (CodeQL js/polynomial-redos, AI-triage).
 */

/** RFC 5321: the maximum length of an email address (local + "@" + domain). */
export const EMAIL_MAX_LENGTH = 254;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A light structural check that a string looks like an email. NOT a deliverability guarantee — the
 * only authority on that is a verification round-trip. The length cap runs first so the regex can
 * never backtrack over an unbounded input.
 */
export function isValidEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > EMAIL_MAX_LENGTH) return false;
  return EMAIL_RE.test(trimmed);
}
