/**
 * @file one-time-code.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The six-digit code the node mails to prove a person reads an address: the password
 *   reset code, the email verification codes and the web-verification code. A reset code is the only
 *   factor of an unauthenticated password reset, so it comes from the operating system's
 *   cryptographic generator (crypto.randomInt). Math.random(), which these were built with, is one
 *   predictable stream per process that a caller can sample through the codes mailed to their own
 *   address (QA audit F02a-02).
 * @structure sixDigitCode()
 * @usage const code = sixDigitCode(); // '100000'..'999999', the same range as before
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F02a-02).
 */
import { randomInt } from 'node:crypto';

/** A code from 100000 to 999999 inclusive, as a string, from the cryptographic generator. */
export function sixDigitCode(): string {
  return String(randomInt(100000, 1000000));
}
