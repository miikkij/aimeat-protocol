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
 *   - isBoundCiphertext(data) — true for the v2 form
 *   - getEncryptionKey(config) — resolves key from config with fallback
 *
 *   ADDING THE DATA KEY LATER. A node installed with `aimeat init` runs on AIMEAT_TOTP_ENCRYPTION_KEY
 *   alone. When AIMEAT_ENCRYPTION_KEY is added, getEncryptionKey() returns it, and nothing re-encrypts
 *   what is stored, so until 2026-11-02 every AI provider key, MCP server credential, connected account
 *   and payment key written before stopped opening. getEncryptionKey() now remembers the TOTP key as
 *   the data key's fallback, and decrypt() and decryptBound() try it when the data key's tag check
 *   fails. New values are written under the data key; the old ones keep opening as long as the TOTP
 *   key stays set (IT adoption review; Jouni, 2026-11-02).
 * @version-history
 *   v1.2.0 -- 2026-11-02 -- decrypt() and decryptBound() fall back to AIMEAT_TOTP_ENCRYPTION_KEY when
 *     AIMEAT_ENCRYPTION_KEY was added later (test/unit/encryption-key-fallback.test.ts).
 *   v1.1.0 — 2026-10-09 — encryptBound / decryptBound / isBoundCiphertext: ciphertext bound to the
 *     place it belongs (secrets audit 2026-10-09, finding 1.1, ruling 3).
 *   v1.0.0 — 2026-03-20 — Initial: extracted from totp.ts pattern
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * Encrypt a string with AES-256-GCM.
 * @returns `iv:authTag:ciphertext` (all hex-encoded, colon-separated)
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * @param data Format: `iv:authTag:ciphertext` (all hex)
 */
export function decrypt(data: string, key: Buffer): string {
  return withFallback(key, k => decryptWith(data, k));
}

function decryptWith(data: string, key: Buffer): string {
  const [ivHex, authTagHex, ciphertextHex] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
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

const BOUND_PREFIX = 'v2:';

/** True for a value encryptBound() wrote. */
export function isBoundCiphertext(data: unknown): boolean {
  return typeof data === 'string' && data.startsWith(BOUND_PREFIX);
}

/**
 * Encrypt with AES-256-GCM and authenticate `context` with it.
 * @returns `v2:iv:authTag:ciphertext` (hex parts)
 */
export function encryptBound(plaintext: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${BOUND_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a value encryptBound() wrote for the same `context`. Throws for the unbound form and for a
 * value bound to any other context, so a caller cannot be made to open a ciphertext from elsewhere.
 */
export function decryptBound(data: string, key: Buffer, context: string): string {
  if (!isBoundCiphertext(data)) throw new Error('not a bound ciphertext');
  return withFallback(key, k => decryptBoundWith(data, k, context));
}

function decryptBoundWith(data: string, key: Buffer, context: string): string {
  const [ivHex, authTagHex, ciphertextHex] = data.slice(BOUND_PREFIX.length).split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return decipher.update(Buffer.from(ciphertextHex, 'hex')) + decipher.final('utf8');
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
