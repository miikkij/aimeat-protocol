/**
 * @file libs.ts
 * @description Serves browser helper libraries used by AIMEAT apps, including auth, data, storage, social, wallet, and capability clients.
 * @structure libsRouter route registration; aimeatAuthLib browser auth/session helper; individual library imports delegated to lib-* modules.
 * @usage app.use(libsRouter(config, storage)) from the server setup.
 * @version-history
 * v1.19.0 - 2026-06-20 - aimeat-auth.js seamless SSO on app origins (H-2): when the SDK runs on a
 *   *.apps.<domain> host (where the host-only cookie is unreachable), AIMEAT.auth.login() + refresh()
 *   pull a scoped grant token via the same-site silent bridge (hidden iframe → apex), so an app like
 *   Sanomat is logged in with no separate login. The bridge targets the baked-in APEX_URL (NOT
 *   NODE_URL, which is location.origin = the APP origin on http/https). mountLoginButton re-renders on
 *   the 'login'/'logout' events so the button updates after the async silent login (no opts.onLogin to
 *   avoid a reload loop), and on an app origin with no session it kicks off the silent bridge ITSELF
 *   (so an app that only calls mountLoginButton, never auth.login(), still auto-logs-in). Concurrent
 *   callers share one in-flight bridge. isAppOrigin / silentAppToken / restoreSessionFromAppOrigin.
 * v1.18.0 - 2026-06-20 - Sign-in modal submits on Enter from any field (username/password/
 *   display name), unless the button is mid-request.
 * v1.17.0 - 2026-06-20 - Sign-in modal shows a "Continue with Google" button when the node
 *   has Google sign-in configured (GOOGLE_LOGIN_ENABLED baked in from config). The button
 *   navigates to /v1/ghii/login/google; the node sets a refresh cookie on callback and the
 *   SPA boots logged-in. New modal i18n keys: orLabel, googleSignIn.
 * v1.16.0 - 2026-06-09 - Sign-in modal (showLoginModal) gains a self-contained EN/FI
 *   language switcher. The modal now loads its own translations (same 'aimeat-lang'
 *   key + cookie as the header) and re-renders in place on switch, so it shows/lets
 *   you change the language even when shown standalone without the canonical header.
 * v1.15.0 - 2026-06-03 - aimeat-auth.js boot restores a session from the httpOnly refresh
 *   cookie alone (no localStorage) so a browser an agent authenticated with an owner access
 *   token shows as logged in. (Agent access tokens, Phase 3b.)
 * v1.14.0 - 2026-06-03 - mountLoginButton: add hook classes (aimeat-auth-pill/-dot/
 *   -label/-ghii/-logout) so the logged-in pill can go compact on mobile (theme.css
 *   hides label+ghii, keeping the dot + Logout). Pill markup/styles otherwise unchanged.
 * v1.13.0 - 2026-06-03 - aimeat-auth.js owner sessions now refresh via the httpOnly
 *   refresh cookie (POST /v1/auth/refresh) instead of owner-key signing: single-flight
 *   refresh, refresh-on-boot, logout revokes server-side. Cross-device login no longer
 *   breaks other sessions. Agent/federated paths unchanged. (Phase 3 of refresh-tokens.)
 * v1.12.0 - 2026-06-03 - Session resilience: aimeat-auth.js now refreshes the
 *   JWT on tab focus/visibilitychange (timers don't fire while the machine sleeps
 *   or the tab is frozen, so the proactive setTimeout was unreliable). loginWithPassword
 *   sends request_owner_key only when this device holds no key, so password login
 *   no longer rotates the owner key and breaks other devices' refresh.
 * v1.11.0 - 2026-05-31 - Add aimeat-agents.js — apps commission & observe the
 *   owner's agents (list, createTask/run, watch via SSE, deliverables,
 *   option-prompt answer loop). Registered as a route + in the /v1/libs catalogue.
 * v1.10.0 - 2026-05-29 - Add aimeat-ai.js — AI completion using the user's
 *   OpenRouter key (apps reach /v1/ai/complete; budget + per-app quotas
 *   enforced server-side). Registered both as a route and in the /v1/libs
 *   catalogue.
 * v1.9.8 - 2026-05-28 - Modal submit button now reads "Sign In / Register" to surface upsert behavior.
 * v1.9.7 - 2026-05-28 - Disable browser caching for generated helper libraries.
 * v1.9.6 - 2026-05-28 - Handle dev-mode auth reset responses in browser auth registration.
 */
