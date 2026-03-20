/**
 * @file encryption.ts
 * @description General-purpose AES-256-GCM encryption/decryption service.
 *   Provides encrypt() and decrypt() for storing secrets at rest.
 *   Key loaded from AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY (fallback).
 * @structure
 *   - encrypt(plaintext, key) — returns iv:authTag:ciphertext (hex)
 *   - decrypt(data, key) — returns plaintext
 *   - getEncryptionKey(config) — resolves key from config with fallback
 * @version-history
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
