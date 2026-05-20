import { Router } from 'express';
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

/**
 * Serves helper JavaScript libraries at /v1/libs/*
 * These are self-contained scripts that AI-generated apps include via <script> tag.
 * The app files are served from the AIMEAT node itself — zero CORS issues.
 */
export function libsRouter(config: AimeatConfig, _storage: Storage): Router {
  const router = Router();

  // GET /v1/libs/aimeat-auth.js — Auth helper library
  router.get('/v1/libs/aimeat-auth.js', (_req, res) => {
    res.type('application/javascript').send(aimeatAuthLib(config));
  });

  // GET /v1/libs/aimeat-data.js — Memory & Micro-Memory library
  router.get('/v1/libs/aimeat-data.js', (_req, res) => {
    res.type('application/javascript').send(aimeatDataLib(config));
  });

  // GET /v1/libs/aimeat-storage.js — File storage library
  router.get('/v1/libs/aimeat-storage.js', (_req, res) => {
    res.type('application/javascript').send(aimeatStorageLib(config));
  });

  // GET /v1/libs/aimeat-social.js — Boards & social library
  router.get('/v1/libs/aimeat-social.js', (_req, res) => {
    res.type('application/javascript').send(aimeatSocialLib(config));
  });

  // GET /v1/libs/aimeat-wallet.js — Wallet library
  router.get('/v1/libs/aimeat-wallet.js', (_req, res) => {
    res.type('application/javascript').send(aimeatWalletLib(config));
  });

  // GET /v1/libs/aimeat-work.js — Actions & work exchange library
  router.get('/v1/libs/aimeat-work.js', (_req, res) => {
    res.type('application/javascript').send(aimeatWorkLib(config));
  });

  // GET /v1/libs/aimeat-tunnel.js — Personal node tunnel client
  router.get('/v1/libs/aimeat-tunnel.js', (_req, res) => {
    res.type('application/javascript').send(aimeatTunnelLib(config));
  });

  // GET /v1/libs/aimeat-audio.js — Audio engine library
  router.get('/v1/libs/aimeat-audio.js', (_req, res) => {
    res.type('application/javascript').send(aimeatAudioLib(config));
  });

  // GET /v1/libs/aimeat-speech.js — Speech library
  router.get('/v1/libs/aimeat-speech.js', (_req, res) => {
    res.type('application/javascript').send(aimeatSpeechLib(config));
  });

  // GET /v1/libs/aimeat-capabilities.js — Capability discovery, invoke, management
  router.get('/v1/libs/aimeat-capabilities.js', (_req, res) => {
    res.type('application/javascript').send(aimeatCapabilitiesLib(config));
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

const NODE_ID = '${config.nodeId}';

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

// Sign using CryptoKey (preferred) or base64 key string (fallback)
async function sign(keyOrB64, message) {
  let key = keyOrB64;
  if (typeof keyOrB64 === 'string') {
    // Legacy path: raw base64 key → import as CryptoKey
    key = await importEd25519Key(keyOrB64);
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
    jwt: data.jwt,
    roles: jwtPayload?.roles || data.roles || [],
    displayName: data.displayName || '',
    // SECURITY: Private keys are stored as non-extractable CryptoKeys in IndexedDB,
    // NOT in this session object or localStorage. Use _cryptoKey for in-memory ref only.
    _cryptoKey: data._cryptoKey || null,
    publicKey: data.publicKey,
    nodeUrl: NODE_URL,

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

    // Re-authenticate using CryptoKey from IndexedDB
    async refresh() {
      // Load CryptoKey from IndexedDB (or use in-memory ref)
      let key = session._cryptoKey;
      let body;

      if (session.gaii) {
        // Agent session refresh (for future agent-mode sessions)
        if (!key) key = await loadKey('agent_key');
        if (!key) throw new Error('Cannot refresh — no signing key found in IndexedDB');
        const timestamp = new Date().toISOString();
        const message = session.gaii + timestamp;
        const signature = await sign(key, message);
        body = { gaii: session.gaii, timestamp, signature };
      } else {
        // Owner session refresh (human user)
        if (!key) key = await loadKey('owner_key');
        if (!key) throw new Error('Cannot refresh — no signing key found in IndexedDB');
        const timestamp = new Date().toISOString();
        const message = session.owner + NODE_ID + timestamp;
        const signature = await sign(key, message);
        body = { owner: session.owner, timestamp, signature };
      }

      const data = await api('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      session.jwt = data.data.token;
      session.roles = (parseJwt(session.jwt) || {}).roles || session.roles || [];
      // SECURITY: Only save metadata to localStorage (no private keys)
      save('session', {
        owner: session.owner, gaii: session.gaii, ghii: session.ghii,
        jwt: session.jwt, publicKey: session.publicKey, roles: session.roles,
        displayName: session.displayName || '',
      });
      scheduleAutoRefresh(session);
      return session;
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
      body: JSON.stringify({
        username,
        display_name: displayName,
        bio: opts.bio,
        avatar: opts.avatar,
        locale: opts.locale,
        password: opts.password || undefined,
      }),
    });

    const ownerName = regData.data.owner.name;
    const ghii = regData.data.ghii.ghii;
    // The server generated keys — use those
    const serverPrivateKey = regData.data.private_key;
    const serverPublicKey = regData.data.public_key;

    // Get an owner JWT (human users authenticate as owners, not agents)
    const ownerTimestamp = new Date().toISOString();
    const ownerMessage = ownerName + NODE_ID + ownerTimestamp;
    const ownerSig = await sign(serverPrivateKey, ownerMessage);
    const ownerTokenData = await api('/v1/auth/token', {
      method: 'POST',
      body: JSON.stringify({ owner: ownerName, timestamp: ownerTimestamp, signature: ownerSig }),
    });

    // SECURITY: Import owner private key as non-extractable CryptoKey in IndexedDB
    const ownerCryptoKey = await importEd25519Key(serverPrivateKey);
    await storeKey('owner_key', ownerCryptoKey);

    // Owner session — agents are connected later via device auth
    const session = createSession({
      ghii, owner: ownerName, gaii: null,
      jwt: ownerTokenData.data.token,
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
    const stored = load('session');
    if (!stored) return null;
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

    if (isExpired(session.jwt)) {
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
    const data = await api('/v1/ghii/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    const d = data.data;

    // SECURITY: Import owner private key as non-extractable CryptoKey in IndexedDB
    const ownerCryptoKey = await importEd25519Key(d.owner_private_key);
    await storeKey('owner_key', ownerCryptoKey);

    // Owner session — human users authenticate as owners, not agents
    const session = createSession({
      ghii: d.ghii.ghii,
      owner: d.owner.name,
      gaii: null,
      jwt: d.token,
      _cryptoKey: ownerCryptoKey,
      publicKey: d.owner_public_key || '',
      displayName: d.ghii.display_name || '',
    });

    // SECURITY: Only save metadata to localStorage (no private keys)
    save('session', {
      owner: d.owner.name, gaii: null, ghii: d.ghii.ghii,
      jwt: d.token, publicKey: d.owner_public_key || '', roles: session.roles,
      displayName: session.displayName || '',
    });

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
        container.innerHTML = '<div style="display:inline-flex;align-items:center;gap:10px;padding:8px 18px;'
          + 'background:linear-gradient(160deg,#3d2e1a 0%,#6b4c2a 15%,#c9a84c 30%,#f5e6a3 45%,#c9a84c 55%,#8b6914 70%,#4a3520 100%);'
          + 'border:1px solid rgba(201,168,76,.6);border-top-color:rgba(245,230,163,.5);border-bottom-color:rgba(75,53,32,.8);'
          + 'border-radius:10px;'
          + 'box-shadow:0 1px 0 rgba(245,230,163,.3) inset,0 -1px 0 rgba(75,53,32,.5) inset,0 3px 10px rgba(0,0,0,.4),0 0 20px rgba(201,168,76,.15);'
          + 'font-family:system-ui;font-size:14px">'
          + '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;letter-spacing:.5px;color:#a0ffb8;text-shadow:0 0 4px rgba(0,210,80,.6),0 0 10px rgba(0,180,70,.3)">'
          + '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;'
          + 'background:radial-gradient(circle at 35% 35%,#b0ffc8,#00c853 40%,#00802e 80%,#003d15);'
          + 'box-shadow:0 0 5px rgba(0,200,83,.7),0 0 12px rgba(0,200,83,.3),inset 0 -1px 2px rgba(0,0,0,.3)"></span>'
          + escHtml(i.loggedIn || 'logged in') + '</span>'
          + '<span style="color:rgba(90,65,20,.7);font-weight:700;letter-spacing:.5px;font-size:13px;'
          + 'text-shadow:0 1px 0 rgba(245,230,163,.6),0 -1px 0 rgba(50,35,10,.3);'
          + '-webkit-text-stroke:.2px rgba(120,85,20,.3)">'
          + escHtml(stored.ghii || stored.owner) + '</span>'
          + '<button id="aimeat-logout-btn" style="'
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
  },
};

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function showLoginModal(opts, renderBtn) {
  const i = opts.i18n || {};
  // Remove existing modal
  const old = document.getElementById('aimeat-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'aimeat-modal';
  modal.innerHTML = '<style>'
    + '.aimeat-inp{width:100%;padding:11px 14px;border:1.5px solid #E5E7EB;border-radius:10px;font-family:DM Sans,system-ui,sans-serif;font-size:15px;color:#1A1A2E;background:#FAFAF8;box-sizing:border-box;transition:all .15s;outline:none}'
    + '.aimeat-inp:focus{border-color:#E8564A;box-shadow:0 0 0 3px rgba(232,86,74,.1)}'
    + '.aimeat-inp::placeholder{color:#9CA3AF}'
    + '.aimeat-go{flex:1;padding:12px;background:linear-gradient(135deg,#E8564A,#D4493F);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:15px;font-family:DM Sans,system-ui,sans-serif;box-shadow:0 2px 8px rgba(232,86,74,.25);transition:transform .15s,box-shadow .15s}'
    + '.aimeat-go:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(232,86,74,.35)}'
    + '.aimeat-label{display:block;margin-bottom:5px;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#6B7280}'
    + '.aimeat-cancel{padding:12px 20px;background:none;color:#1A1A2E;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer;font-size:15px;font-weight:500;font-family:DM Sans,system-ui,sans-serif;transition:background .15s}'
    + '.aimeat-cancel:hover{background:#F3F4F6}'
    + '.aimeat-fi{width:20px;height:20px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;margin-top:1px}'
    + '@keyframes aimeatModalIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}'
    + '</style>'
    + '<div style="position:fixed;inset:0;background:rgba(26,26,46,.4);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:DM Sans,system-ui,sans-serif;padding:24px">'
    + '<div style="background:#FFFFFF;border-radius:16px;max-width:420px;width:100%;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.15),0 0 0 1px rgba(0,0,0,.05);animation:aimeatModalIn .3s ease">'
    // Header
    + '<div style="padding:28px 32px 0">'
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
    + '<button id="aimeat-go-btn" class="aimeat-go">' + escHtml(i.signInBtn || 'Sign In') + '</button>'
    + '<button id="aimeat-cancel-btn" class="aimeat-cancel">' + escHtml(i.cancelBtn || 'Cancel') + '</button>'
    + '</div>'
    + '<p id="aimeat-error" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p>'
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
  document.body.appendChild(modal);

  document.getElementById('aimeat-cancel-btn').addEventListener('click', () => modal.remove());

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

  document.getElementById('aimeat-go-btn').addEventListener('click', async () => {
    let username = document.getElementById('aimeat-username').value.trim().toLowerCase();
    const password = document.getElementById('aimeat-password').value;
    const errEl = document.getElementById('aimeat-error');

    // Accept full GHII (e.g. "alice@node-id") -- strip @node-id for local login
    const isGhii = username.includes('@');
    if (isGhii) username = username.split('@')[0];

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
        btn.textContent = i.signInBtn || 'Sign In';
        btn.disabled = false;
      }
    }
  });
}

// ── Expose globally ──
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.auth = auth;
global.AIMEAT.version = '2026-02-27-001';

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
