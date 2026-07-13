/**
 * @file views/portfolio/shared.js
 * @description Shared portfolio helpers — node URL, translation fallback, CSP
 *   nonce stamping for srcdoc iframes, and session accessor. Extracted from
 *   portfolio.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portfolio.js (max-file-lines)
 */
import { t } from '/js/i18n.js';

export const NODE_URL = typeof window !== 'undefined' ? window.location.origin : '';

// t() echoes the key when a translation is missing (e.g. a server still serving
// pre-update locales) — fall back to readable English instead of raw keys.
export const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/* ── CSP nonce stamping for srcdoc iframes ──
   about:srcdoc inherits the SPA document's CSP, whose script-src is
   'self' + a per-request nonce (no 'unsafe-inline') — so a portfolio's
   inline <script> is blocked unless it carries that nonce. Stamp the
   SPA's own nonce onto the portfolio's script tags before rendering
   (client-side mirror of src/utils/csp-nonce.ts). Isolation does not
   rest on CSP here: the sandbox (allow-scripts only → opaque origin,
   no session/cookies/storage) is the security boundary, matching the
   'unsafe-inline' CSP the app-launch endpoint grants published apps. */
export function stampCspNonce(htmlStr) {
  let nonce = '';
  for (const s of document.scripts) {
    if (s.nonce) { nonce = s.nonce; break; }
  }
  if (!nonce) return htmlStr;
  return htmlStr.replace(/<script(?=[\s>])/gi, `<script nonce="${nonce}"`);
}

/* ── Auth helpers ── */
export function getSession() {
  const a = window.AIMEAT?.auth;
  if (!a || typeof a.getSession !== 'function') return null;
  const s = a.getSession();
  if (!s || !s.jwt) return null;
  return s;
}
