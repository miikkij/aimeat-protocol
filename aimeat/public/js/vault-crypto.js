/**
 * @file public/js/vault-crypto.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description End-to-end secret shares in the browser, with WebCrypto only. The node stores what this
 *   module makes as opaque strings and cannot open any of it (services/secret-shares/service.ts
 *   e2eFill), so the format below is fixed: a change here makes every share already made unopenable.
 *
 *   THE DEVICE KEY. An ECDH P-256 key pair made in this browser with a private key that script
 *   cannot export, kept in IndexedDB (database 'aimeat-vault', store 'device-keys', key = the
 *   account's GHII). Its public key is registered with POST /v1/vault/device-keys as a JWK
 *   { kty, crv, x, y }; the node answers its key_id.
 *
 *   THE CONTENT. JSON { format, text? | content_base64?, file_name?, content_type? } sealed with a
 *   random AES-GCM-256 key K: envelope = b64url(iv 12 bytes) + '.' + b64url(ciphertext).
 *
 *   WRAPPING K FOR A DEVICE (public key P, key_id kid). An ephemeral ECDH P-256 pair E;
 *   shared = deriveBits(ECDH, E.private, P, 256); KEK = HKDF-SHA256(shared, salt empty,
 *   info 'aimeat-secret-share-v1:' + kid) as AES-GCM-256; wrapped = b64url(E.public raw, 65 bytes)
 *   + '.' + b64url(iv) + '.' + b64url(AES-GCM(KEK, raw K)).
 *
 *   THE PICKUP CODE (an end-to-end share only). Made here in the server's shape (three Finnish words
 *   without diacritics and four digits, e.g. KARHU-7215-SUMU-VALO; the list is CODE_WORDS of
 *   services/secret-shares/rules.ts). salt = 16 random bytes; bits = PBKDF2-SHA256(normalized code,
 *   salt, 310 000 iterations, 512 bits); KC = the first 32 bytes as an AES-GCM key; verifier =
 *   lowercase hex of SHA-256(the last 32 bytes). The node keeps an HMAC of the verifier, so it can
 *   check a code without being able to derive KC. The 'code' entry is b64url(iv) + '.' +
 *   b64url(AES-GCM(KC, raw K)).
 *
 *   IndexedDB is opened only when a device key is read or written, so this module imports in Node 24
 *   (test/unit/vault-crypto.test.ts), where globalThis.crypto.subtle is the same WebCrypto.
 * @structure b64url · fromB64url · normalizeCode · newPickupCode · sealContent · openContent ·
 *   wrapForDevice · unwrapWithDevice · deriveCode · wrapForCode · unwrapWithCode · newDeviceKeyPair ·
 *   deviceKeyId · loadDeviceKey · saveDeviceKey · forgetDeviceKey · deviceLabel · sealForRecipients
 * @usage import { sealForRecipients, openContent, loadDeviceKey } from '/js/vault-crypto.js';
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

const INFO_PREFIX = 'aimeat-secret-share-v1:';
const PBKDF2_ITERATIONS = 310000;
const DB_NAME = 'aimeat-vault';
const STORE = 'device-keys';

/* ── base64url ─────────────────────────────────────────────────────────────────────────────── */

