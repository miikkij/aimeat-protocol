/**
 * @file auth/config.js
 * @description aimeat-auth config (SDK-libs migration Phase 3). NODE_URL / APEX_URL / NODE_ID come
 *   from the shared _core/config (the same `<meta> → location.origin → prelude` resolution the whole
 *   SDK uses). The app-scope defaults + declaration reader, and the OIDC provider list + button
 *   glyphs, live here. AUTH_PROVIDERS is server-computed (`listEnabledProviderMeta`) and injected by
 *   the auth route as an EXTRA prelude line — `window.__AIMEAT_AUTH_CFG__.providers` — since the
 *   generic config prelude only carries nodeId/baseUrl. Extracted from auth-lib-part1.ts.
 * @structure re-exports NODE_URL/APEX_URL/NODE_ID · APP_DEFAULT_SCOPES · appDeclaredScopes() ·
 *   AUTH_PROVIDERS · PROVIDER_ICONS.
 * @usage import { NODE_URL, APEX_URL, AUTH_PROVIDERS, appDeclaredScopes } from './config.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — Extracted from src/routes/libs/auth-lib-part1.ts (SDK-libs migration Phase 3).
 */
export { NODE_URL, APEX_URL, NODE_ID } from '../_core/config.js';

// Default scopes an app asks for in the H-2 silent SSO / grant flow when it does not declare its own.
// The common, foundational set: read/write the user's memory AND their stored files. (storage is a
// SEPARATE scope domain from memory — saving an image goes to /v1/storage, not /v1/memory.)
export const APP_DEFAULT_SCOPES = 'memory:read memory:write storage:read storage:write';

// An app declares the scopes it needs with <meta name="aimeat-scopes" content="scope scope …">.
// Only declared apps deviate from the default set — e.g. an AI app adds "ai:use" so its grant
// can spend the owner's AI budget. Falls back to APP_DEFAULT_SCOPES when undeclared, so existing
// apps are unaffected. The authorize endpoint still validates every scope against the node's
// grantable vocabulary, so a bogus meta value can only ever request LESS than the node allows.
export function appDeclaredScopes() {
  try {
    var m = document.querySelector('meta[name="aimeat-scopes"]');
    var c = m && m.getAttribute('content');
    if (c && c.trim()) return c.trim().replace(/\s+/g, ' ');
  } catch { /* no document / detached */ }
  return APP_DEFAULT_SCOPES;
}

// Social login providers enabled on this node (server-computed from node config, injected by the
// auth route as an extra prelude line): each is { id, label, i18nKey } — the sign-in modal renders
// one button per entry.
export const AUTH_PROVIDERS = (window.__AIMEAT_AUTH_CFG__ && window.__AIMEAT_AUTH_CFG__.providers) || [];

// Per-provider button glyphs (inline SVG — no external fetch).
export const PROVIDER_ICONS = {
  google: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>',
  entra: '<svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg>',
  casdoor: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" fill="#4757F6"/><circle cx="14" cy="11" r="1.6" fill="#fff"/><rect x="13.2" y="11.5" width="1.6" height="4" fill="#fff"/></svg>',
};
