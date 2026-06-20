/**
 * @file public/js/app-sandbox.js
 * @description Open a user-published app's HTML inside a full-screen, sandboxed,
 *   opaque-origin iframe overlay — the H-2-safe way to "view" an app from anywhere in
 *   the SPA. The iframe's `sandbox` deliberately omits `allow-same-origin`, so even
 *   apex-hosted (`/v1/apps/...?mode=inline`) content runs with an opaque origin and can
 *   neither read aimeat.io localStorage nor send credentialed same-origin requests
 *   (e.g. POST /v1/auth/refresh). Replaces every top-level `window.open(...?mode=inline)`
 *   / `<a target="_blank">` app link that previously ran app HTML on the apex origin.
 * @structure isAppHtmlUrl() route matcher · openAppSandboxed() overlay builder.
 * @usage import { openAppSandboxed, isAppHtmlUrl } from '/js/app-sandbox.js'
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial (H-2 app-origin isolation, Phase 0).
 *   v1.1.0 — 2026-06-20 — When the app origin is live (window.__APP_ORIGIN_ENABLED), open apps
 *     top-level (apex inline URL 301s to apps.<domain>) — a clean full page on a real isolated
 *     origin (own storage/API work), no overlay/X. Opaque-sandbox overlay is the off-state fallback.
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

let escHandler = null;

/** Remove the overlay (if present) and detach the Escape handler. */
function closeOverlay() {
  const existing = document.getElementById('app-sandbox-overlay');
  if (existing) existing.remove();
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
}

/**
 * Open a published app for the user. When the node has provisioned the app origin
 * (`window.__APP_ORIGIN_ENABLED`), open it TOP-LEVEL in a new tab: the apex inline URL
 * 301s to `apps.<domain>`, giving a clean full page on a genuinely isolated origin (its own
 * storage, same-origin API) — no overlay, no toolbar. Otherwise fall back to the opaque-origin
 * sandbox overlay (the only safe option when apps would otherwise run same-origin as the SPA).
 */
export function openAppSandboxed(url, name) {
  if (window.__APP_ORIGIN_ENABLED) {
    window.open(url, '_blank', 'noopener');
    return;
  }

  closeOverlay();

  const overlay = document.createElement('div');
  overlay.id = 'app-sandbox-overlay';
  overlay.className = 'app-sandbox-overlay';

  const toolbar = document.createElement('div');
  toolbar.className = 'app-sandbox-toolbar';

  const title = document.createElement('span');
  title.className = 'app-sandbox-title';
  title.textContent = name || 'App';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'app-sandbox-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '✕';
  close.addEventListener('click', closeOverlay);

  toolbar.appendChild(title);
  toolbar.appendChild(close);

  const iframe = document.createElement('iframe');
  iframe.className = 'app-sandbox-frame';
  // No allow-same-origin → opaque origin. This is the entire H-2 protection.
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.src = url;

  overlay.appendChild(toolbar);
  overlay.appendChild(iframe);
  document.body.appendChild(overlay);

  escHandler = (e) => { if (e.key === 'Escape') closeOverlay(); };
  document.addEventListener('keydown', escHandler);
}
