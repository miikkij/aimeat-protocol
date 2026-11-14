/**
 * @file src/static/sdk-libs/auth/auth.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The complete auth module: session.js with its two screens registered. session.js
 *   opens the sign-in dialog (modal.js showLoginModal) and mounts the login pill (pill.js mountPill)
 *   through session-ui.js, because modal.js and pill.js import session.js. This module imports all
 *   three, registers the two functions at load, and re-exports everything session.js exports, so a
 *   caller that imports from here gets the same `auth` that session.js used to give on its own.
 * @structure provideSessionUi({ showLoginModal, mountPill }) at load · export * from './session.js'
 * @usage import { auth, refreshOnFocus, authApi } from './auth.js';  (index.js, and tests that open a screen)
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial: ends the session.js ↔ modal.js and session.js ↔ pill.js import cycles.
 */
import { showLoginModal } from './modal.js';
import { mountPill } from './pill.js';
import { provideSessionUi } from './session-ui.js';

provideSessionUi({ showLoginModal: showLoginModal, mountPill: mountPill });

export * from './session.js';
