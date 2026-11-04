/**
 * @file encryption.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description General-purpose AES-256-GCM encryption/decryption service.
 *   Provides encrypt() and decrypt() for storing secrets at rest.
 *   Key loaded from AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY (fallback).
 *
 *   BOUND CIPHERTEXT. One node key encrypts the secrets of every owner, so a ciphertext copied from
 *   one place to another decrypts wherever the node decrypts. encryptBound() authenticates a context
 *   string with the ciphertext (AES-GCM additional data): the value opens only where the caller names
 *   the same context, and a copy taken into another record or another extension's config fails the
 *   tag check. The context is not secret and is not stored; each caller rebuilds it from where the
 *   value lives. The output wears a `v2:` prefix so a reader can tell the two forms apart.
 * @structure
 *   - encrypt(plaintext, key) — returns iv:authTag:ciphertext (hex)
 *   - decrypt(data, key) — returns plaintext
 *   - encryptBound(plaintext, key, context) — returns v2:iv:authTag:ciphertext, bound to context
 *   - decryptBound(data, key, context) — plaintext, or a throw when the form or the context differ
 *   - isBoundCiphertext(data) — true for the v2 and v3 forms
 *   - getEncryptionKey(config) — resolves key from config with fallback
 *   - KeyRing / configureKeyRing(ring) — the keys by id, and the one new values are sealed with
 *
 *   ADDING THE DATA KEY LATER. A node installed with `aimeat init` runs on AIMEAT_TOTP_ENCRYPTION_KEY
 *   alone. When AIMEAT_ENCRYPTION_KEY is added, getEncryptionKey() returns it, and nothing re-encrypts
 *   what is stored, so until 2026-11-02 every AI provider key, MCP server credential, connected account
 *   and payment key written before stopped opening. getEncryptionKey() now remembers the TOTP key as
 *   the data key's fallback, and decrypt() and decryptBound() try it when the data key's tag check
 *   fails. New values are written under the data key; the old ones keep opening as long as the TOTP
 *   key stays set (IT adoption review; Jouni, 2026-11-02).
 *
 *   THE KEY RING AND THE KEY ID. A data key could not be replaced: every stored value names no key,
 *   so a new key opens none of them (codebase analysis 2026-11-03, security-architecture finding 10).
 *   A value sealed now under any key but key 0 says which key it is: `v3:<kid>:iv:authTag:ciphertext`
 *   (bound) and `v3u:<kid>:iv:authTag:ciphertext` (unbound), where `kid` is the key's number in the
 *   ring. Key 0 is the key the node had before key ids existed, and a value without a key id is read
 *   as key 0, with key 0's TOTP-key fallback as above. A key ring with key 0 alone, which is every
 *   node today, writes the two older forms exactly as before, so nothing stored or written changes
 *   until a second key is added. configureKeyRing() is the step a rotation takes; the runbook is
 *   docs/operations/key-rotation.md. The AES-GCM itself is utils/aes-gcm.ts, shared with the other
 *   four places the node encrypts.
 * @version-history
 *   v1.3.0 -- 2026-11-04 -- The key ring, the `v3:`/`v3u:` forms with a key id, configureKeyRing(),
 *     and AES-GCM through utils/aes-gcm.ts (codebase analysis 2026-11-03, item B9;
 *     test/unit/key-ring.test.ts, test/unit/legacy-keys-still-open.test.ts).
 *   v1.2.0 -- 2026-11-02 -- decrypt() and decryptBound() fall back to AIMEAT_TOTP_ENCRYPTION_KEY when
 *     AIMEAT_ENCRYPTION_KEY was added later (test/unit/encryption-key-fallback.test.ts).
 *   v1.1.0 — 2026-10-09 — encryptBound / decryptBound / isBoundCiphertext: ciphertext bound to the
 *     place it belongs (secrets audit 2026-10-09, finding 1.1, ruling 3).
 *   v1.0.0 — 2026-03-20 — Initial: extracted from totp.ts pattern
 */

import { gcmOpen, gcmSeal, type GcmSealed } from '../utils/aes-gcm.js';

// ── The key ring ─────────────────────────────────────────────────────────────────────────────────

