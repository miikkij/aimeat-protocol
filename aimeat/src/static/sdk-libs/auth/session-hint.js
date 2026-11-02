/**
 * @file src/static/sdk-libs/auth/session-hint.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the node's hint cookie is here: `aimeat_session_hint=1`, which the node sets and
 *   clears with the httpOnly refresh cookie (services/owner-session.ts SESSION_HINT_COOKIE). It holds no
 *   secret. A boot with no stored session asks /v1/auth/refresh only when it is here, so a visitor who
 *   never signed in logs no refused refresh (session.js restoreStoredSession).
 * @structure hasSessionHint
 * @usage import { hasSessionHint } from './session-hint.js';
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP10e B15).
 */

/** True when the hint cookie is set; true as well when the cookie cannot be read, so a restore is still tried. */
export function hasSessionHint() {
  try { return typeof document !== 'undefined' && /(?:^|;\s*)aimeat_session_hint=1(?:;|$)/.test(document.cookie || ''); }
  catch (e) { console.warn('[aimeat-auth] The cookie could not be read:', e && /** @type {Error} */ (e).message); return true; }
}
