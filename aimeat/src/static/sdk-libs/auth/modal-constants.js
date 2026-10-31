/**
 * @file src/static/sdk-libs/auth/modal-constants.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sign-in dialog's fixed values: the two identifier rules and the two inline marks.
 *   Moved out of modal.js unchanged when it passed 800 lines (max-file-lines), a pure extraction.
 * @structure EMAIL_RE · OWNER_NAME_RE · HEART_SVG · RULE_MARKS
 * @usage import { EMAIL_RE, OWNER_NAME_RE, HEART_SVG, RULE_MARKS } from './modal-constants.js';
 * @version-history
 *   v1.0.0 — 2026-10-31 — Moved out of modal.js unchanged (max-file-lines).
 */

/** An identifier is an email when it carries a dot-bearing domain. A GHII (`alice@node-id`) never
 *  does, so this separates the two without asking the person which one they typed. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The server's owner-name rule (OWNER_RE in src/utils/gaii.ts): lowercase letters, digits and
 *  hyphens, a letter or digit at both ends, 3 to 64 characters. Mirrored here so the field can say
 *  what it wants while the person types instead of in a refusal afterwards. */
export const OWNER_NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export const HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.8 8.2 3 4.5 6.7 4.5c2 0 3.6 1.1 4.5 2.6.9-1.5 2.5-2.6 4.5-2.6 3.7 0 5.9 3.7 4.3 7.3C19.5 16.4 12 21 12 21z"></path></svg>';
export const RULE_MARKS = '<svg class="r-ok" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3"></path></svg>'
  + '<svg class="r-no" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="2" width="8" height="8"></rect></svg>';