/**
 * A node's data keys by number. Key 0 is the key the node had before key ids existed; `current` is
 * the key new values are sealed with, and it is the key getEncryptionKey() hands every caller.
 */
export interface KeyRing {
  current: number;
  keys: ReadonlyMap<number, Buffer>;
}

/**
 * The configured rings, filed under the hex of their current key: the one Buffer every caller holds.
 * A key with no ring here is a ring of one, key 0, which is every node until a rotation adds a key.
 */
// process-local: set from the node's configuration at start, the same in every process that reads it; nothing is learned at run time
const rings = new Map<string, KeyRing>();

/**
 * Make `ring` the ring of its current key, and answer that key. The rotation step calls it with the
 * keys from the node's configuration (docs/operations/key-rotation.md); nothing calls it on a node
 * with one key. Throws when the ring does not hold its current key or a key is not 32 bytes.
 */
export function configureKeyRing(ring: KeyRing): Buffer {
  const current = ring.keys.get(ring.current);
  if (!current) throw new Error(`The key ring names key ${ring.current} as current and does not hold it.`);
  for (const [kid, k] of ring.keys) {
    if (!Number.isInteger(kid) || kid < 0 || k.length !== 32) throw new Error(`Key ${kid} of the key ring is not a 256-bit key with a whole-number id.`);
  }
  rings.set(current.toString('hex'), { current: ring.current, keys: new Map(ring.keys) });
  return current;
}

/** The ring a caller's key is the current key of: a configured one, or the ring of one. */
function ringOf(key: Buffer): KeyRing {
  return rings.get(key.toString('hex')) ?? { current: 0, keys: new Map([[0, key]]) };
}

/** Key 0 of the ring, which opens every value written without a key id. */
const keyZeroOf = (key: Buffer): Buffer => ringOf(key).keys.get(0) ?? key;

const UNBOUND_V3_PREFIX = 'v3u:';
const BOUND_V3_PREFIX = 'v3:';
const KID_RE = /^\d{1,6}$/;

const hexOf = (s: GcmSealed): string => `${s.iv.toString('hex')}:${s.tag.toString('hex')}:${s.ct.toString('hex')}`;

/** The three hex parts of `iv:authTag:ciphertext`, as the reader of every form has split them. */
function partsOf(body: string): GcmSealed {
  const [ivHex, authTagHex, ciphertextHex] = body.split(':');
  return { iv: Buffer.from(ivHex, 'hex'), tag: Buffer.from(authTagHex, 'hex'), ct: Buffer.from(ciphertextHex, 'hex') };
}

/** Open a `v3:`/`v3u:` value with the key its id names. Throws when the ring does not hold that key. */
function openWithKid(data: string, prefix: string, key: Buffer, aad?: Buffer): string {
  const rest = data.slice(prefix.length);
  const cut = rest.indexOf(':');
  const kid = rest.slice(0, cut);
  if (cut < 0 || !KID_RE.test(kid)) throw new Error('The sealed value names no key id.');
  const k = ringOf(key).keys.get(Number(kid));
  if (!k) throw new Error(`The value was sealed with key ${kid}, which this node's key ring does not hold.`);
  return gcmOpen(k, partsOf(rest.slice(cut + 1)), aad).toString('utf8');
}

// ── Unbound values ───────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt a string with AES-256-GCM.
 * @returns `iv:authTag:ciphertext` (all hex-encoded, colon-separated) under key 0, and
 *   `v3u:<kid>:iv:authTag:ciphertext` under any later key of the ring.
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const ring = ringOf(key);
  const sealed = hexOf(gcmSeal(key, plaintext));
  return ring.current === 0 ? sealed : `${UNBOUND_V3_PREFIX}${ring.current}:${sealed}`;
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * @param data Format: `iv:authTag:ciphertext` (all hex), or `v3u:<kid>:` followed by it
 */
export function decrypt(data: string, key: Buffer): string {
  if (typeof data === 'string' && data.startsWith(UNBOUND_V3_PREFIX)) return openWithKid(data, UNBOUND_V3_PREFIX, key);
  return withFallback(keyZeroOf(key), k => decryptWith(data, k));
}

