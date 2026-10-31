/**
 * @file src/static/sdk-libs/auth/modal-constants.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sign-in dialog's two identifier rules. Moved out of modal.js unchanged when it
 *   passed 800 lines (max-file-lines), a pure extraction; its two marks live in modal-styles.js.
 * @structure EMAIL_RE · OWNER_NAME_RE
 * @usage import { EMAIL_RE, OWNER_NAME_RE } from './modal-constants.js';
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
