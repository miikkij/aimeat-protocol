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
 *   v1.2.0 — 2026-07-26 — An embedded app inherits the embedder's look: aimeatRestoreMode() joins
 *     aimeatRestorePalette() at parse time, so ?mode= / ?palette= in the frame URL win over an
 *     origin's own storage without overwriting it.
 *   v1.1.0 — 2026-07-25 — Palette surface: AIMEAT.auth.getPalette/setPalette/getPalettes + the
 *     stored palette applied at parse time (theme system v2).
 *   v1.0.0 — 2026-07-19 — Componentized rewrite of src/routes/libs/auth-lib*.ts (SDK-libs migration Phase 3).
 */
import { auth, refreshOnFocus } from './session.js';
import { maybeShowGoogleSignup } from './signup.js';
import { attach } from '../_core/namespace.js';
import { readLocales, aimeatReadLang, aimeatApplyLang } from './locale.js';
import { PALETTES, aimeatReadPalette, aimeatApplyPalette, aimeatRestorePalette } from './palette.js';
import { aimeatRestoreMode } from './theme.js';

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
// Locale, resolved the ONE way this platform resolves it ('aimeat-lang': ?lang= -> localStorage
// -> cookie -> navigator). The pill renders the control; these let an app read and set the same
// value without re-implementing the lookup and drifting from it. They hang off `auth` (NOT the
// return of attach(), which is the whole window.AIMEAT namespace) so they land on AIMEAT.auth.
auth.getLang = function (locales) { return aimeatReadLang(readLocales({ locales: locales })); };
auth.setLang = function (lang) { aimeatApplyLang(String(lang).toLowerCase()); };
// Palette (the designed look, orthogonal to light/dark — 'aimeat-palette' + <html data-palette>).
// The pill renders the picker; these let an app read/set/enumerate the same value.
auth.getPalette = function () { return aimeatReadPalette(); };
auth.setPalette = function (id) { aimeatApplyPalette(String(id).toLowerCase()); };
auth.getPalettes = function () { return PALETTES.map(function (p) { return { id: p.id, label: p.label, swatch: p.swatch }; }); };

// Apply the stored palette at parse time (before any UI mounts), so a published app follows the
// user's chosen look with zero app code — the same free ride the mode snippet gives light/dark.
if (typeof document !== 'undefined') { aimeatRestorePalette(); aimeatRestoreMode(); }

const ns = attach('auth', auth);
ns.version = '2026-07-25-002';