function decryptWith(data: string, key: Buffer): string {
  return gcmOpen(key, partsOf(data)).toString('utf8');
}

/**
 * The data key's older key, for values written before the data key was set: AIMEAT_TOTP_ENCRYPTION_KEY
 * when both are set and differ. Keyed by the data key's hex, so a process serving several nodes opens
 * each node's values only with that node's own two keys. Filled by getEncryptionKey(), which every
 * caller asks for the key it then decrypts with, so no start step is needed.
 */
const fallbackKeys = new Map<string, Buffer>();

/**
 * Run `open` with `key`, and when the tag check fails, once more with that key's fallback. The first
 * error is the one thrown when neither opens, so a caller sees the same failure as before.
 */
function withFallback(key: Buffer, open: (k: Buffer) => string): string {
  try {
    return open(key);
  } catch (err) {
    const older = fallbackKeys.get(key.toString('hex'));
    if (!older) throw err;
    try {
      return open(older);
    } catch {
      throw err;
    }
  }
}

// ── Bound values ─────────────────────────────────────────────────────────────────────────────────

const BOUND_PREFIX = 'v2:';

/** True for a value encryptBound() wrote, under key 0 (`v2:`) or a later key (`v3:`). */
export function isBoundCiphertext(data: unknown): boolean {
  return typeof data === 'string' && (data.startsWith(BOUND_PREFIX) || data.startsWith(BOUND_V3_PREFIX));
}

/**
 * Encrypt with AES-256-GCM and authenticate `context` with it.
 * @returns `v2:iv:authTag:ciphertext` (hex parts) under key 0, and `v3:<kid>:iv:authTag:ciphertext`
 *   under any later key of the ring
 */
export function encryptBound(plaintext: string, key: Buffer, context: string): string {
  const ring = ringOf(key);
  const sealed = hexOf(gcmSeal(key, plaintext, Buffer.from(context, 'utf8')));
  return ring.current === 0 ? `${BOUND_PREFIX}${sealed}` : `${BOUND_V3_PREFIX}${ring.current}:${sealed}`;
}

/**
 * Decrypt a value encryptBound() wrote for the same `context`. Throws for the unbound form and for a
 * value bound to any other context, so a caller cannot be made to open a ciphertext from elsewhere.
 */
export function decryptBound(data: string, key: Buffer, context: string): string {
  if (!isBoundCiphertext(data)) throw new Error('not a bound ciphertext');
  if (data.startsWith(BOUND_V3_PREFIX)) return openWithKid(data, BOUND_V3_PREFIX, key, Buffer.from(context, 'utf8'));
  return withFallback(keyZeroOf(key), k => decryptBoundWith(data, k, context));
}

function decryptBoundWith(data: string, key: Buffer, context: string): string {
  return gcmOpen(key, partsOf(data.slice(BOUND_PREFIX.length)), Buffer.from(context, 'utf8')).toString('utf8');
}

/** A 32-byte key from its hex form, or null. */
function keyOf(keyHex: string | null): Buffer | null {
  if (!keyHex) return null;
  const buf = Buffer.from(keyHex, 'hex');
  return buf.length === 32 ? buf : null; // Must be 256 bits
}

/**
 * Resolve the encryption key from config. Returns null if not configured.
 * Checks AIMEAT_ENCRYPTION_KEY first, falls back to AIMEAT_TOTP_ENCRYPTION_KEY. When both are set and
 * differ, the TOTP key is remembered as the data key's fallback, so decrypt() and decryptBound() still
 * open what was written under it before the data key was set; new values are written under the data key.
 */
export function getEncryptionKey(config: { encryptionKey: string | null; totpSecretEncryptionKey: string | null }): Buffer | null {
  // A data key that is set but malformed is no key, as before: the TOTP key never stands in for it.
  const primary = config.encryptionKey ? keyOf(config.encryptionKey) : keyOf(config.totpSecretEncryptionKey);
  if (!primary) return null;
  const older = config.encryptionKey ? keyOf(config.totpSecretEncryptionKey) : null;
  if (older && !older.equals(primary)) fallbackKeys.set(primary.toString('hex'), older);
  return primary;
}
