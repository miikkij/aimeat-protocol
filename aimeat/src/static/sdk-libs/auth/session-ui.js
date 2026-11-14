/**
 * @file src/static/sdk-libs/auth/session-ui.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two screens session.js opens: the sign-in dialog (modal.js showLoginModal) and the
 *   login pill (pill.js mountPill). Both of those modules import session.js, so session.js importing
 *   them back made two import cycles. auth.js registers both functions here when it loads, which is
 *   before index.js runs any boot code and before window.AIMEAT.auth exists, and session.js calls
 *   them through this module with the same arguments and return value as before.
 * @structure provideSessionUi({ showLoginModal, mountPill }) · showLoginModal(...) · mountPill(...)
 * @usage auth.js: provideSessionUi({ showLoginModal, mountPill });
 *   session.js: import { showLoginModal, mountPill } from './session-ui.js';
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial: ends the session.js ↔ modal.js and session.js ↔ pill.js import cycles.
 */

/** @type {{ showLoginModal: Function | null, mountPill: Function | null }} */
const ui = { showLoginModal: null, mountPill: null };

/**
 * Register the sign-in dialog and the login pill. auth.js calls this once, at load.
 * @param {{ showLoginModal: Function, mountPill: Function }} parts
 */
export function provideSessionUi(parts) {
  ui.showLoginModal = parts.showLoginModal;
  ui.mountPill = parts.mountPill;
}

/** @param {string} name */
function missing(name) {
  return new Error('[aimeat-auth] ' + name + ' was called before auth.js registered it in session-ui.js. Import auth from ./auth.js.');
}

/**
 * modal.js showLoginModal(opts, renderBtn, onClosed?), unchanged.
 * @param {any} opts
 * @param {Function} renderBtn
 * @param {Function} [onClosed]
 */
export function showLoginModal(opts, renderBtn, onClosed) {
  if (!ui.showLoginModal) throw missing('showLoginModal');
  return ui.showLoginModal(opts, renderBtn, onClosed);
}

/**
 * pill.js mountPill(auth, selector, opts), unchanged.
 * @param {any} auth
 * @param {any} selector
 * @param {any} opts
 */
export function mountPill(auth, selector, opts) {
  if (!ui.mountPill) throw missing('mountPill');
  return ui.mountPill(auth, selector, opts);
}