/** Bytes (Uint8Array or ArrayBuffer) as base64url without padding. */
export function b64url(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url (or standard base64) as bytes. */
export function fromB64url(text) {
  const s = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/* ── The pickup code ──────────────────────────────────────────────────────────────────────── */

/** The server's word list (services/secret-shares/rules.ts CODE_WORDS), in the same order. */
const CODE_WORDS = [
  'KARHU', 'SUMU', 'VALO', 'KIVI', 'TUULI', 'LUMI', 'META', 'PILVI', 'RANTA', 'SAARI', 'TAIVAS', 'KUU',
  'TAHTI', 'METSA', 'JOKI', 'SILTA', 'LAIVA', 'OMENA', 'KETTU', 'HAUKI', 'KORPI', 'NIITTY', 'PURO', 'VUORI',
  'AALTO', 'KALLIO', 'SATAMA', 'TORNI', 'PORTTI', 'KIRJA', 'SAVU', 'TULI', 'JAA', 'HELMI', 'KULTA', 'HOPEA',
  'RAUTA', 'NUOLI', 'KAARNA', 'KANTO', 'LAAKSO', 'SADE', 'ROUTA', 'KESA', 'SYKSY', 'TALVI', 'KEVAT', 'AAMU',
  'ILTA', 'YO', 'PAIVA', 'HAVU', 'KOIVU', 'MANTY', 'KUUSI', 'TAMMI', 'VAHTERA', 'PAJU', 'LEPPA', 'HAAPA',
  'LOHI', 'SIIKA', 'AHVEN', 'KUHA',
];

/** A uniform whole number below `n`, by rejection sampling over 32 random bits. */
function randomBelow(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  for (;;) {
    const v = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
    if (v < limit) return v % n;
  }
}

/** A code is compared without case or surrounding space, with any run of spaces or underscores read as a hyphen. */
export function normalizeCode(code) {
  return String(code).trim().toUpperCase().replace(/[\s_]+/g, '-');
}

/** KARHU-7215-SUMU-VALO: the shape the server makes for an open or sealed share. */
export function newPickupCode() {
  const w = () => CODE_WORDS[randomBelow(CODE_WORDS.length)];
  return `${w()}-${String(randomBelow(10000)).padStart(4, '0')}-${w()}-${w()}`;
}

/* ── AES-GCM helpers ──────────────────────────────────────────────────────────────────────── */

async function aesSeal(key, plain) {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plain);
  return `${b64url(iv)}.${b64url(ct)}`;
}

async function aesOpen(key, ivText, ctText) {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromB64url(ivText) }, key, fromB64url(ctText)));
}

const importAes = (raw) => subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

/* ── The content ──────────────────────────────────────────────────────────────────────────── */

/**
 * Seal one secret's content under a fresh content key.
 * @param {{ format: string, text?: string, content_base64?: string, file_name?: string, content_type?: string }} content
 * @returns {Promise<{ envelope: string, rawKey: Uint8Array }>}
 */
export async function sealContent(content) {
  const key = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const rawKey = new Uint8Array(await subtle().exportKey('raw', key));
  const envelope = await aesSeal(key, enc.encode(JSON.stringify(content)));
  return { envelope, rawKey };
}

/** Open an envelope with the raw content key: the content object sealContent was given. */
export async function openContent(envelope, rawKey) {
  const [iv, ct] = String(envelope).split('.');
  if (!iv || !ct) throw new Error('envelope');
  const plain = await aesOpen(await importAes(rawKey), iv, ct);
  return JSON.parse(dec.decode(plain));
}

/* ── Wrapping the content key for a device ────────────────────────────────────────────────── */

async function kekFor(sharedBits, keyId) {
  const base = await subtle().importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(INFO_PREFIX + keyId) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** A public key as a JWK object or the JSON string the node stores, imported for ECDH. */
async function importPublic(jwk) {
  const j = typeof jwk === 'string' ? JSON.parse(jwk) : jwk;
  return subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, ext: true }, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

/** The content key wrapped for one device: b64url(E.public raw) . b64url(iv) . b64url(ciphertext). */
export async function wrapForDevice(rawKey, publicJwk, keyId) {
  const peer = await importPublic(publicJwk);
  const eph = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const shared = await subtle().deriveBits({ name: 'ECDH', public: peer }, eph.privateKey, 256);
  const kek = await kekFor(shared, keyId);
  const ephRaw = await subtle().exportKey('raw', eph.publicKey);
  return `${b64url(ephRaw)}.${await aesSeal(kek, rawKey)}`;
}

/** The content key from a wrapped entry, with this device's private key. */
export async function unwrapWithDevice(wrapped, privateKey, keyId) {
  const [ephText, iv, ct] = String(wrapped).split('.');
  if (!ephText || !iv || !ct) throw new Error('wrapped');
  const eph = await subtle().importKey('raw', fromB64url(ephText), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await subtle().deriveBits({ name: 'ECDH', public: eph }, privateKey, 256);
  return aesOpen(await kekFor(shared, keyId), iv, ct);
}

/* ── The code ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The code's key and verifier. `salt` is base64url; a new one is made when none is given.
 * @returns {Promise<{ key: CryptoKey, verifier: string, salt: string }>}
 */
export async function deriveCode(code, salt) {
  const saltText = salt || b64url(randomBytes(16));
  const base = await subtle().importKey('raw', enc.encode(normalizeCode(code)), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(saltText), iterations: PBKDF2_ITERATIONS }, base, 512,
  ));
  const key = await importAes(bits.slice(0, 32));
  const verifier = hex(await subtle().digest('SHA-256', bits.slice(32)));
  return { key, verifier, salt: saltText };
}

