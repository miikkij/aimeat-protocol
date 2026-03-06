import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { aimeatDataLib } from './lib-data.js';
import { aimeatStorageLib } from './lib-storage.js';
import { aimeatSocialLib } from './lib-social.js';
import { aimeatWalletLib } from './lib-wallet.js';
import { aimeatWorkLib } from './lib-work.js';
import { aimeatTunnelLib } from './lib-tunnel.js';

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
      ],
    });
  });

  // GET /v1/libs/test-harness — HTML page that loads all libraries (dev mode only)
  if (config.devMode) {
    router.get('/v1/libs/test-harness', (_req, res) => {
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
</head>
<body>
<h1 id="title">AIMEAT Test Harness</h1>
<pre id="log"></pre>
<script>
window.__testLog = [];
window.tlog = function(msg) {
  window.__testLog.push(msg);
  document.getElementById('log').textContent = window.__testLog.join('\\n');
};
window.tlog('Libraries loaded: auth=' + !!AIMEAT.auth + ' data=' + !!AIMEAT.data + ' storage=' + !!AIMEAT.storage + ' social=' + !!AIMEAT.social + ' wallet=' + !!AIMEAT.wallet + ' work=' + !!AIMEAT.work + ' tunnel=' + !!AIMEAT.tunnel);
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

async function sign(privateKeyB64, message) {
  const privBytes = Uint8Array.from(atob(privateKeyB64), c => c.charCodeAt(0));
  // Build PKCS8 DER wrapper for Ed25519
  const pkcs8Prefix = new Uint8Array([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]);
  const pkcs8 = new Uint8Array(pkcs8Prefix.length + privBytes.length);
  pkcs8.set(pkcs8Prefix);
  pkcs8.set(privBytes, pkcs8Prefix.length);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, 'Ed25519', false, ['sign']);
  const msgBytes = new TextEncoder().encode(message);
  const sigBytes = await crypto.subtle.sign('Ed25519', key, msgBytes);
  return btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
}

// ── Storage helpers ──

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

function createSession(data) {
  const session = {
    ghii: data.ghii || null,
    owner: data.owner,
    gaii: data.gaii || null,
    jwt: data.jwt,
    privateKey: data.privateKey,
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

    // Re-authenticate
    async refresh() {
      if (!session.gaii || !session.privateKey) throw new Error('Cannot refresh — no agent credentials');
      const timestamp = new Date().toISOString();
      const message = session.gaii + timestamp;
      const signature = await sign(session.privateKey, message);
      const data = await api('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: session.gaii, timestamp, signature }),
      });
      session.jwt = data.data.token;
      save('session', {
        owner: session.owner, gaii: session.gaii, ghii: session.ghii,
        jwt: session.jwt, privateKey: session.privateKey, publicKey: session.publicKey,
      });
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
    const keyPair = await generateKeyPair();

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

    // Get an owner JWT first (required to register agents)
    const ownerTimestamp = new Date().toISOString();
    const ownerMessage = ownerName + NODE_ID + ownerTimestamp;
    const ownerSig = await sign(serverPrivateKey, ownerMessage);
    const ownerTokenData = await api('/v1/auth/token', {
      method: 'POST',
      body: JSON.stringify({ owner: ownerName, timestamp: ownerTimestamp, signature: ownerSig }),
    });
    const ownerJwt = ownerTokenData.data.token;

    // Register a default agent (using owner JWT)
    const agentData = await authApi('/v1/agents', ownerJwt, {
      method: 'POST',
      body: JSON.stringify({
        name: 'app',
        owner: ownerName,
        display_name: displayName + '\\'s App Agent',
        description: 'Default agent for AIMEAT apps',
      }),
    });

    const agentGaii = agentData.data.agent.gaii;
    const agentPrivateKey = agentData.data.private_key;

    // Authenticate as agent to get agent JWT
    const timestamp = new Date().toISOString();
    const message = agentGaii + timestamp;
    const signature = await sign(agentPrivateKey, message);

    const tokenData = await api('/v1/auth/token', {
      method: 'POST',
      body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });

    const session = createSession({
      ghii, owner: ownerName, gaii: agentGaii,
      jwt: tokenData.data.token,
      privateKey: agentPrivateKey, publicKey: agentData.data.public_key,
    });

    // Persist
    save('session', {
      owner: ownerName, gaii: agentGaii, ghii,
      jwt: session.jwt, privateKey: agentPrivateKey, publicKey: agentData.data.public_key,
    });
    save('owner_key', serverPrivateKey);

    currentSession = session;
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

    const session = createSession(stored);

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
    const session = createSession({
      ghii: d.ghii.ghii,
      owner: d.owner.name,
      gaii: d.agent.gaii,
      jwt: d.token,
      privateKey: d.agent_private_key,
      publicKey: '',
    });

    save('session', {
      owner: d.owner.name, gaii: d.agent.gaii, ghii: d.ghii.ghii,
      jwt: d.token, privateKey: d.agent_private_key, publicKey: '',
    });
    save('owner_key', d.owner_private_key);

    currentSession = session;
    emit('login', session);
    return session;
  },

  /** Get the current session (or null if not logged in) */
  getSession() {
    return currentSession;
  },

  /** Logout — clear stored credentials */
  logout() {
    currentSession = null;
    remove('session');
    remove('owner_key');
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
  modal.innerHTML = '<style>.aimeat-inp:focus{border-color:#c44569 !important}.aimeat-go{flex:1;padding:10px;background:linear-gradient(135deg,#e8457a,#c44569);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:14px;letter-spacing:.3px;box-shadow:0 2px 8px rgba(196,69,105,.3);transition:transform .15s,box-shadow .15s}.aimeat-go:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(196,69,105,.4)}</style>'
    + '<div style="position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:system-ui">'
    + '<div style="background:#1e293b;border:1px solid #334155;border-radius:14px;padding:24px;max-width:400px;width:90%;color:#e2e8f0;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4)">'
    + '<h3 style="margin:0 0 16px;font-size:18px;color:#f0e6f6">' + escHtml(i.title || '\\u2764\\ufe0f AIMEAT Sign In') + '</h3>'
    + '<div id="aimeat-modal-body">'
    + '<p style="margin:0 0 4px;font-size:13px;color:#94a3b8">' + escHtml(i.descNew || 'New? Pick a username and password to create an account.') + '</p>'
    + '<p style="margin:0 0 12px;font-size:13px;color:#94a3b8">' + escHtml(i.descReturning || 'Already have an account? Enter your username and password.') + '</p>'
    + '<input id="aimeat-username" class="aimeat-inp" placeholder="' + escHtml(i.usernamePlaceholder || 'Username') + '" style="width:100%;padding:8px 12px;background:#0f172a;border:1px solid #475569;border-radius:8px;color:#e2e8f0;font-size:14px;margin-bottom:8px;box-sizing:border-box;transition:border-color .2s">'
    + '<input id="aimeat-password" type="password" class="aimeat-inp" placeholder="' + escHtml(i.passwordPlaceholder || 'Password (min 4 chars)') + '" style="width:100%;padding:8px 12px;background:#0f172a;border:1px solid #475569;border-radius:8px;color:#e2e8f0;font-size:14px;margin-bottom:8px;box-sizing:border-box;transition:border-color .2s">'
    + '<input id="aimeat-displayname" class="aimeat-inp" placeholder="' + escHtml(i.displayNamePlaceholder || 'Display Name (optional, for new accounts)') + '" style="width:100%;padding:8px 12px;background:#0f172a;border:1px solid #475569;border-radius:8px;color:#e2e8f0;font-size:14px;margin-bottom:12px;box-sizing:border-box;transition:border-color .2s">'
    + '<div style="display:flex;gap:8px">'
    + '<button id="aimeat-go-btn" class="aimeat-go">' + escHtml(i.signInBtn || 'Sign In') + '</button>'
    + '<button id="aimeat-cancel-btn" style="padding:8px 12px;background:#334155;color:#e2e8f0;border:none;border-radius:8px;cursor:pointer;font-size:14px">' + escHtml(i.cancelBtn || 'Cancel') + '</button>'
    + '</div>'
    + '<p id="aimeat-error" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p>'
    + '<div style="margin-top:14px;padding-top:12px;border-top:1px solid #334155">'
    + '<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#e2e8f0">' + escHtml(i.whyTitle || '\\u2728 What do you get?') + '</p>'
    + '<ul style="margin:0;padding:0 0 0 18px;font-size:12px;color:#94a3b8;line-height:1.8;list-style:none">'
    + '<li>\\u2764\\ufe0f ' + escHtml(i.whyGhii || 'A free GHII (Global Human Intelligence Identifier), your personal AI identity') + '</li>'
    + '<li>\\ud83d\\udd12 ' + escHtml(i.whyPrivacy || 'Your own private memory space, protected by your password') + '</li>'
    + '<li>\\ud83d\\udee1 ' + escHtml(i.whyControl || 'Full control: only you can access your data, no need to share with anyone') + '</li>'
    + '<li>\\ud83e\\udd16 ' + escHtml(i.whyAgents || 'Connect AI agents that remember you and work on your behalf') + '</li>'
    + '<li>\\ud83d\\udc96 ' + escHtml(i.whyMorsels || '100 free heart morsels to start! E.g. memory request ~ 1, board post ~ 2. You get 50 more every day') + '</li>'
    + '</ul></div>'
    + '</div></div></div>';
  document.body.appendChild(modal);

  document.getElementById('aimeat-cancel-btn').addEventListener('click', () => modal.remove());
  modal.querySelector('div').addEventListener('click', (e) => { if (e.target === modal.querySelector('div')) modal.remove(); });

  document.getElementById('aimeat-go-btn').addEventListener('click', async () => {
    const username = document.getElementById('aimeat-username').value.trim().toLowerCase();
    const password = document.getElementById('aimeat-password').value;
    const displayName = document.getElementById('aimeat-displayname').value.trim() || username;
    const errEl = document.getElementById('aimeat-error');

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
