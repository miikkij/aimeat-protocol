/**
 * @file public/js/app-sandbox.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Open a user-published app from anywhere in the SPA. Apps always open TOP-LEVEL
 *   in a new tab via the apex `?mode=inline` URL — a clean, full-screen page (no overlay/X).
 *   The server decides isolation (services/app-isolation.ts):
 *     - app origin ON → the apex 301s to `apps.<domain>`, an isolated origin with no ambient
 *       session (apps then use the explicit grant flow);
 *     - app origin OFF, several people on the node → the apex serves a small page that holds the
 *       app in an opaque-origin frame; the app gets its own grant through that page, never the
 *       session (audit A7-1);
 *     - app origin OFF, one person on the node → the app is served inline on the apex, so that
 *       person's session carries into their own app, as it always did.
 * @structure isAppHtmlUrl() route matcher · openAppSandboxed() top-level opener.
 * @usage import { openAppSandboxed, isAppHtmlUrl } from '/js/app-sandbox.js'
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial (H-2 app-origin isolation, Phase 0).
 *   v1.1.0 — 2026-06-20 — App origin live → open apps top-level; opaque-sandbox overlay fallback.
 *   v2.0.0 — 2026-06-20 — Always open apps TOP-LEVEL (the opaque sandbox gave apps origin `null`,
 *     breaking their storage/API and forcing a re-login). Isolation is now the server's job via
 *     the app origin; with it off, apps run on the apex and inherit the user's session.
 *   v2.0.1 — 2026-09-25 — The header names the third way: the isolated frame on a node several
 *     people share with no app origin, which gives the app its storage and its own sign-in through
 *     the page around the frame. The code is unchanged; the server decides.
 */

/** Matches the published-app HTML route: /v1/apps/<owner>/<file> (optionally ?mode=inline). */
export function isAppHtmlUrl(href) {
  if (!href) return false;
  let path;
  try {
    path = new URL(href, window.location.href).pathname;
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
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