import { Router, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { aimeatDataLib } from './lib-data.js';
import { aimeatStorageLib } from './lib-storage.js';
import { aimeatSocialLib } from './lib-social.js';
import { aimeatWalletLib } from './lib-wallet.js';
import { aimeatWorkLib } from './lib-work.js';
import { aimeatTunnelLib } from './lib-tunnel.js';
import { aimeatAudioLib } from './lib-audio.js';
import { aimeatSpeechLib } from './lib-speech.js';
import { aimeatCapabilitiesLib } from './lib-capabilities.js';
import { aimeatAiLib } from './lib-ai.js';
import { aimeatAgentsLib } from './lib-agents.js';
import { aimeatHeaderLib } from './lib-header.js';

function sendJavascriptLibrary(res: Response, source: string): void {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.type('application/javascript').send(source);
}

/**
 * Serves helper JavaScript libraries at /v1/libs/*
 * These are self-contained scripts that AI-generated apps include via <script> tag.
 * The app files are served from the AIMEAT node itself — zero CORS issues.
 */
export function libsRouter(config: AimeatConfig, _storage: Storage): Router {
  const router = Router();

  // GET /v1/libs/aimeat-auth.js — Auth helper library
  router.get('/v1/libs/aimeat-auth.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatAuthLib(config));
  });

  // GET /v1/libs/aimeat-header.js — Drop-in canonical site header (nav + theme +
  // language + live login pill) for standalone pages such as custom portal templates.
  router.get('/v1/libs/aimeat-header.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatHeaderLib(config));
  });

  // GET /v1/libs/aimeat-data.js — Memory & Micro-Memory library
  router.get('/v1/libs/aimeat-data.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatDataLib(config));
  });

  // GET /v1/libs/aimeat-storage.js — File storage library
  router.get('/v1/libs/aimeat-storage.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatStorageLib(config));
  });

  // GET /v1/libs/aimeat-social.js — Boards & social library
  router.get('/v1/libs/aimeat-social.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatSocialLib(config));
  });

  // GET /v1/libs/aimeat-wallet.js — Wallet library
  router.get('/v1/libs/aimeat-wallet.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatWalletLib(config));
  });

  // GET /v1/libs/aimeat-work.js — Actions & work exchange library
  router.get('/v1/libs/aimeat-work.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatWorkLib(config));
  });

  // GET /v1/libs/aimeat-tunnel.js — Personal node tunnel client
  router.get('/v1/libs/aimeat-tunnel.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatTunnelLib(config));
  });

  // GET /v1/libs/aimeat-audio.js — Audio engine library
  router.get('/v1/libs/aimeat-audio.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatAudioLib(config));
  });

  // GET /v1/libs/aimeat-speech.js — Speech library
  router.get('/v1/libs/aimeat-speech.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatSpeechLib(config));
  });

  // GET /v1/libs/aimeat-capabilities.js — Capability discovery, invoke, management
  router.get('/v1/libs/aimeat-capabilities.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatCapabilitiesLib(config));
  });

  // GET /v1/libs/aimeat-ai.js — AI completion using the user's OpenRouter key
  router.get('/v1/libs/aimeat-ai.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatAiLib(config));
  });

  // GET /v1/libs/aimeat-agents.js — commission & observe the owner's agents
  router.get('/v1/libs/aimeat-agents.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatAgentsLib(config));
  });

  // GET /v1/libs/ — List available libraries
  router.get('/v1/libs', (_req, res) => {
    res.json({
      ok: true,
      libraries: [
        {
          name: 'aimeat-auth',
          url: '/v1/libs/aimeat-auth.js',
          description: 'Identity & session: registration, Ed25519 auth, JWT lifecycle, login UI',
          size_estimate: '~25KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-auth.js"></script>`,
        },
        {
          name: 'aimeat-header',
          url: '/v1/libs/aimeat-header.js',
          description: 'Canonical site header for standalone pages (custom portal templates): brand + morsels, nav, language switcher, theme toggle, and the live golden login pill. Mounts into #aimeat-header or prepends to <body>.',
          size_estimate: '~7KB',
          include: `<div id="aimeat-header"></div>\n<script src="${config.baseUrl}/v1/libs/aimeat-header.js"></script>`,
        },
        {
          name: 'aimeat-data',
          url: '/v1/libs/aimeat-data.js',
          description: 'Memory & Micro-Memory: key-value storage, search, public reads, OTK sets',
          size_estimate: '~8KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-data.js"></script>`,
          requires: 'aimeat-auth',
        },
        {
          name: 'aimeat-storage',
          url: '/v1/libs/aimeat-storage.js',
          description: 'File storage: upload, download, chunked upload, drag & drop helper',
          size_estimate: '~8KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-storage.js"></script>`,
          requires: 'aimeat-auth',
        },
        {
          name: 'aimeat-social',
          url: '/v1/libs/aimeat-social.js',
          description: 'Boards & social: create boards, post, react, reply, subscribe',
          size_estimate: '~6KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-social.js"></script>`,
          requires: 'aimeat-auth',
        },
        {
          name: 'aimeat-wallet',
          url: '/v1/libs/aimeat-wallet.js',
          description: 'Morsel economy: balance, transactions, request morsels, UI badge',
          size_estimate: '~6KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-wallet.js"></script>`,
          requires: 'aimeat-auth',
        },
        {
          name: 'aimeat-work',
          url: '/v1/libs/aimeat-work.js',
          description: 'Actions & work: catalogue, work requests, inbox, deliver, rate, polling',
          size_estimate: '~8KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-work.js"></script>`,
          requires: 'aimeat-auth',
        },
        {
          name: 'aimeat-tunnel',
          url: '/v1/libs/aimeat-tunnel.js',
          description: 'Personal node tunnel: auto-reconnect WebSocket, heartbeat, mailbox sync, request/response',
          size_estimate: '~10KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-tunnel.js"></script>`,
          requires: 'aimeat-auth',
        },
        {
          name: 'aimeat-audio',
          url: '/v1/libs/aimeat-audio.js',
          description: 'Audio engine: 6 built-in instruments (piano, guitar, bass, drums, flute, synth), custom synth builder, sample loader, soundboard, realtime bridge',
          size_estimate: '~60KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-audio.js"></script>`,
        },
        {
          name: 'aimeat-capabilities',
          url: '/v1/libs/aimeat-capabilities.js',
          description: 'Capability discovery, invoke, and management: list, search, invoke, create, vouch',
          size_estimate: '~6KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-capabilities.js"></script>`,
          requires: 'aimeat-auth',
        },
        {
          name: 'aimeat-speech',
          url: '/v1/libs/aimeat-speech.js',
          description: 'Speech: text-to-speech, speech-to-text, voice commands, pluggable providers (ElevenLabs, Whisper, etc.)',
          size_estimate: '~15KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-speech.js"></script>`,
        },
        {
          name: 'aimeat-ai',
          url: '/v1/libs/aimeat-ai.js',
          description: 'AI completion using the user\'s configured OpenRouter key. Per-user daily budget and per-app quotas enforce safe spend.',
          size_estimate: '~4KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-ai.js"></script>`,
          requires: 'aimeat-auth',
        },
        {
          name: 'aimeat-agents',
          url: '/v1/libs/aimeat-agents.js',
          description: 'Agents: list, commission tasks (createTask/run), watch progress live (SSE), read deliverables, and the ask-the-user option-prompt loop.',
          size_estimate: '~7KB',
          include: `<script src="${config.baseUrl}/v1/libs/aimeat-agents.js"></script>`,
          requires: 'aimeat-auth',
        },
      ],
    });
  });

  // GET /v1/libs/test-harness — HTML page that loads all libraries (dev mode only)
  if (config.devMode) {
    router.get('/v1/libs/test-harness', (_req, res) => {
      const nonce = res.locals.cspNonce as string;
      res.type('text/html').send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>AIMEAT Libraries Test Harness</title>
<script src="/v1/libs/aimeat-auth.js"></script>
<script src="/v1/libs/aimeat-data.js"></script>
<script src="/v1/libs/aimeat-storage.js"></script>
<script src="/v1/libs/aimeat-social.js"></script>
<script src="/v1/libs/aimeat-wallet.js"></script>
<script src="/v1/libs/aimeat-work.js"></script>
<script src="/v1/libs/aimeat-tunnel.js"></script>
<script src="/v1/libs/aimeat-audio.js"></script>
<script src="/v1/libs/aimeat-speech.js"></script>
</head>
<body>
<h1 id="title">AIMEAT Test Harness</h1>
<pre id="log"></pre>
<script nonce="${nonce}">
window.__testLog = [];
window.tlog = function(msg) {
  window.__testLog.push(msg);
  document.getElementById('log').textContent = window.__testLog.join('\\n');
};
window.tlog('Libraries loaded: auth=' + !!AIMEAT.auth + ' data=' + !!AIMEAT.data + ' storage=' + !!AIMEAT.storage + ' social=' + !!AIMEAT.social + ' wallet=' + !!AIMEAT.wallet + ' work=' + !!AIMEAT.work + ' tunnel=' + !!AIMEAT.tunnel + ' audio=' + !!AIMEAT.audio + ' speech=' + !!AIMEAT.speech);
window.__ready = true;
</script>
</body></html>`);
    });
  }

  return router;
}

/* ─────────────────────────────────────────────────────────────────
   aimeat-auth.js — Self-contained auth library for AI-generated apps
   
   Handles:
   - GHII registration (human identity)
   - Ed25519 keypair generation via Web Crypto
   - Challenge/response authentication
   - JWT storage in localStorage
   - Auto-refresh before expiry
   - Authenticated fetch wrapper
   - Login/register UI component
   ───────────────────────────────────────────────────────────────── */

function aimeatAuthLib(config: AimeatConfig): string {
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

const NODE_ID = '${config.nodeId}';

// Social login availability (baked in server-side from node config).
const GOOGLE_LOGIN_ENABLED = ${config.googleOAuthEnabled ? 'true' : 'false'};

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
  if (!data.ok) throw new Error(data.error?.message || 'API error');
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
      var r = d.result || {};
      finish((r && r.ok && r.access_token) ? r : null);
    }
    window.addEventListener('message', onMsg);
    iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = apexOrigin + '/app-silent.html?scope=' + encodeURIComponent('memory:read memory:write');
    (document.body || document.documentElement).appendChild(iframe);
    timer = setTimeout(function () { finish(null); }, 8000);
  });
}

// Shared in-flight promise so concurrent callers (an app that runs BOTH mountLoginButton's auto
// trigger AND its own auth.login()) reuse a single silent bridge instead of opening two iframes.
let _appOriginLoginInFlight = null;
function restoreSessionFromAppOrigin() {
  if (currentSession) return Promise.resolve(currentSession);
  if (_appOriginLoginInFlight) return _appOriginLoginInFlight;
  _appOriginLoginInFlight = (async function () {
    var r = await silentAppToken();
    if (!r || !r.access_token) return null;
    var payload = parseJwt(r.access_token) || {};
    var ownerName = payload.owner || payload.sub;
    if (!ownerName) return null;
    var session = createSession({
      owner: ownerName,
      ghii: String(ownerName).indexOf('@') >= 0 ? ownerName : (ownerName + '@' + NODE_ID),
      gaii: null, jwt: r.access_token, roles: payload.roles || [], displayName: '',
    });
    session._appOrigin = true;
    persistSession(session);
    currentSession = session;
    scheduleAutoRefresh(session);
    emit('login', session);
    return session;
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
  const session = {
    ghii: data.ghii || null,
    owner: data.owner,
    gaii: data.gaii || null,
    identity: data.gaii || data.ghii || null,
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

// ── Event system ──
const listeners = {};
function emit(event, data) { (listeners[event] || []).forEach(fn => fn(data)); }

// ── Public API ──

const auth = {
  nodeUrl: NODE_URL,
  nodeId: NODE_ID,

  /**
   * Register a new human identity (GHII) and get an authenticated session.
   * @param {string} username - Username (3-64 chars, lowercase alphanumeric + hyphens)
   * @param {string} displayName - Human-readable display name
   * @param {object} [opts] - Optional: bio, avatar, locale, password
   * @returns {Promise<object>} Session object with .fetch(), .refresh(), .jwt, .ghii
   */
  async register(username, displayName, opts = {}) {
    // Register GHII (creates owner + human profile)
    const regData = await api('/v1/ghii', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({
        username,
        display_name: displayName,
        bio: opts.bio,
        avatar: opts.avatar,
        locale: opts.locale,
        password: opts.password || undefined,
      }),
    });

    // With a password, establish a cookie-backed session via the login endpoint
    // (owner sessions refresh via the httpOnly cookie — no signing key needed).
    if (opts.password) {
      return this.loginWithPassword(username, opts.password);
    }

    // ── Legacy no-password path: key-signing token, no refresh cookie ──
    const ownerName = regData.data.owner.name;
    const ghii = regData.data.ghii.ghii;
    // Normal registration returns private_key/public_key; dev-mode reset returns owner_private_key/owner_public_key.
    const serverPrivateKey = regData.data.private_key || regData.data.owner_private_key;
    const serverPublicKey = regData.data.public_key || regData.data.owner_public_key || '';
    if (!serverPrivateKey) {
      throw new Error('Server did not return an owner signing key. Please try signing in again.');
    }

    // Dev-mode reset already returns an owner JWT. Fresh registration still needs to mint one.
    let ownerToken = regData.data.token || null;
    if (!ownerToken) {
      const ownerTimestamp = new Date().toISOString();
      const ownerMessage = ownerName + NODE_ID + ownerTimestamp;
      const ownerSig = await sign(serverPrivateKey, ownerMessage);
      const ownerTokenData = await api('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp: ownerTimestamp, signature: ownerSig }),
      });
      ownerToken = ownerTokenData.data.token;
    }

    // SECURITY: Import owner private key as non-extractable CryptoKey in IndexedDB
    const ownerCryptoKey = await importEd25519Key(serverPrivateKey);
    await storeKey('owner_key', ownerCryptoKey);

    // Owner session — agents are connected later via device auth
    const session = createSession({
      ghii, owner: ownerName, gaii: null,
      jwt: ownerToken,
      _cryptoKey: ownerCryptoKey, publicKey: serverPublicKey,
      displayName: regData.data.ghii.display_name || '',
    });

    // SECURITY: Only save metadata to localStorage (no private keys)
    save('session', {
      owner: ownerName, gaii: null, ghii,
      jwt: session.jwt, publicKey: serverPublicKey, roles: session.roles,
      displayName: session.displayName || '',
    });

    currentSession = session;
    scheduleAutoRefresh(session);
    emit('login', session);
    return session;
  },

  /**
   * Login with stored credentials (auto-refreshes JWT if expired).
   * @param {string} [username] - Optional: login as specific user (default: last session)
   * @returns {Promise<object|null>} Session or null if no stored credentials
   */
  async login(username) {
    // On an app origin the host-only cookie is unreachable (cross-origin + CORS *); use the
    // same-site silent bridge so the owner's own app is logged in with no separate login (H-2).
    if (isAppOrigin()) return await restoreSessionFromAppOrigin();
    const stored = load('session');
    // No local metadata — but an httpOnly refresh cookie may exist (e.g. a browser an agent
    // authenticated with an owner access token). Restore the session from the cookie alone.
    if (!stored) return await restoreSessionFromCookie();
    if (username && stored.owner !== username) return null;

    // SECURITY: Run one-time migration from localStorage to IndexedDB
    await migrateKeysToIndexedDB();

    // Migrate old agent sessions to owner sessions:
    // If stored session has gaii (old agent-based login), convert to owner session
    if (stored.gaii) {
      stored.gaii = null;
    }

    // Load CryptoKey from IndexedDB — owner key for owner sessions, agent key for agent sessions
    const cryptoKey = stored.gaii ? await loadKey('agent_key') : await loadKey('owner_key');
    const session = createSession({ ...stored, _cryptoKey: cryptoKey });

    // Owner-local sessions ALWAYS refresh on boot: the httpOnly cookie is the source of
    // truth (the stored access token may be stale or predate the cookie system). Agent /
    // federated sessions refresh only when their token is actually expired (legacy path).
    const isOwnerLocal = !session.federated && !session.gaii;
    if (isOwnerLocal || isExpired(session.jwt)) {
      try {
        await session.refresh();
      } catch(e) {
        remove('session');
        emit('expired');
        return null;
      }
    }

    currentSession = session;
    scheduleAutoRefresh(session);
    emit('login', session);
    return session;
  },

  /**
   * Login with username + password (works from any device).
   * Server verifies password, regenerates keys, returns fresh session.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<object>} Session object
   */
  async loginWithPassword(username, password) {
    // Owner sessions refresh via the httpOnly cookie, so no signing key is needed and
    // we never ask the server to mint/rotate one (that used to break other devices).
    // credentials:'include' lets the server set the refresh cookie.
    const data = await api('/v1/ghii/login', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });

    const d = data.data;

    // Federated logins may still return an owner key pair; store it if present (harmless).
    let ownerCryptoKey = null;
    if (d.owner_private_key) {
      ownerCryptoKey = await importEd25519Key(d.owner_private_key);
      await storeKey('owner_key', ownerCryptoKey);
    }

    // Owner session — human users authenticate as owners, not agents
    const session = createSession({
      ghii: d.ghii.ghii,
      owner: d.owner.name,
      gaii: null,
      jwt: d.token,
      _cryptoKey: ownerCryptoKey,
      publicKey: d.owner_public_key || '',
      displayName: d.ghii.display_name || '',
      federated: d.federated || false,
      homeNode: d.home_node || '',
      homeUrl: d.home_url || '',
    });

    persistSession(session);

    currentSession = session;
    scheduleAutoRefresh(session);
    emit('login', session);
    return session;
  },

  /** Get the current session (or null if not logged in) */
  getSession() {
    return currentSession;
  },

  /** Logout — clear stored credentials from localStorage and IndexedDB */
  async logout() {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    ownerRefreshInFlight = null;
    // Revoke the session and clear the httpOnly refresh cookie server-side.
    try {
      await fetch(NODE_URL + '/v1/auth/revoke', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(currentSession?.jwt ? { 'Authorization': 'Bearer ' + currentSession.jwt } : {}),
        },
      });
    } catch (_) { /* best effort — still clear local state below */ }
    currentSession = null;
    remove('session');
    remove('owner_key');
    // SECURITY: Delete CryptoKeys from IndexedDB
    await deleteKey('agent_key');
    await deleteKey('owner_key');
    emit('logout');
  },

  /** Check if there are stored credentials */
  get hasSession() { return !!load('session'); },

  /** Get stored GHII without authenticating */
  get storedGhii() { const s = load('session'); return s?.ghii || null; },

  /** Register an event listener */
  on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
  },

  /** Remove an event listener */
  off(event, fn) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(f => f !== fn);
  },

  /** Check if running inside a sandboxed iframe (no localStorage access) */
  get inSandbox() {
    try { localStorage.getItem('_test'); return false; } catch(e) { return true; }
  },

  /**
   * Request auth credentials from the parent window via postMessage.
   * Use this when the app runs in a sandboxed iframe without localStorage access.
   * The parent (app-catalog) listens for { type: 'aimeat-request-auth' }
   * and responds with { type: 'aimeat-auth', jwt, nodeUrl }.
   * @param {number} [timeout=3000] - Max ms to wait for response
   * @returns {Promise<object|null>} Session-like object with .jwt and .fetch(), or null
   */
  requestParentAuth(timeout = 3000) {
    return new Promise((resolve) => {
      if (window === window.parent) { resolve(null); return; }

      let resolved = false;
      const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, timeout);

      function handler(e) {
        if (resolved) return;
        if (!e.data || e.data.type !== 'aimeat-auth') return;
        resolved = true;
        clearTimeout(timer);
        window.removeEventListener('message', handler);

        const jwt = e.data.jwt;
        const parentNodeUrl = e.data.nodeUrl;
        if (!jwt) { resolve(null); return; }

        // Override NODE_URL if parent provided one
        const effectiveNodeUrl = parentNodeUrl || NODE_URL;

        const session = {
          jwt,
          nodeUrl: effectiveNodeUrl,
          owner: null,
          gaii: null,
          ghii: null,
          identity: null,
          get valid() { return jwt && !isExpired(jwt); },
          async fetch(path, opts = {}) {
            const url = effectiveNodeUrl + path;
            const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt, ...(opts.headers || {}) };
            const resp = await fetch(url, { ...opts, headers });
            return resp.json();
          },
        };

        // Parse JWT to extract identity info
        const payload = parseJwt(jwt);
        if (payload) {
          session.gaii = payload.sub || null;
          session.owner = payload.owner || null;
          session.identity = session.gaii || session.ghii || null;
        }

        currentSession = session;
        emit('login', session);
        resolve(session);
      }

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: 'aimeat-request-auth' }, '*');
    });
  },

  /**
   * Mount a login/register button that handles the full flow.
   * @param {string} selector - CSS selector for the container element
   * @param {object} [opts] - Options: { onLogin, onLogout, buttonText }
   */
  mountLoginButton(selector, opts = {}) {
    const container = document.querySelector(selector);
    if (!container) { console.error('AIMEAT: Container not found:', selector); return; }

    const i = opts.i18n || {};

    function render() {
      const stored = load('session');
      if (stored) {
        container.innerHTML = '<div class="aimeat-auth-pill" style="display:inline-flex;align-items:center;gap:10px;padding:8px 18px;'
          + 'background:linear-gradient(160deg,#3d2e1a 0%,#6b4c2a 15%,#c9a84c 30%,#f5e6a3 45%,#c9a84c 55%,#8b6914 70%,#4a3520 100%);'
          + 'border:1px solid rgba(201,168,76,.6);border-top-color:rgba(245,230,163,.5);border-bottom-color:rgba(75,53,32,.8);'
          + 'border-radius:10px;'
          + 'box-shadow:0 1px 0 rgba(245,230,163,.3) inset,0 -1px 0 rgba(75,53,32,.5) inset,0 3px 10px rgba(0,0,0,.4),0 0 20px rgba(201,168,76,.15);'
          + 'font-family:system-ui;font-size:14px">'
          + '<span class="aimeat-auth-dot" style="display:inline-block;flex:0 0 auto;width:9px;height:9px;border-radius:50%;'
          + 'background:radial-gradient(circle at 35% 35%,#b0ffc8,#00c853 40%,#00802e 80%,#003d15);'
          + 'box-shadow:0 0 5px rgba(0,200,83,.7),0 0 12px rgba(0,200,83,.3),inset 0 -1px 2px rgba(0,0,0,.3)"></span>'
          + '<span class="aimeat-auth-label" style="display:inline-flex;align-items:center;font-size:12px;font-weight:600;letter-spacing:.5px;color:#a0ffb8;text-shadow:0 0 4px rgba(0,210,80,.6),0 0 10px rgba(0,180,70,.3)">'
          + escHtml(i.loggedIn || 'logged in') + '</span>'
          + '<span class="aimeat-auth-ghii" style="color:rgba(90,65,20,.7);font-weight:700;letter-spacing:.5px;font-size:13px;'
          + 'text-shadow:0 1px 0 rgba(245,230,163,.6),0 -1px 0 rgba(50,35,10,.3);'
          + '-webkit-text-stroke:.2px rgba(120,85,20,.3)">'
          + escHtml(stored.ghii || stored.owner) + '</span>'
          + (stored.federated ? '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;letter-spacing:.5px;color:#7dd3fc;'
            + 'background:rgba(56,189,248,.15);padding:2px 6px;border-radius:4px;border:1px solid rgba(56,189,248,.3)">'
            + '\\u{1F310} ' + escHtml(i.federated || 'Federated') + '</span>' : '')
          + '<button id="aimeat-logout-btn" class="aimeat-auth-logout" style="'
          + 'background:radial-gradient(ellipse at 50% 30%,#ff6b6b 0%,#dc2626 35%,#991b1b 70%,#7f1d1d 100%);'
          + 'color:#ffd7d7;border:1px solid rgba(220,38,38,.6);border-top-color:rgba(255,130,130,.4);border-bottom-color:rgba(100,20,20,.8);'
          + 'border-radius:6px;padding:3px 10px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:.3px;'
          + 'box-shadow:0 1px 0 rgba(255,140,140,.25) inset,0 -1px 0 rgba(80,10,10,.4) inset,0 2px 6px rgba(153,27,27,.5);'
          + 'text-shadow:0 1px 1px rgba(0,0,0,.4)">' + escHtml(i.logoutBtn || 'Logout') + '</button>'
          + '</div>';
        document.getElementById('aimeat-logout-btn').addEventListener('click', () => {
          auth.logout();
          render();
          if (opts.onLogout) opts.onLogout();
        });
      } else {
        container.innerHTML = '<style>.aimeat-sign-btn{'
          + 'padding:8px 18px;'
          + 'background:linear-gradient(160deg,#3d2e1a 0%,#6b4c2a 15%,#c9a84c 30%,#f5e6a3 45%,#c9a84c 55%,#8b6914 70%,#4a3520 100%);'
          + 'color:#2a1800;border:1px solid rgba(201,168,76,.6);border-top-color:rgba(245,230,163,.5);border-bottom-color:rgba(75,53,32,.8);'
          + 'border-radius:10px;cursor:pointer;font-weight:800;font-family:system-ui;font-size:14px;letter-spacing:.3px;'
          + 'box-shadow:0 1px 0 rgba(245,230,163,.3) inset,0 -1px 0 rgba(75,53,32,.5) inset,0 3px 10px rgba(0,0,0,.4),0 0 20px rgba(201,168,76,.15);'
          + 'text-shadow:0 1px 0 rgba(245,230,163,.5);'
          + 'transition:transform .15s,box-shadow .15s}'
          + '.aimeat-sign-btn:hover{transform:translateY(-1px);box-shadow:0 1px 0 rgba(245,230,163,.3) inset,0 -1px 0 rgba(75,53,32,.5) inset,0 5px 16px rgba(0,0,0,.5),0 0 30px rgba(201,168,76,.3)}'
          + '</style>'
          + '<button id="aimeat-login-btn" class="aimeat-sign-btn">'
          + (opts.buttonText || i.signInBtn || '\\u2764\\ufe0f Sign In') + '</button>';
        document.getElementById('aimeat-login-btn').addEventListener('click', () => showLoginModal(opts, render));
      }
    }
    render();
    // Re-render when the session changes out-of-band — e.g. the H-2 silent SSO on an app origin
    // logs in asynchronously AFTER this button first painted "Sign In". Only re-render (do NOT call
    // opts.onLogin here — the interactive modal path already does, and apps often set onLogin to
    // location.reload(), which would loop with the auto silent login).
    auth.on('login', render);
    auth.on('logout', render);
    // Seamless SSO: on an app origin (*.apps.<domain>) with no session yet, attempt the silent
    // bridge ourselves so the owner's own app is logged in even if it never calls auth.login()
    // explicitly. Best-effort + idempotent: if the bridge yields a session it fires 'login' (→ the
    // button re-renders); if it returns null (anonymous visitor / not the owner) the button stays
    // "Sign In". currentSession guards against racing an explicit login() the app may also run.
    if (isAppOrigin() && !currentSession && !load('session')) {
      restoreSessionFromAppOrigin().catch(() => {});
    }
  },
};

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Sign-in modal language helpers ──
// The modal can be shown standalone (e.g. a custom portal page) where the
// canonical header — and its language switcher — is not present. So the modal
// owns its own EN/FI switcher and can (re)load translations itself, using the
// same 'aimeat-lang' localStorage key + cookie the header uses, so the choice
// stays in sync with the SPA.
var MODAL_LANG_KEY = 'aimeat-lang';

function currentModalLang() {
  try {
    var u = new URLSearchParams(location.search).get('lang');
    if (u === 'en' || u === 'fi') return u;
    var s = localStorage.getItem(MODAL_LANG_KEY);
    if (s === 'en' || s === 'fi') return s;
  } catch (e) {}
  return (navigator.language || 'en').slice(0, 2).toLowerCase() === 'fi' ? 'fi' : 'en';
}

function flattenModalI18n(obj, prefix, out) {
  out = out || {}; prefix = prefix || '';
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    var key = prefix ? prefix + '.' + k : k;
    var v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenModalI18n(v, key, out);
    else out[key] = v;
  }
  return out;
}

// Fetch en.json (base) + <lang>.json (overrides) from the node and return just
// the modal.* strings with the 'modal.' prefix stripped — the shape the modal
// (and every mountLoginButton caller) expects for opts.i18n.
async function loadModalI18n(lang) {
  var v = Date.now();
  var t = {};
  try {
    var enRes = await fetch(NODE_URL + '/locales/en.json?v=' + v);
    if (enRes.ok) t = flattenModalI18n(await enRes.json());
  } catch (e) {}
  if (lang !== 'en') {
    try {
      var locRes = await fetch(NODE_URL + '/locales/' + lang + '.json?v=' + v);
      if (locRes.ok) {
        var loc = flattenModalI18n(await locRes.json());
        for (var lk in loc) if (Object.prototype.hasOwnProperty.call(loc, lk)) t[lk] = loc[lk];
      }
    } catch (e) {}
  }
  var out = {};
  for (var k in t) {
    if (Object.prototype.hasOwnProperty.call(t, k) && k.indexOf('modal.') === 0) out[k.slice(6)] = t[k];
  }
  return out;
}

function showLoginModal(opts, renderBtn) {
  var i = opts.i18n || {};
  var lang = currentModalLang();
  // Remove existing modal
  const old = document.getElementById('aimeat-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'aimeat-modal';

  // Capture typed values so they survive a re-render (language change).
  function captureInputs() {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    return { u: g('aimeat-username'), p: g('aimeat-password'), d: g('aimeat-displayname') };
  }
  function restoreInputs(vals) {
    var s = function (id, val) { var el = document.getElementById(id); if (el && val) el.value = val; };
    s('aimeat-username', vals.u); s('aimeat-password', vals.p); s('aimeat-displayname', vals.d);
  }

  // Switch language: persist the choice (same key/cookie as the header), reload
  // translations, and re-render the modal in place — no full page reload, so the
  // user stays in the modal.
  function switchLang(next) {
    if (next === lang) return;
    try {
      localStorage.setItem(MODAL_LANG_KEY, next);
      document.cookie = 'aimeat-lang=' + next + ';path=/;max-age=31536000;SameSite=Lax';
    } catch (e) {}
    var vals = captureInputs();
    loadModalI18n(next).then(function (fresh) {
      lang = next;
      if (fresh && Object.keys(fresh).length) i = fresh;
      render(false);
      restoreInputs(vals);
    });
  }

  function render(anim) {
    modal.innerHTML = buildModalInner(i, lang, anim);
    wireModal();
  }

  document.body.appendChild(modal);
  render(true);

  // The host page passed opts.i18n in whatever language it had loaded. When the
  // modal is shown standalone that can be the wrong language; correct it to the
  // stored/preferred language by loading fresh translations and re-rendering
  // (only if they actually differ, to avoid a needless flicker).
  loadModalI18n(lang).then(function (fresh) {
    if (!fresh || !Object.keys(fresh).length) return;
    if (fresh.signInBtn === i.signInBtn && fresh.descNew === i.descNew) return;
    var vals = captureInputs();
    i = fresh;
    render(false);
    restoreInputs(vals);
  });

  function buildModalInner(i, lang, anim) {
   return '<style>'
    + '.aimeat-inp{width:100%;padding:11px 14px;border:1.5px solid #E5E7EB;border-radius:10px;font-family:DM Sans,system-ui,sans-serif;font-size:15px;color:#1A1A2E;background:#FAFAF8;box-sizing:border-box;transition:all .15s;outline:none}'
    + '.aimeat-inp:focus{border-color:#E8564A;box-shadow:0 0 0 3px rgba(232,86,74,.1)}'
    + '.aimeat-inp::placeholder{color:#9CA3AF}'
    + '.aimeat-go{flex:1;padding:12px;background:linear-gradient(135deg,#E8564A,#D4493F);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:15px;font-family:DM Sans,system-ui,sans-serif;box-shadow:0 2px 8px rgba(232,86,74,.25);transition:transform .15s,box-shadow .15s}'
    + '.aimeat-go:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(232,86,74,.35)}'
    + '.aimeat-label{display:block;margin-bottom:5px;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#6B7280}'
    + '.aimeat-cancel{padding:12px 20px;background:none;color:#1A1A2E;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer;font-size:15px;font-weight:500;font-family:DM Sans,system-ui,sans-serif;transition:background .15s}'
    + '.aimeat-cancel:hover{background:#F3F4F6}'
    + '.aimeat-fi{width:20px;height:20px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;margin-top:1px}'
    + '.aimeat-langsw{position:absolute;top:24px;right:28px;display:flex;gap:5px}'
    + '.aimeat-lang{padding:4px 9px;border:1px solid #E5E7EB;background:#fff;color:#6B7280;border-radius:7px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:.4px;line-height:1;font-family:DM Sans,system-ui,sans-serif;transition:all .15s}'
    + '.aimeat-lang:hover{border-color:#E8564A;color:#E8564A}'
    + '.aimeat-lang.active{background:#E8564A;color:#fff;border-color:#E8564A;cursor:default}'
    + '@keyframes aimeatModalIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}'
    + '</style>'
    + '<div style="position:fixed;inset:0;background:rgba(26,26,46,.4);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:DM Sans,system-ui,sans-serif;padding:24px">'
    + '<div style="background:#FFFFFF;border-radius:16px;max-width:420px;width:100%;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.15),0 0 0 1px rgba(0,0,0,.05);' + (anim ? 'animation:aimeatModalIn .3s ease' : '') + '">'
    // Header
    + '<div style="padding:28px 32px 0;position:relative">'
    + '<div class="aimeat-langsw">'
    + '<button type="button" class="aimeat-lang' + (lang === 'en' ? ' active' : '') + '" data-lang="en">EN</button>'
    + '<button type="button" class="aimeat-lang' + (lang === 'fi' ? ' active' : '') + '" data-lang="fi">FI</button>'
    + '</div>'
    + '<h2 style="margin:0;font-size:22px;font-weight:800;display:flex;align-items:center;gap:8px;color:#1A1A2E">'
    + 'AIME <span style="width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,#E8564A,#D4493F);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:14px">\\u2665</span> AT Sign In'
    + '</h2>'
    + '<p style="margin:8px 0 0;font-size:14px;color:#6B7280;line-height:1.5">' + escHtml(i.descNew || 'New? Pick a username and password to create an account.') + ' ' + escHtml(i.descReturning || 'Already have an account? Enter your username and password.') + '</p>'
    + '</div>'
    // Body
    + '<div id="aimeat-modal-body" style="padding:24px 32px">'
    + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.usernameLabel || 'Username') + '</label>'
    + '<input id="aimeat-username" class="aimeat-inp" placeholder="' + escHtml(i.usernamePlaceholder || 'Username') + '"></div>'
    + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.passwordLabel || 'Password') + '</label>'
    + '<input id="aimeat-password" type="password" class="aimeat-inp" placeholder="' + escHtml(i.passwordPlaceholder || 'Password (min 4 chars)') + '"></div>'
    + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.displayNameLabel || 'Display Name') + ' <span style="font-weight:400;text-transform:none;letter-spacing:0">(' + escHtml(i.displayNameHint || 'optional, for new accounts') + ')</span></label>'
    + '<input id="aimeat-displayname" class="aimeat-inp" placeholder="' + escHtml(i.displayNamePlaceholder || 'Display Name') + '"></div>'
    + '<div style="display:flex;gap:10px;margin-top:20px">'
    + '<button id="aimeat-go-btn" class="aimeat-go">' + escHtml(i.signInBtn || 'Sign In / Register') + '</button>'
    + '<button id="aimeat-cancel-btn" class="aimeat-cancel">' + escHtml(i.cancelBtn || 'Cancel') + '</button>'
    + '</div>'
    + '<p id="aimeat-error" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p>'
    // Social login (Google) — only shown when the node has Google sign-in configured
    + (GOOGLE_LOGIN_ENABLED ? (
        '<div style="display:flex;align-items:center;gap:12px;margin:18px 0 14px;color:#9CA3AF;font-size:12px;font-weight:600;letter-spacing:.5px">'
        + '<span style="flex:1;height:1px;background:#E5E7EB"></span>' + escHtml(i.orLabel || 'OR') + '<span style="flex:1;height:1px;background:#E5E7EB"></span>'
        + '</div>'
        + '<button id="aimeat-google-btn" type="button" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;padding:11px;background:#fff;color:#1A1A2E;border:1.5px solid #E5E7EB;border-radius:10px;cursor:pointer;font-weight:600;font-size:15px;font-family:DM Sans,system-ui,sans-serif;transition:background .15s,border-color .15s">'
        + '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>'
        + escHtml(i.googleSignIn || 'Continue with Google') + '</button>'
      ) : '')
    + '<div style="margin-top:14px;display:flex;gap:16px">'
    + '<a href="#" id="aimeat-forgot-pw" style="font-size:13px;color:#6B7280;cursor:pointer;text-decoration:underline">' + escHtml(i.forgotPassword || 'Forgot password?') + '</a>'
    + '<a href="#" id="aimeat-forgot-user" style="font-size:13px;color:#6B7280;cursor:pointer;text-decoration:underline">' + escHtml(i.forgotUsername || 'Forgot username?') + '</a>'
    + '</div>'
    + '</div>'
    // Forgot password sub-view (hidden by default)
    + '<div id="aimeat-forgot-pw-view" style="padding:24px 32px;display:none">'
    + '<div id="aimeat-fpw-step1">'
    + '<h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i.resetPasswordTitle || 'Reset Password') + '</h3>'
    + '<p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i.resetPasswordDesc || 'Enter your username to receive a reset code by email.') + '</p>'
    + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.usernameLabel || 'Username') + '</label>'
    + '<input id="aimeat-fpw-username" class="aimeat-inp" placeholder="' + escHtml(i.usernamePlaceholder || 'Username') + '"></div>'
    + '<div style="display:flex;gap:10px">'
    + '<button id="aimeat-fpw-send" class="aimeat-go">' + escHtml(i.sendResetCode || 'Send Reset Code') + '</button>'
    + '<button id="aimeat-fpw-back" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
    + '</div>'
    + '<p id="aimeat-fpw-msg" style="margin:8px 0 0;font-size:13px;color:#22C55E;display:none"></p>'
    + '<p id="aimeat-fpw-err" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p>'
    + '</div>'
    + '<div id="aimeat-fpw-step2" style="display:none">'
    + '<h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i.enterNewPasswordTitle || 'Enter New Password') + '</h3>'
    + '<p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i.resetCodeSent || 'A reset code was sent to your email. Enter it below with your new password.') + '</p>'
    + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.codeLabel || 'Reset Code') + '</label>'
    + '<input id="aimeat-fpw-code" class="aimeat-inp" placeholder="123456" maxlength="6"></div>'
    + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.newPasswordLabel || 'New Password') + '</label>'
    + '<input id="aimeat-fpw-newpass" type="password" class="aimeat-inp" placeholder="' + escHtml(i.newPasswordPlaceholder || 'New password (min 8 chars)') + '"></div>'
    + '<div style="display:flex;gap:10px">'
    + '<button id="aimeat-fpw-reset" class="aimeat-go">' + escHtml(i.resetPassword || 'Reset Password') + '</button>'
    + '<button id="aimeat-fpw-back2" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
    + '</div>'
    + '<p id="aimeat-fpw-msg2" style="margin:8px 0 0;font-size:13px;color:#22C55E;display:none"></p>'
    + '<p id="aimeat-fpw-err2" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p>'
    + '</div>'
    + '</div>'
    // Forgot username sub-view (hidden by default)
    + '<div id="aimeat-forgot-user-view" style="padding:24px 32px;display:none">'
    + '<h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i.recoverUsernameTitle || 'Recover Username') + '</h3>'
    + '<p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i.recoverUsernameDesc || 'Enter the email address associated with your account.') + '</p>'
    + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.emailLabel || 'Email') + '</label>'
    + '<input id="aimeat-fu-email" class="aimeat-inp" type="email" placeholder="you@example.com"></div>'
    + '<div style="display:flex;gap:10px">'
    + '<button id="aimeat-fu-send" class="aimeat-go">' + escHtml(i.sendUsername || 'Send My Username') + '</button>'
    + '<button id="aimeat-fu-back" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
    + '</div>'
    + '<p id="aimeat-fu-msg" style="margin:8px 0 0;font-size:13px;color:#22C55E;display:none"></p>'
    + '</div>'
    // Features footer
    + '<div style="padding:20px 32px 28px;background:#F9FAFB;border-top:1px solid #E5E7EB">'
    + '<h4 style="margin:0 0 12px;font-size:13px;font-weight:700;color:#1A1A2E;display:flex;align-items:center;gap:6px">\\u2728 ' + escHtml(i.whyTitle || 'What do you get?') + '</h4>'
    + '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;margin-bottom:8px;line-height:1.45"><div class="aimeat-fi" style="background:#FFF1F0;color:#E8564A">\\u2665</div><span>' + escHtml(i.whyGhii || 'A free GHII (Global Human Intelligence Identifier), your personal AI identity') + '</span></div>'
    + '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;margin-bottom:8px;line-height:1.45"><div class="aimeat-fi" style="background:#EFF6FF;color:#3B82F6">\\ud83d\\udd12</div><span>' + escHtml(i.whyPrivacy || 'Your own private memory space, protected by your password') + '</span></div>'
    + '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;margin-bottom:8px;line-height:1.45"><div class="aimeat-fi" style="background:#F0FDF4;color:#22C55E">\\ud83e\\udd16</div><span>' + escHtml(i.whyAgents || 'Connect AI agents that remember you and work on your behalf') + '</span></div>'
    + '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;line-height:1.45"><div class="aimeat-fi" style="background:#FFF1F0;color:#E8564A">\\u2665</div><span><strong>' + escHtml(i.whyMorsels || '100 free heart morsels to start! E.g. memory request ~ 1, board post ~ 2. You get 50 more every day') + '</strong></span></div>'
    + '</div>'
    + '</div></div>';
  } // end buildModalInner

  function wireModal() {

  // Language switcher (EN/FI) — persists choice + re-renders the modal in place
  modal.querySelectorAll('.aimeat-lang').forEach(function(b) {
    b.addEventListener('click', function() { switchLang(b.getAttribute('data-lang')); });
  });

  document.getElementById('aimeat-cancel-btn').addEventListener('click', () => modal.remove());

  // Google sign-in — full-page navigation to the OIDC start endpoint. The node sets a
  // refresh cookie on callback and redirects back; the SPA then boots logged-in.
  var googleBtn = document.getElementById('aimeat-google-btn');
  if (googleBtn) {
    googleBtn.addEventListener('click', function() {
      var back = encodeURIComponent(location.pathname + location.search + location.hash);
      location.href = NODE_URL + '/v1/ghii/login/google?redirect=' + back;
    });
  }

  // Helper to toggle between views
  function showView(view) {
    document.getElementById('aimeat-modal-body').style.display = view === 'login' ? '' : 'none';
    document.getElementById('aimeat-forgot-pw-view').style.display = view === 'forgot-pw' ? '' : 'none';
    document.getElementById('aimeat-forgot-user-view').style.display = view === 'forgot-user' ? '' : 'none';
  }

  // Forgot password link
  document.getElementById('aimeat-forgot-pw').addEventListener('click', function(e) {
    e.preventDefault();
    showView('forgot-pw');
    document.getElementById('aimeat-fpw-step1').style.display = '';
    document.getElementById('aimeat-fpw-step2').style.display = 'none';
  });

  // Forgot username link
  document.getElementById('aimeat-forgot-user').addEventListener('click', function(e) {
    e.preventDefault();
    showView('forgot-user');
  });

  // Back to login buttons
  ['aimeat-fpw-back', 'aimeat-fpw-back2', 'aimeat-fu-back'].forEach(function(id) {
    document.getElementById(id).addEventListener('click', function() { showView('login'); });
  });

  // Send password reset code
  document.getElementById('aimeat-fpw-send').addEventListener('click', async function() {
    var username = document.getElementById('aimeat-fpw-username').value.trim().toLowerCase();
    var msgEl = document.getElementById('aimeat-fpw-msg');
    var errEl = document.getElementById('aimeat-fpw-err');
    msgEl.style.display = 'none';
    errEl.style.display = 'none';
    if (!username) { errEl.textContent = i.errUserShort || 'Username is required'; errEl.style.display = 'block'; return; }
    try {
      await api('/v1/ghii/password/reset-request', { method: 'POST', body: JSON.stringify({ username: username }) });
      msgEl.textContent = i.resetCodeSent || 'If your account has a verified email, a reset code was sent.';
      msgEl.style.display = 'block';
      document.getElementById('aimeat-fpw-step1').style.display = 'none';
      document.getElementById('aimeat-fpw-step2').style.display = '';
      // Pre-fill the username for the reset step
      window.__aimeatResetUser = username;
    } catch(e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
    }
  });

  // Reset password with code
  document.getElementById('aimeat-fpw-reset').addEventListener('click', async function() {
    var code = document.getElementById('aimeat-fpw-code').value.trim();
    var newPass = document.getElementById('aimeat-fpw-newpass').value;
    var msgEl = document.getElementById('aimeat-fpw-msg2');
    var errEl = document.getElementById('aimeat-fpw-err2');
    msgEl.style.display = 'none';
    errEl.style.display = 'none';
    if (!code) { errEl.textContent = 'Code is required'; errEl.style.display = 'block'; return; }
    if (!newPass || newPass.length < 8) { errEl.textContent = i.errPassWeak || 'Password must be at least 8 characters'; errEl.style.display = 'block'; return; }
    try {
      await api('/v1/ghii/password/reset', { method: 'POST', body: JSON.stringify({
        username: window.__aimeatResetUser || '',
        code: code,
        newPassword: newPass
      }) });
      msgEl.textContent = i.resetSuccess || 'Password reset successful! You can now sign in.';
      msgEl.style.display = 'block';
      setTimeout(function() { showView('login'); }, 2000);
    } catch(e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
    }
  });

  // Send username recovery
  document.getElementById('aimeat-fu-send').addEventListener('click', async function() {
    var email = document.getElementById('aimeat-fu-email').value.trim();
    var msgEl = document.getElementById('aimeat-fu-msg');
    msgEl.style.display = 'none';
    if (!email) return;
    try {
      await api('/v1/ghii/account/recover', { method: 'POST', body: JSON.stringify({ email: email }) });
    } catch(_) { /* always show success */ }
    msgEl.textContent = i.usernameSent || 'If an account with that email exists, your username was sent.';
    msgEl.style.display = 'block';
  });

  // Enter in any of the sign-in fields submits (unless the button is mid-request/disabled).
  ['aimeat-username', 'aimeat-password', 'aimeat-displayname'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var btn = document.getElementById('aimeat-go-btn');
      if (btn && !btn.disabled) btn.click();
    });
  });

  document.getElementById('aimeat-go-btn').addEventListener('click', async () => {
    let username = document.getElementById('aimeat-username').value.trim().toLowerCase();
    const password = document.getElementById('aimeat-password').value;
    const errEl = document.getElementById('aimeat-error');

    // Accept full GHII (e.g. "alice@node-id") -- detect local vs federated
    let isGhii = false;
    let isFederated = false;
    let fullUsername = username;
    if (username.includes('@')) {
      const atIdx = username.indexOf('@');
      const nodePart = username.substring(atIdx + 1);
      if (nodePart && nodePart !== NODE_ID) {
        // Federated login -- keep full username@node-id for the server
        isFederated = true;
        isGhii = true;
      } else {
        // Local GHII -- strip the @node-id
        username = username.substring(0, atIdx);
        isGhii = true;
      }
    }

    const displayName = document.getElementById('aimeat-displayname').value.trim() || username;

    if (!username || username.length < 3) {
      errEl.textContent = i.errUserShort || 'Username must be at least 3 characters';
      errEl.style.display = 'block';
      return;
    }

    if (!password || password.length < 4) {
      errEl.textContent = i.errPassShort || 'Password must be at least 4 characters';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('aimeat-go-btn');
    btn.textContent = i.working || 'Working...';
    btn.disabled = true;

    // If input was a full GHII, skip register and go straight to login
    if (isGhii) {
      try {
        if (isFederated) {
          btn.textContent = i.connectingHome || 'Connecting to home node...';
        }
        const loginUser = isFederated ? fullUsername : username;
        const session = await auth.loginWithPassword(loginUser, password);
        modal.remove();
        renderBtn();
        if (opts.onLogin) opts.onLogin(session);
      } catch(e2) {
        errEl.textContent = e2.message.includes('Invalid username or password')
          ? (i.errWrongPass || 'Wrong password for that username.')
          : e2.message;
        errEl.style.display = 'block';
        btn.textContent = i.signInBtn || 'Sign In / Register';
        btn.disabled = false;
      }
      return;
    }

    try {
      // Try registering first (new account)
      const session = await auth.register(username, displayName, { password });
      modal.remove();
      renderBtn();
      if (opts.onLogin) opts.onLogin(session);
    } catch(e) {
      // If NAME_TAKEN, try logging in with password
      if (e.message.includes('already registered') || e.message.includes('NAME_TAKEN')) {
        try {
          const session = await auth.loginWithPassword(username, password);
          modal.remove();
          renderBtn();
          if (opts.onLogin) opts.onLogin(session);
        } catch(e2) {
          errEl.textContent = e2.message.includes('Invalid username or password')
            ? (i.errWrongPass || 'Wrong password for that username.')
            : e2.message;
          errEl.style.display = 'block';
          btn.textContent = i.signInBtn || 'Sign In';
          btn.disabled = false;
        }
      } else {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
        btn.textContent = i.signInBtn || 'Sign In / Register';
        btn.disabled = false;
      }
    }
  });

  } // end wireModal
}

// ── Refresh on focus / visibility ──
// The auto-refresh setTimeout fires 5 min before expiry, but timers do NOT fire
// while the machine is asleep or the tab is frozen/discarded by the browser. So
// after the user steps away and returns, the proactive refresh never happened and
// the JWT may already be expired. Re-check the token whenever the tab regains
// visibility or focus, and refresh if it is within the 5-min window (or expired).
let focusRefreshInFlight = null;
function refreshOnFocus() {
  const session = currentSession;
  // Federated sessions cannot self-refresh by signing — leave them to re-login.
  if (!session || !session.jwt || session.federated) return;
  const payload = parseJwt(session.jwt);
  if (!payload || !payload.exp) return;
  const msUntilExpiry = (payload.exp * 1000) - Date.now();
  if (msUntilExpiry > 5 * 60 * 1000) return; // still comfortably valid
  if (focusRefreshInFlight) return; // focus + visibilitychange can both fire — de-dupe
  const wasExpired = msUntilExpiry <= 0;
  focusRefreshInFlight = session.refresh()
    .then(() => { emit('refreshed', session); })
    .catch((e) => {
      console.warn('[aimeat-auth] Focus refresh failed:', e.message);
      // Only declare the session dead if the token had actually expired. A
      // transient failure while still inside the pre-expiry window can be
      // retried by the scheduled timer or the next API call.
      if (wasExpired) emit('expired', { reason: 'refresh_failed', error: e.message });
    })
    .finally(() => { focusRefreshInFlight = null; });
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnFocus();
  });
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('focus', refreshOnFocus);
}

// ── Expose globally ──
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.auth = auth;
global.AIMEAT.version = '2026-06-03-003';

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
