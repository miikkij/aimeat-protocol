/**
 * @file auth/signup-state.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the first-time provider sign-up step (signup.js) is on screen or on its way.
 *   A page that opens the sign-in dialog as soon as it loads without a session (the app-open page,
 *   the sign-in-first page, an app) runs at the same moment as the boot that opens the username
 *   step after ?aimeat_signup=1. Both dialogs use the one #aimeat-modal element, so the sign-in
 *   dialog replaced the username step, and a person signing in with Microsoft for the first time
 *   saw the sign-in dialog again and went round in a circle (innokas.aimeat.io, 2026-10-19).
 *   modal.js asks this before it opens.
 * @structure markSignupInProgress(on) · signupInProgress()
 * @usage import { signupInProgress } from './signup-state.js';  if (signupInProgress()) return;
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial.
 */

var inProgress = false;

/** Set when the sign-up boot sees ?aimeat_signup=1, cleared when its dialog closes. */
export function markSignupInProgress(on) {
  inProgress = !!on;
}

/** True while the username step is loading or open. */
export function signupInProgress() {
  return inProgress;
}
