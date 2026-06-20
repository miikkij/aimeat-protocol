/**
 * @file public/js/app-sandbox.js
 * @description Open a user-published app from anywhere in the SPA. Apps always open TOP-LEVEL
 *   in a new tab via the apex `?mode=inline` URL — a clean, full-screen page (no overlay/X).
 *   The server decides isolation:
 *     - app origin OFF → the app is served inline on the apex (same host as the SPA), so the
 *       user's session carries into the app (it can refresh + read its own data — "logged in");
 *     - app origin ON  → the apex 301s to `apps.<domain>`, an isolated origin with no ambient
 *       session (apps then use the explicit grant flow).
 *   So "logged into aimeat.io ⇒ apps are logged in" is the OFF (default) behaviour; ON is the
 *   opt-in hardened mode for multi-user/public nodes.
 * @structure isAppHtmlUrl() route matcher · openAppSandboxed() top-level opener.
 * @usage import { openAppSandboxed, isAppHtmlUrl } from '/js/app-sandbox.js'
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial (H-2 app-origin isolation, Phase 0).
 *   v1.1.0 — 2026-06-20 — App origin live → open apps top-level; opaque-sandbox overlay fallback.
 *   v2.0.0 — 2026-06-20 — Always open apps TOP-LEVEL (the opaque sandbox gave apps origin `null`,
 *     breaking their storage/API and forcing a re-login). Isolation is now the server's job via
 *     the app origin; with it off, apps run on the apex and inherit the user's session.
 */

/** Matches the published-app HTML route: /v1/apps/<owner>/<file> (optionally ?mode=inline). */
export function isAppHtmlUrl(href) {
  if (!href) return false;
  let path;
  try {
    path = new URL(href, window.location.href).pathname;
  } catch {
    return false;
  }
  // /v1/apps/<owner>/<file> — two path segments after /v1/apps/. The bare collection
  // (/v1/apps) and single-segment forms are API/JSON, not runnable HTML.
  return /^\/v1\/apps\/[^/]+\/[^/]+$/.test(path);
}

/**
 * Open a published app in a new top-level tab. `url` is the apex `?mode=inline` URL; the server
 * either serves it inline (session inherited) or 301s it to the isolated app origin.
 */
export function openAppSandboxed(url, _name) {
  window.open(url, '_blank', 'noopener');
}
