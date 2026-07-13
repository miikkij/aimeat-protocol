/**
 * @file src/routes/libs/auth-lib-part1.ts
 * @description aimeat-auth.js browser library source, head segment (config, Ed25519 crypto, IndexedDB key store, session object). Extracted from libs.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from libs.ts (max-file-lines)
 */
import type { AimeatConfig } from '../../config.js';
import { listEnabledProviderMeta } from '../../services/oidc-providers.js';

export function aimeatAuthLibPart1(config: AimeatConfig): string {
  return `// aimeat-auth.js — AIMEAT Auth Library
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Include: <script src="${config.baseUrl}/v1/libs/aimeat-auth.js"><\\/script>
// Usage: const session = await AIMEAT.auth.register('alice', 'Alice M.');
//        const session = await AIMEAT.auth.login();
(function(global) {
'use strict';

// ── Configuration ──
// Priority: <meta name="aimeat-node"> → location.origin (if http/https) → baked-in node URL
const NODE_URL = (function() {
  const meta = document.querySelector('meta[name="aimeat-node"]');
  if (meta) return meta.getAttribute('content').replace(/\\/$/, '');
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return '${config.baseUrl}';
})();

// The node's canonical APEX origin, baked in server-side. Unlike NODE_URL (which is location.origin
// on http/https, i.e. the APP origin when running inside a published app), this is always the apex —
// the only place the host-only session cookie lives. Used for the H-2 same-site silent SSO bridge.
const APEX_URL = '${config.baseUrl}';

// Default scopes an app asks for in the H-2 silent SSO / grant flow when it does not declare its own.
// The common, foundational set: read/write the user's memory AND their stored files. (storage is a
// SEPARATE scope domain from memory — saving an image goes to /v1/storage, not /v1/memory.)
const APP_DEFAULT_SCOPES = 'memory:read memory:write storage:read storage:write';

// An app declares the scopes it needs with <meta name="aimeat-scopes" content="scope scope …">.
// Only declared apps deviate from the default set — e.g. an AI app adds "ai:use" so its grant
// can spend the owner's AI budget. Falls back to APP_DEFAULT_SCOPES when undeclared, so existing
// apps are unaffected. The authorize endpoint still validates every scope against the node's
// grantable vocabulary, so a bogus meta value can only ever request LESS than the node allows.
function appDeclaredScopes() {
  try {
    var m = document.querySelector('meta[name="aimeat-scopes"]');
    var c = m && m.getAttribute('content');
    if (c && c.trim()) return c.trim().replace(/\\s+/g, ' ');
  } catch (e) { /* no document / detached */ }
  return APP_DEFAULT_SCOPES;
}

const NODE_ID = '${config.nodeId}';

// Social login providers enabled on this node (baked in server-side from node config): each is
// { id, label, i18nKey } — the sign-in modal renders one button per entry.
const AUTH_PROVIDERS = ${JSON.stringify(listEnabledProviderMeta(config))};
// Per-provider button glyphs (inline SVG — no external fetch).
const PROVIDER_ICONS = {
  google: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>',
  entra: '<svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg>',
  casdoor: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" fill="#4757F6"/><circle cx="14" cy="11" r="1.6" fill="#fff"/><rect x="13.2" y="11.5" width="1.6" height="4" fill="#fff"/></svg>',
};

// ── Ed25519 via Web Crypto ──

async function generateKeyPair() {
  const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const privRaw = await crypto.subtle.exportKey('pkcs8', key.privateKey);
  const pubRaw = await crypto.subtle.exportKey('spki', key.publicKey);
  // Extract raw 32-byte keys from DER wrappers
  const privBytes = new Uint8Array(privRaw).slice(-32);
  const pubBytes = new Uint8Array(pubRaw).slice(-32);
  return {
    privateKey: btoa(String.fromCharCode(...privBytes)),
    publicKey: btoa(String.fromCharCode(...pubBytes)),
    cryptoKey: key
  };
}

// SECURITY: Import raw Ed25519 private key as non-extractable CryptoKey
async function importEd25519Key(privateKeyBase64) {
  const privBytes = Uint8Array.from(atob(privateKeyBase64), c => c.charCodeAt(0));
  // Build PKCS8 DER wrapper for Ed25519
  const pkcs8Prefix = new Uint8Array([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]);
  const pkcs8 = new Uint8Array(pkcs8Prefix.length + privBytes.length);
  pkcs8.set(pkcs8Prefix);
  pkcs8.set(privBytes, pkcs8Prefix.length);
  const cryptoKey = await crypto.subtle.importKey('pkcs8', pkcs8, 'Ed25519', false /* non-extractable */, ['sign']);
  // Zero raw key bytes
  privBytes.fill(0);
  pkcs8.fill(0);
  return cryptoKey;
}

function isCryptoKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof CryptoKey !== 'undefined' && value instanceof CryptoKey) return true;
  return Object.prototype.toString.call(value) === '[object CryptoKey]';
}

// Sign using CryptoKey (preferred) or base64 key string (fallback)
async function sign(keyOrB64, message) {
  let key = keyOrB64;
  if (typeof keyOrB64 === 'string') {
    // Legacy path: raw base64 key → import as CryptoKey
    key = await importEd25519Key(keyOrB64);
  }
  if (!isCryptoKey(key)) {
    throw new Error('AIMEAT signing key is missing or invalid. Please sign in again.');
  }
  const msgBytes = new TextEncoder().encode(message);
  const sigBytes = await crypto.subtle.sign('Ed25519', key, msgBytes);
  return btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
}

// ── IndexedDB Key Store (SECURITY: non-extractable CryptoKeys) ──

const KEY_DB_NAME = 'aimeat_keys';
const KEY_STORE_NAME = 'cryptokeys';

function openKeyDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(KEY_STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeKey(name, cryptoKey) {
  const db = await openKeyDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
    tx.objectStore(KEY_STORE_NAME).put(cryptoKey, name);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function loadKey(name) {
  const db = await openKeyDB();
  return new Promise((resolve) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readonly');
    const req = tx.objectStore(KEY_STORE_NAME).get(name);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); resolve(null); };
  });
}

async function deleteKey(name) {
  try {
    const db = await openKeyDB();
    return new Promise((resolve) => {
      const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
      tx.objectStore(KEY_STORE_NAME).delete(name);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch(e) { /* IndexedDB may not be available */ }
}

// Migrate legacy localStorage keys to IndexedDB (one-time)
async function migrateKeysToIndexedDB() {
  try {
    const session = load('session');
    if (session && session.privateKey) {
      const cryptoKey = await importEd25519Key(session.privateKey);
      await storeKey('agent_key', cryptoKey);
      // Remove private key from localStorage, keep metadata
      delete session.privateKey;
      save('session', session);
    }
    const ownerKey = load('owner_key');
    if (typeof ownerKey === 'string' && ownerKey.length > 0) {
      const cryptoKey = await importEd25519Key(ownerKey);
      await storeKey('owner_key', cryptoKey);
      remove('owner_key');
    }
  } catch(e) {
    console.warn('AIMEAT: Key migration to IndexedDB failed, falling back to localStorage', e);
  }
}

// ── Storage helpers (metadata only — NO private keys) ──

const STORAGE_PREFIX = 'aimeat_';

function save(key, value) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch(e) {}
}

function load(key) {
  try { const v = localStorage.getItem(STORAGE_PREFIX + key); return v ? JSON.parse(v) : null; } catch(e) { return null; }
}

function remove(key) {
  try { localStorage.removeItem(STORAGE_PREFIX + key); } catch(e) {}
}

// ── JWT helpers ──

function parseJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload;
  } catch(e) { return null; }
}

function isExpired(jwt) {
  const payload = parseJwt(jwt);
  if (!payload || !payload.exp) return true;
  return Date.now() / 1000 > payload.exp - 60; // 60s grace
}

// ── API helpers ──

async function api(path, opts = {}) {
  const url = NODE_URL + path;
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const resp = await fetch(url, { ...opts, headers });
  const data = await resp.json();
  if (!data.ok) {
    // Preserve the machine-readable code + details on the thrown Error so callers can branch
    // (e.g. EMAIL_NOT_VERIFIED → open the email-completion flow) instead of matching on text.
    const err = new Error(data.error?.message || 'API error');
    err.code = data.error?.code;
    err.details = data.error?.details;
    throw err;
  }
  return data;
}

async function authApi(path, jwt, opts = {}) {
  return api(path, { ...opts, headers: { ...opts.headers, 'Authorization': 'Bearer ' + jwt }});
}

// ── Session object ──

let currentSession = null;
let refreshTimer = null;
let ownerRefreshInFlight = null; // shared promise so concurrent owner refreshes don't each rotate

// Persist non-secret session metadata (+ short-lived access token) to localStorage.
// The long-lived refresh token is an httpOnly cookie and is never readable here.
function persistSession(session) {
  save('session', {
    owner: session.owner, gaii: session.gaii, ghii: session.ghii,
    jwt: session.jwt, publicKey: session.publicKey, roles: session.roles,
    displayName: session.displayName || '',
    federated: session.federated || false,
    homeNode: session.homeNode || '',
    homeUrl: session.homeUrl || '',
    // H-2 app-origin grant session metadata (drives the consent gear on the login pill).
    _appOrigin: session._appOrigin || false,
    _app: session._app || null,
    _own: session._own || false,
  });
}

// Restore a session purely from the httpOnly refresh cookie, with NO local metadata. Makes
// the app boot "logged in" when a cookie exists but localStorage is empty — e.g. a browser
// an agent authenticated with an owner Personal Access Token (the server set the cookie to
// the token). Returns null when there is no usable cookie.
async function restoreSessionFromCookie() {
  try {
    const data = await api('/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-AIMEAT-Refresh': '1' },
    });
    const token = data && data.data && data.data.token;
    if (!token) return null;
    const payload = parseJwt(token) || {};
    const ownerName = payload.owner || payload.sub;
    if (!ownerName) return null;
    const session = createSession({
      owner: ownerName,
      ghii: String(ownerName).indexOf('@') >= 0 ? ownerName : (ownerName + '@' + NODE_ID),
      gaii: null,
      jwt: token,
      roles: payload.roles || [],
      displayName: '',
    });
    persistSession(session);
    currentSession = session;
    scheduleAutoRefresh(session);
    emit('login', session);
    return session;
  } catch (_) {
    return null;
  }
}

// ── App-origin seamless SSO (H-2) ──────────────────────────────────────────────────────────
// When this SDK runs on an APP ORIGIN (a *.apps.<domain> host, different from the node/apex), the
// host-only session cookie can't be read directly (cross-origin + CORS *). Instead we use the
// same-site silent bridge: a hidden iframe to the apex, where the cookie IS first-party, mints a
// SCOPED, revocable grant token and posts it back — so the owner's own app is logged in with no
// separate login, and never receives the ambient session.
function isAppOrigin() {
  try { return location.origin !== new URL(APEX_URL).origin; } catch (e) { return false; }
}

function silentAppToken() {
  return new Promise(function (resolve) {
    var apexOrigin;
    try { apexOrigin = new URL(APEX_URL).origin; } catch (e) { resolve(null); return; }
    if (location.origin === apexOrigin) { resolve(null); return; }
    var settled = false, iframe = null, timer = null;
    function finish(v) {
      if (settled) return; settled = true;
      window.removeEventListener('message', onMsg);
      if (timer) clearTimeout(timer);
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      resolve(v);
    }
    function onMsg(e) {
      if (e.origin !== apexOrigin) return;
      var d = e.data || {};
      if (d.type !== 'aimeat_app_login') return;
      // Return the FULL result (token on success, or { error:'consent_required', app, scope } so the
      // caller can launch the visible consent popup). null only when the bridge produced nothing.
      finish(d.result || null);
    }
    window.addEventListener('message', onMsg);
    iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = apexOrigin + '/app-silent.html?scope=' + encodeURIComponent(appDeclaredScopes());
    (document.body || document.documentElement).appendChild(iframe);
    timer = setTimeout(function () { finish(null); }, 8000);
  });
}

// End the shared apex session from an APP ORIGIN. The app cannot revoke the apex cookie itself (a
// credentialed cross-origin call to the apex is CORS-blocked), so it frames the same-site apex bridge
// in ?mode=logout, which revokes the host-only cookie first-party. Resolves true on success, false on
// timeout/error. On the apex itself this is a no-op (logout() revokes directly there).
function apexLogout() {
  return new Promise(function (resolve) {
    var apexOrigin;
    try { apexOrigin = new URL(APEX_URL).origin; } catch (e) { resolve(false); return; }
    if (location.origin === apexOrigin) { resolve(false); return; }
    var settled = false, iframe = null, timer = null;
    function finish(v) {
      if (settled) return; settled = true;
      window.removeEventListener('message', onMsg);
      if (timer) clearTimeout(timer);
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      resolve(v);
    }
    function onMsg(e) {
      if (e.origin !== apexOrigin) return;
      var d = e.data || {};
      if (d.type !== 'aimeat_app_logout') return;
      finish(!!(d.result && d.result.ok));
    }
    window.addEventListener('message', onMsg);
    iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = apexOrigin + '/app-silent.html?mode=logout';
    (document.body || document.documentElement).appendChild(iframe);
    timer = setTimeout(function () { finish(false); }, 8000);
  });
}

// ── App-grant consent popup (H-2): for an app the user does NOT own and has not yet granted, the
// silent bridge returns consent_required. The user approves ONCE in a visible popup (the PKCE code
// flow); thereafter the silent bridge auto-issues a token (remembered grant). Popups need a user
// gesture, so this only runs from auth.login() (a click), never the on-mount auto-trigger.
function _b64url(buf) {
  var bytes = new Uint8Array(buf), s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}
async function _pkce() {
  var verifier = _b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  if (crypto.subtle && crypto.subtle.digest) {
    var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier: verifier, challenge: _b64url(digest), method: 'S256' };
  }
  // Non-secure context (http on a non-localhost host): crypto.subtle is unavailable. Fall back to
  // PKCE "plain". Acceptable — such transport is already non-confidential; real app origins are https
  // (which is a secure context → S256). Prod always uses S256.
  return { verifier: verifier, challenge: verifier, method: 'plain' };
}
async function requestConsentPopup(app, scopeStr, manage) {
  var apexOrigin;
  try { apexOrigin = new URL(APEX_URL).origin; } catch (e) { return null; }
  var p = await _pkce();
  var state = _b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
  var redirectUri = location.origin + '/'; // app origin; never navigated in web_message mode (origin binding only)
  var scope = scopeStr || appDeclaredScopes();
  // manage=1 → the consent page always shows the management screen (the gear). Without it, an app the
  // user already granted just passes straight through (auto-approve) instead of prompting again.
  var url = apexOrigin + '/v1/app-grants/authorize?response_type=code&response_mode=web_message'
    + (manage ? '&manage=1' : '')
    + '&app=' + encodeURIComponent(app)
    + '&scope=' + encodeURIComponent(scope)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&code_challenge=' + encodeURIComponent(p.challenge)
    + '&code_challenge_method=' + encodeURIComponent(p.method)
    + '&state=' + encodeURIComponent(state);
  var w = 460, h = 660;
  var left = (window.screen && window.screen.width ? (window.screen.width - w) / 2 : 0);
  var top = (window.screen && window.screen.height ? (window.screen.height - h) / 2 : 0);
  var popup = window.open(url, 'aimeat_consent', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
  if (!popup) {
    // Popup blocked. This happens when the click carries no user activation — synthetic
    // .click() calls, automated/embedded browsers — or with aggressive blockers. Fail LOUDLY
    // so the app can react (the silent null here made sign-in look like a dead button).
    try { console.warn('[aimeat-auth] consent popup blocked — app-origin sign-in needs a real user click (user activation). Synthetic/automated clicks cannot open the consent window.'); } catch (e) { /* no console */ }
    emit('popup-blocked', { app: app });
    return null;
  }
  var msg = await new Promise(function (resolve) {
    var done = false, iv = null;
    function onMsg(e) {
      if (e.origin !== apexOrigin) return;
      var d = e.data || {};
      if (d.type !== 'aimeat_app_grant' || d.state !== state) return;
      done = true; cleanup(); resolve(d);
    }
    function cleanup() { window.removeEventListener('message', onMsg); if (iv) clearInterval(iv); }
    window.addEventListener('message', onMsg);
    iv = setInterval(function () { if (popup.closed && !done) { cleanup(); resolve(null); } }, 500);
  });
  if (msg && msg.revoked) return { revoked: true };       // user revoked from the consent screen
  if (!msg || !msg.code) return null;                     // denied / closed
  try {
    var resp = await fetch(apexOrigin + '/v1/app-grants/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: msg.code, code_verifier: p.verifier, redirect_uri: redirectUri }),
    });
    var j = await resp.json();
    return (j && j.ok && j.data && j.data.access_token) ? j.data : null;
  } catch (e) { return null; }
}

// Build + install an app-origin session from a freshly issued grant access token (shared by the
// silent/consent login and the in-app "manage grant" re-issue). appId = owner/filename, own = the
// user's own app (no consent gear needed).
function _buildAppSession(accessToken, appId, own, displayName) {
  var payload = parseJwt(accessToken) || {};
  var ownerName = payload.owner || payload.sub;
  if (!ownerName) return null;
  var session = createSession({
    owner: ownerName,
    ghii: String(ownerName).indexOf('@') >= 0 ? ownerName : (ownerName + '@' + NODE_ID),
    gaii: null, jwt: accessToken, roles: payload.roles || [], displayName: displayName || '',
  });
  session._appOrigin = true;
  session._app = appId || null;
  session._own = !!own;
  persistSession(session);
  currentSession = session;
  scheduleAutoRefresh(session);
  emit('login', session);
  return session;
}

// Shared in-flight promise so concurrent callers (an app that runs BOTH mountLoginButton's auto
// trigger AND its own auth.login()) reuse a single silent bridge instead of opening two iframes.
let _appOriginLoginInFlight = null;
function restoreSessionFromAppOrigin(interactive) {
  if (currentSession) return Promise.resolve(currentSession);
  if (_appOriginLoginInFlight) return _appOriginLoginInFlight;
  _appOriginLoginInFlight = (async function () {
    var r = await silentAppToken();
    var grant = (r && r.ok && r.access_token) ? r : null;
    var appId = (r && r.app) || null;
    var own = !!(r && r.own);
    // consent_required → not yet granted; login_required → not logged into the apex at all. BOTH are
    // resolved by the visible popup (the consent page prompts apex login first, then consent), but
    // ONLY on a user gesture (interactive) — the on-mount auto-trigger never opens a blocked popup.
    if (!grant && interactive && r && (r.error === 'consent_required' || r.error === 'login_required') && r.app) {
      appId = r.app;
      grant = await requestConsentPopup(r.app, r.scope);
      own = false; // the consent flow only runs for apps the user does NOT own
    }
    if (!grant || !grant.access_token) return null;
    return _buildAppSession(grant.access_token, appId, own, grant.display_name);
  })();
  _appOriginLoginInFlight.finally(function () { _appOriginLoginInFlight = null; });
  return _appOriginLoginInFlight;
}

function scheduleAutoRefresh(session) {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!session?.jwt) return;
  try {
    const payload = JSON.parse(atob(session.jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return;
    // Refresh 5 minutes before expiry (or immediately if less than 5 min left)
    const msUntilExpiry = (payload.exp * 1000) - Date.now();
    const refreshIn = Math.max(msUntilExpiry - 5 * 60 * 1000, 10_000); // min 10s
    refreshTimer = setTimeout(async () => {
      try {
        await session.refresh();
        emit('refreshed', session);
        scheduleAutoRefresh(session); // Schedule next refresh
      } catch (e) {
        console.warn('[aimeat-auth] Auto-refresh failed:', e.message);
        emit('expired', { reason: 'refresh_failed', error: e.message });
      }
    }, refreshIn);
  } catch (_) { /* invalid JWT, skip scheduling */ }
}

function createSession(data) {
  // Extract roles from JWT payload so UI can check owner/operator status
  const jwtPayload = data.jwt ? parseJwt(data.jwt) : null;
  // owner MUST be a string (or null). Login paths feed it differently (a JWT claim, an object's
  // .name, a stored value), and downstream code calls owner.split (e.g. the identicon avatar), so a
  // non-string owner would crash the whole view. Coerce it here, at the one place every path goes through.
  let ownerVal = data.owner;
  if (ownerVal != null && typeof ownerVal !== 'string') {
    ownerVal = (typeof ownerVal === 'object' && typeof ownerVal.name === 'string') ? ownerVal.name : String(ownerVal);
  }
  // ghii MUST be a string (or null) for the same reason: downstream code calls ghii.split('@')
  // (workspace createdBy, identity routing) and stores data keyed by it. Some writers persisted the
  // server's WHOLE ghii object ({ ghii, username, display_name }) instead of the canonical string —
  // that re-hydrates here on every boot. Extract the string at the one funnel every path goes through.
  let ghiiVal = data.ghii;
  if (ghiiVal != null && typeof ghiiVal !== 'string') {
    ghiiVal = (typeof ghiiVal === 'object' && typeof ghiiVal.ghii === 'string') ? ghiiVal.ghii : String(ghiiVal);
  }
  const session = {
    ghii: ghiiVal || null,
    owner: ownerVal,
    gaii: data.gaii || null,
    identity: data.gaii || ghiiVal || null,
    jwt: data.jwt,
    roles: jwtPayload?.roles || data.roles || [],
    displayName: data.displayName || '',
    // SECURITY: Private keys are stored as non-extractable CryptoKeys in IndexedDB,
    // NOT in this session object or localStorage. Use _cryptoKey for in-memory ref only.
    _cryptoKey: data._cryptoKey || null,
    publicKey: data.publicKey,
    nodeUrl: NODE_URL,
    federated: data.federated || false,
    homeNode: data.homeNode || '',
    homeUrl: data.homeUrl || '',

    // Authenticated fetch wrapper — returns parsed JSON without throwing on error
    // so callers (e.g. AIMEAT.data.get) can inspect res.ok / res.error themselves
    async fetch(path, opts = {}) {
      if (isExpired(session.jwt)) {
        await session.refresh();
      }
      const url = NODE_URL + path;
      const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.jwt, ...(opts.headers || {}) };
      const resp = await fetch(url, { ...opts, headers });
      return resp.json();
    },

    // Notify the signed-in owner (header bell + browser push if subscribed). Apps need the
    // 'notifications:send' scope in their grant; an app notification deep-links back to the
    // app by default (pass opts.link for a different same-node target).
    // Usage: await session.notify('Report ready', { body: 'Q2 numbers are in.' })
    async notify(title, opts = {}) {
      return session.fetch('/v1/notifications', {
        method: 'POST',
        body: JSON.stringify({ title, body: opts.body, link: opts.link, type: opts.type }),
      });
    },

    // Get a fresh access token. Owner sessions use the httpOnly refresh cookie
    // (POST /v1/auth/refresh, rotation + reuse-detection server-side); agent sessions
    // still re-sign with their IndexedDB key. Concurrent owner refreshes share one
    // in-flight request so they don't each rotate the cookie.
    async refresh() {
      // App-origin sessions re-mint via the silent bridge (the apex cookie isn't reachable here).
      if (session._appOrigin) {
        var t = await silentAppToken();
        if (!t || !t.access_token) throw new Error('App session expired — the owner is not logged in on the node.');
        session.jwt = t.access_token;
        session.roles = (parseJwt(session.jwt) || {}).roles || session.roles || [];
        persistSession(session);
        scheduleAutoRefresh(session);
        return session;
      }
      // Federated sessions can't self-refresh yet — user must re-login.
      if (session.federated) {
        throw new Error('Federated session expired. Please log in again.');
      }

      if (session.gaii) {
        // Agent session — legacy key-signing refresh.
        const key = session._cryptoKey || await loadKey('agent_key');
        if (!key) throw new Error('Cannot refresh — no signing key found in IndexedDB');
        const timestamp = new Date().toISOString();
        const signature = await sign(key, session.gaii + timestamp);
        const data = await api('/v1/auth/token', {
          method: 'POST',
          body: JSON.stringify({ gaii: session.gaii, timestamp, signature }),
        });
        session.jwt = data.data.token;
        session.roles = (parseJwt(session.jwt) || {}).roles || session.roles || [];
        persistSession(session);
        scheduleAutoRefresh(session);
        return session;
      }

      // Owner session — httpOnly refresh-cookie rotation (single-flight).
      if (ownerRefreshInFlight) return ownerRefreshInFlight;
      ownerRefreshInFlight = (async () => {
        const resp = await fetch(NODE_URL + '/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-AIMEAT-Refresh': '1' },
        });
        let data = null;
        try { data = await resp.json(); } catch (_) { /* no body */ }
        if (!resp.ok || !data || data.ok === false) {
          throw new Error(data?.error?.message || 'Session refresh failed');
        }
        session.jwt = data.data.token;
        session.roles = (parseJwt(session.jwt) || {}).roles || session.roles || [];
        // The refreshed token is AUTHORITATIVE for identity. If it is for a different owner than the
        // persisted session (e.g. an OAuth sign-in as a different user without a clean logout, so boot
        // restored the previous session then refreshed against the new cookie), adopt the owner + GHII
        // from the token — otherwise the profile/pill would show a stale identity. (ghii = owner@node.)
        var freshClaims = parseJwt(session.jwt) || {};
        if (freshClaims.owner && freshClaims.owner !== session.owner) {
          session.owner = freshClaims.owner;
          if (freshClaims.node) session.ghii = freshClaims.owner + '@' + freshClaims.node;
          session.identity = session.gaii || session.ghii || null;
        }
        // The owner may have edited their profile since login — adopt the fresh display
        // name the server returns so the login pill stays current without a re-login.
        if (typeof data.data.display_name === 'string') session.displayName = data.data.display_name;
        persistSession(session);
        scheduleAutoRefresh(session);
        return session;
      })();
      try { return await ownerRefreshInFlight; }
      finally { ownerRefreshInFlight = null; }
    },

    // Check if session is valid
    get valid() { return session.jwt && !isExpired(session.jwt); },
  };
  return session;
}
`;
}