/** The content key sealed under the code's key: b64url(iv) . b64url(ciphertext). */
export async function wrapForCode(rawKey, codeKey) {
  return aesSeal(codeKey, rawKey);
}

/** The content key from the 'code' entry. */
export async function unwrapWithCode(wrapped, codeKey) {
  const [iv, ct] = String(wrapped).split('.');
  if (!iv || !ct) throw new Error('wrapped');
  return aesOpen(codeKey, iv, ct);
}

/* ── The device key pair ──────────────────────────────────────────────────────────────────── */

/** A new pair: the private key cannot be exported; the public key is returned as { kty, crv, x, y }. */
export async function newDeviceKeyPair() {
  const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const j = await subtle().exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk: { kty: 'EC', crv: 'P-256', x: j.x, y: j.y } };
}

/** The id the node gives a public key (services/secret-shares/device-keys.ts): SHA-256 of its JSON, base64url, 16 characters. */
export async function deviceKeyId(publicJwk) {
  const json = JSON.stringify({ kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y });
  return b64url(await subtle().digest('SHA-256', enc.encode(json))).slice(0, 16);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function inStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

/**
 * This browser's device key for an account, or null.
 * @returns {Promise<{ privateKey: CryptoKey, publicJwk: object, keyId: string, label: string, createdAt: string } | null>}
 */
export async function loadDeviceKey(ghii) {
  if (!globalThis.indexedDB || !ghii) return null;
  return (await inStore('readonly', (s) => s.get(ghii))) || null;
}

/** Keep the device key for an account (the private key as a CryptoKey that cannot be exported). */
export async function saveDeviceKey(ghii, record) {
  await inStore('readwrite', (s) => s.put(record, ghii));
}

/** Forget this browser's device key for an account. */
export async function forgetDeviceKey(ghii) {
  if (!globalThis.indexedDB || !ghii) return;
  await inStore('readwrite', (s) => s.delete(ghii));
}

/** "Firefox on Windows": a label for a registered browser, from the user agent. */
export function deviceLabel(ua = globalThis.navigator?.userAgent || '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

/* ── One share's sealing, as a page needs it ──────────────────────────────────────────────── */

/**
 * Seal content for every device key given, and for a code when one is given.
 * @param {object} content the content object (see sealContent)
 * @param {Array<{ ghii: string, key_id: string, public_key: object|string }>} devices
 * @param {string|null} code a pickup code the page made, or null
 * @returns {Promise<{ envelope: string, e2e_keys: Array<{ ghii: string, key_id: string, wrapped: string }>, code_salt?: string, code_verifier?: string }>}
 */
export async function sealForRecipients(content, devices, code) {
  const { envelope, rawKey } = await sealContent(content);
  const e2e_keys = [];
  for (const d of devices) {
    e2e_keys.push({ ghii: d.ghii, key_id: d.key_id, wrapped: await wrapForDevice(rawKey, d.public_key, d.key_id) });
  }
  const out = { envelope, e2e_keys };
  if (code) {
    const c = await deriveCode(code);
    e2e_keys.push({ ghii: 'code', key_id: 'code', wrapped: await wrapForCode(rawKey, c.key) });
    out.code_salt = c.salt;
    out.code_verifier = c.verifier;
  }
  return out;
}
