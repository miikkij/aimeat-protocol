/**
 * @file auth/crypto.js
 * @description aimeat-auth crypto + storage core (SDK-libs migration Phase 3). Self-contained, no
 *   shared auth state: Ed25519 via Web Crypto (generate/import-as-non-extractable/sign), the
 *   IndexedDB non-extractable CryptoKey store (open/store/load/delete + one-time localStorage→IDB
 *   migration), the localStorage metadata helpers (save/load/remove — NEVER private keys), and JWT
 *   helpers (parseJwt/isExpired). Extracted verbatim from auth-lib-part1.ts.
 * @structure generateKeyPair/importEd25519Key/isCryptoKey/sign · openKeyDB/storeKey/loadKey/deleteKey/
 *   migrateKeysToIndexedDB · save/load/remove · parseJwt/isExpired.
 * @usage import { sign, parseJwt, save, load } from './crypto.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — Extracted from src/routes/libs/auth-lib-part1.ts (SDK-libs migration Phase 3).
 */

// ── Ed25519 via Web Crypto ──

export async function generateKeyPair() {
  const key = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']));
  const privRaw = await crypto.subtle.exportKey('pkcs8', key.privateKey);
  const pubRaw = await crypto.subtle.exportKey('spki', key.publicKey);
  // Extract raw 32-byte keys from DER wrappers
  const privBytes = new Uint8Array(privRaw).slice(-32);
  const pubBytes = new Uint8Array(pubRaw).slice(-32);
  return {
    privateKey: btoa(String.fromCharCode(...privBytes)),
    publicKey: btoa(String.fromCharCode(...pubBytes)),
    cryptoKey: key,
  };
}

// SECURITY: Import raw Ed25519 private key as non-extractable CryptoKey
export async function importEd25519Key(privateKeyBase64) {
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

export function isCryptoKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof CryptoKey !== 'undefined' && value instanceof CryptoKey) return true;
  return Object.prototype.toString.call(value) === '[object CryptoKey]';
}

// Sign using CryptoKey (preferred) or base64 key string (fallback)
export async function sign(keyOrB64, message) {
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

export async function storeKey(name, cryptoKey) {
  const db = /** @type {IDBDatabase} */ (await openKeyDB());
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
    tx.objectStore(KEY_STORE_NAME).put(cryptoKey, name);
    tx.oncomplete = () => { db.close(); resolve(undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function loadKey(name) {
  const db = /** @type {IDBDatabase} */ (await openKeyDB());
  return new Promise((resolve) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readonly');
    const req = tx.objectStore(KEY_STORE_NAME).get(name);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); resolve(null); };
  });
}

export async function deleteKey(name) {
  try {
    const db = /** @type {IDBDatabase} */ (await openKeyDB());
    return new Promise((resolve) => {
      const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
      tx.objectStore(KEY_STORE_NAME).delete(name);
      tx.oncomplete = () => { db.close(); resolve(undefined); };
      tx.onerror = () => { db.close(); resolve(undefined); };
    });
  } catch { /* IndexedDB may not be available */ }
}

// Migrate legacy localStorage keys to IndexedDB (one-time)
export async function migrateKeysToIndexedDB() {
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
  } catch (e) {
    console.warn('AIMEAT: Key migration to IndexedDB failed, falling back to localStorage', e);
  }
}

// ── Storage helpers (metadata only — NO private keys) ──

const STORAGE_PREFIX = 'aimeat_';

export function save(key, value) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

export function load(key) {
  try { const v = localStorage.getItem(STORAGE_PREFIX + key); return v ? JSON.parse(v) : null; } catch { return null; }
}

export function remove(key) {
  try { localStorage.removeItem(STORAGE_PREFIX + key); } catch { /* storage blocked */ }
}

// ── JWT helpers ──

export function parseJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload;
  } catch { return null; }
}

export function isExpired(jwt) {
  const payload = parseJwt(jwt);
  if (!payload || !payload.exp) return true;
  return Date.now() / 1000 > payload.exp - 60; // 60s grace
}
