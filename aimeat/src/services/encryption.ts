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
 * @version-history
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
  const [ivHex, authTagHex, ciphertextHex] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
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
  const [ivHex, authTagHex, ciphertextHex] = data.slice(BOUND_PREFIX.length).split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return decipher.update(Buffer.from(ciphertextHex, 'hex')) + decipher.final('utf8');
}

/**
 * Resolve the encryption key from config. Returns null if not configured.
 * Checks AIMEAT_ENCRYPTION_KEY first, falls back to AIMEAT_TOTP_ENCRYPTION_KEY.
 */
export function getEncryptionKey(config: { encryptionKey: string | null; totpSecretEncryptionKey: string | null }): Buffer | null {
  const keyHex = config.encryptionKey ?? config.totpSecretEncryptionKey;
  if (!keyHex) return null;
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== 32) return null; // Must be 256 bits
  return buf;
}
