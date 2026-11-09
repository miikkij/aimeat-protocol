/**
 * @file src/static/sdk-libs/auth/modal-view-keep.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sign-in dialog's language switch keeps the view the person is on. The switch draws
 *   the whole dialog again in the new language, and every step's markup and wiring is new after it.
 *   Without this, the dialog came back on its first view: a code key's first sign-in lost the new
 *   password it shows once, and the code it replaced no longer works (secaudit2026nov08b round 15b).
 *
 *   Each step that holds something answers keep() with what it holds while it is on screen, and
 *   resume(state) draws it again with that, in the new words, without sending anything a second time.
 *   The two tabs and their typed values are kept by modal-fields.js, as before.
 * @structure viewOnScreen() · keepView(steps) · resumeView(steps, kept)
 * @usage
 *   var kept = keepView(steps);   // before the redraw
 *   render(false);
 *   resumeView(steps, kept);      // after it, with the steps of the new drawing
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08b round 15b).
 */

/** The dialog's views by the name showView() takes, and the element each one is. */
var VIEWS = {
  'forgot-pw': 'aimeat-forgot-pw-view',
  'forgot-user': 'aimeat-forgot-user-view',
  email: 'aimeat-email-view',
  totp: 'aimeat-totp-view',
  'two-step': 'aimeat-two-step-view',
  key: 'aimeat-key-view',
  'login-link': 'aimeat-login-link-view',
};

/**
 * The view on screen: one of VIEWS, or 'login' for the two tabs.
 * @returns {string}
 */
export function viewOnScreen() {
  for (var name in VIEWS) {
    var el = /** @type {any} */ (document.getElementById(VIEWS[name]));
    if (el && el.style && el.style.display !== 'none') return name;
  }
  return 'login';
}

/**
 * What the view on screen holds, before the dialog is drawn again.
 * @param {Record<string, { keep?: () => any }>} steps The steps by view name.
 * @returns {{ view: string, state: any }}
 */
export function keepView(steps) {
  var view = viewOnScreen();
  var step = steps[view];
  return { view: view, state: step && typeof step.keep === 'function' ? step.keep() : null };
}

/**
 * Open the kept view again in the new drawing, with what it held.
 * @param {Record<string, { resume?: (state: any) => void }>} steps The steps of the new drawing.
 * @param {{ view: string, state: any } | null} kept What keepView() returned.
 */
export function resumeView(steps, kept) {
  if (!kept || kept.view === 'login' || kept.state == null) return;
  var step = steps[kept.view];
  if (step && typeof step.resume === 'function') step.resume(kept.state);
}
