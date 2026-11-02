/**
 * @file src/static/sdk-libs/auth/modal-constants.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sign-in dialog's two identifier rules. Moved out of modal.js unchanged when it
 *   passed 800 lines (max-file-lines), a pure extraction; its two marks live in modal-styles.js.
 *   Since 2026-11-02 also the two pieces of the password sign-in policy the dialog shows: the refusal
 *   text and the operators-only line (auth.password_sign_in).
 * @structure EMAIL_RE · OWNER_NAME_RE · passwordRefusalText(i, fallback) · operatorsOnlyNoteHtml(i, passkeyShown)
 * @usage import { EMAIL_RE, OWNER_NAME_RE } from './modal-constants.js';
 * @version-history
 *   v1.1.0 — 2026-11-02 — passwordRefusalText and operatorsOnlyNoteHtml (the operator's sign-in policy).
 *   v1.0.0 — 2026-10-31 — Moved out of modal.js unchanged (max-file-lines).
 */
import { PASSWORD_SIGN_IN } from './config.js';
import { escHtml } from './theme.js';

/** An identifier is an email when it carries a dot-bearing domain. A GHII (`alice@node-id`) never
 *  does, so this separates the two without asking the person which one they typed. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The server's owner-name rule (OWNER_RE in src/utils/gaii.ts): lowercase letters, digits and
 *  hyphens, a letter or digit at both ends, 3 to 64 characters. Mirrored here so the field can say
 *  what it wants while the person types instead of in a refusal afterwards. */
export const OWNER_NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/**
 * The refusal of a password under the node's password sign-in policy (PASSWORD_SIGN_IN_OFF), in the
 * dialog's language. Under `operators` it says the password is the operators' way in, which the line
 * above the form also says; under `off` that the server takes no password. `fallback` is the node's
 * own sentence, for a string the dictionary lacks.
 * @param {Record<string, string>} i @param {string} fallback
 */
export function passwordRefusalText(i, fallback) {
  if (PASSWORD_SIGN_IN === 'operators') return i.passwordOperatorsRefused || fallback;
  return i.passwordSignInOff || fallback;
}

/**
 * The line that says password sign-in is the operators' own, under `operators` only. A place of its
 * own: when the passkey button stands above, the dialog's divider separates the two ways in, and the
 * line has a field's spacing to the username below.
 * @param {Record<string, string>} i @param {boolean} passkeyShown
 */
export function operatorsOnlyNoteHtml(i, passkeyShown) {
  if (PASSWORD_SIGN_IN !== 'operators') return '';
  return (passkeyShown ? '<div class="aimeat-or"><span></span><b>' + escHtml(i.orLabel || 'OR') + '</b><span></span></div>' : '')
    + '<div class="aimeat-field"><p class="aimeat-sub-desc">' + escHtml(i.passwordOperatorsOnly || 'Password sign-in is only for the operators of this server.') + '</p></div>';
}
