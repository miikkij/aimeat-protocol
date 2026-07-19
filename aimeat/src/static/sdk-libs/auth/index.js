/**
 * @file auth/index.js
 * @description Entry for the aimeat-auth library (SDK-libs migration Phase 3). Assembles the auth
 *   surface from its modules (crypto/config/events/i18n/theme/session/pill/modal/signup), wires boot
 *   (first-time OIDC signup prompt on load; token refresh on tab focus/visibility), and exposes
 *   window.AIMEAT.auth + AIMEAT.version. esbuild bundles this + all imports into the classic IIFE
 *   served, unchanged, at /v1/libs/aimeat-auth.js. Replaces the ~2200-line JS-in-a-string monolith
 *   (auth-lib.ts + auth-lib-part1/2/3.ts).
 * @structure imports auth + refreshOnFocus (session) + maybeShowGoogleSignup (signup) + attach; boot
 *   listeners; attach('auth', auth) + version.
 * @usage <script src="/v1/libs/aimeat-auth.js"></script>  const s = await AIMEAT.auth.login();
 * @version-history
 *   v1.0.0 — 2026-07-19 — Componentized rewrite of src/routes/libs/auth-lib*.ts (SDK-libs migration Phase 3).
 */
import { auth, refreshOnFocus } from './session.js';
import { maybeShowGoogleSignup } from './signup.js';
import { attach } from '../_core/namespace.js';

// ── Boot: first-time OIDC signup prompt (after the callback bounced back with ?aimeat_signup=1) ──
if (typeof document !== 'undefined' && document.addEventListener) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeShowGoogleSignup);
  else maybeShowGoogleSignup();
}

// ── Boot: refresh on focus / visibility (timers don't fire while asleep/frozen) ──
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnFocus();
  });
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('focus', refreshOnFocus);
}

// ── Expose globally ──
const ns = attach('auth', auth);
ns.version = '2026-07-02-001';
