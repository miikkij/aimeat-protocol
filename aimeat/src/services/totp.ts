/**
 * @file src/services/totp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description TOTP (RFC 6238) two-factor auth helpers: generates a secret + otpauth URI + QR data
 *   URL and backup codes on setup, validates codes/backup codes (timing-safe), and encrypts the
 *   secret at rest with AES-256-GCM.
 *
 * @structure
 *   - totpConfigOf(): the node's TOTP settings from its config
 *   - setupTotp(): create secret, QR, and hashed/encrypted material for storage
 *   - validateTotpCode() / validateBackupCode(): verify a submitted code (timing-safe backup compare)
 *   - generateBackupCodes(): mint a fresh set of plain + hashed backup codes
 *   - encryptSecret() / decryptSecret(): internal AES-256-GCM (iv:authTag:ciphertext) at-rest crypto
 *   - sealPlaintextTotpSecrets(): boot step, encrypts a secret stored in plain text
 *
 * @version-history
 *   v1.2.0 — 2026-10-09 — A secret is never stored in plain text: the general key (AIMEAT_ENCRYPTION_KEY)
 *     encrypts it, the TOTP key is the fallback, and with neither setupTotp() throws
 *     TotpEncryptionUnavailableError (503) instead. A stored secret is read in all three forms (plain,
 *     under either key), and sealPlaintextTotpSecrets() encrypts the plain ones at start (secrets
 *     audit 2026-10-09, auth S4).
 *   v1.1.0 — 2026-10-05 — totpConfigOf(): the settings were built twice (routes/totp.ts and the login
 *     route), and now also feed services/password-check.ts.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { TOTP, Secret } from 'otpauth';
import { createRequire } from 'node:module';
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

// CJS-ESM interop for qrcode
const require = createRequire(import.meta.url);
 
const QRCode = require('qrcode') as { toDataURL: (text: string) => Promise<string> };
 

// ── TOTP Configuration ──

export interface TotpConfig {
  issuer: string;
  algorithm: 'SHA1';
  digits: 6;
  period: number;
  window: number;
  backupCodeCount: number;
  /** The key a new secret is encrypted with. Without one, setupTotp() refuses. */
  encryptionKey?: Buffer;
  /** Every key a stored secret may be encrypted with, tried in order. Defaults to `encryptionKey`. */
  decryptionKeys?: Buffer[];
}

/** The node has no key to encrypt a TOTP secret with, so it does not set the factor up. */
export class TotpEncryptionUnavailableError extends Error {
  readonly code = 'ENCRYPTION_NOT_CONFIGURED';
  readonly status = 503;
  constructor() {
    super('Two-step sign-in cannot be set up on this server yet: it has no key to protect the secret with. Ask whoever runs it to set AIMEAT_ENCRYPTION_KEY.');
    this.name = 'TotpEncryptionUnavailableError';
  }
}

type TotpKeyConfig = Pick<AimeatConfig, 'totpSecretEncryptionKey' | 'encryptionKey'>;

/** A 64-hex key as a 32-byte buffer, or null for anything else. */
function keyOf(hex: string | null | undefined): Buffer | null {
  if (!hex) return null;
  const buf = Buffer.from(hex, 'hex');
  return buf.length === 32 ? buf : null;
}

/**
 * The keys a TOTP secret is protected with. A new secret is encrypted with the node's general key
 * (AIMEAT_ENCRYPTION_KEY), and with the TOTP key when only that is set, which is the order
 * services/encryption.ts getEncryptionKey() uses. A stored secret may be under either, because until
 * 2026-10-09 only the TOTP key was used here, so both are tried when reading.
 */
function totpKeysOf(config: TotpKeyConfig): { write: Buffer | undefined; read: Buffer[] } {
  const general = keyOf(config.encryptionKey);
  const totp = keyOf(config.totpSecretEncryptionKey);
  const read = [general, totp].filter((k): k is Buffer => k !== null);
  return { write: read[0], read };
}

/** The node's TOTP settings, built in one place for the setup routes and every sign-in check. */
export function totpConfigOf(config: Pick<AimeatConfig, 'totpIssuer' | 'totpPeriod' | 'totpWindow' | 'totpBackupCodeCount' | 'totpSecretEncryptionKey' | 'encryptionKey'>): TotpConfig {
  const keys = totpKeysOf(config);
  return {
    issuer: config.totpIssuer,
    algorithm: 'SHA1' as const,
    digits: 6 as const,
    period: config.totpPeriod,
    window: config.totpWindow,
    backupCodeCount: config.totpBackupCodeCount,
    encryptionKey: keys.write,
    decryptionKeys: keys.read,
  };
}

/**
 * Is this stored value a TOTP secret in plain text? A secret is base32 (A-Z, 2-7, optional `=`
 * padding) and the encrypted form is three hex parts joined by `:`, so the two cannot be mistaken
 * for each other. Anything that is neither is left as it is by every reader and writer here.
 */
function isPlainBase32Secret(stored: string): boolean {
  return /^[A-Z2-7]{16,}={0,6}$/.test(stored);
}

/** The base32 secret from what is stored: decrypted when it is the encrypted form, as it is otherwise. */
function secretFromStored(stored: string, config: TotpConfig): string {
  if (!stored.includes(':')) return stored;
  const keys = config.decryptionKeys ?? (config.encryptionKey ? [config.encryptionKey] : []);
  let lastError: unknown = new Error('no key to decrypt the stored TOTP secret');
  for (const key of keys) {
    try {
      return decryptSecret(stored, key);
    } catch (err) {
      // The next key may be the one: a secret is under the general key or the TOTP key.
      lastError = err;
    }
  }
  throw lastError;
}

// ── Setup Result ──

export interface TotpSetupResult {
  secret: string;               // Base32 secret (shown only once)
  uri: string;                  // otpauth:// URI
  qrDataUrl: string;            // data:image/png;base64,...
  backupCodes: string[];        // 10 × 8-char codes (shown only once)
  encryptedSecret: string;      // Encrypted for storage
  hashedBackupCodes: string[];  // SHA-256 hashed for storage
}

export async function setupTotp(
  username: string,
  config: TotpConfig,
): Promise<TotpSetupResult> {
  // Refused before anything is made: a secret stored in plain text is readable to anyone who reads
  // the database, and the factor then protects nothing against them (secrets audit 2026-10-09, S4).
  const key = config.encryptionKey;
  if (!key) throw new TotpEncryptionUnavailableError();
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: config.issuer,
    label: username,
    algorithm: config.algorithm,
    digits: config.digits,
    period: config.period,
    secret,
  });

  const uri = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(uri);

  // Backup codes: 10 × 8-char random hex
  const backupCodes: string[] = [];
  const hashedBackupCodes: string[] = [];
  for (let i = 0; i < config.backupCodeCount; i++) {
    const code = randomBytes(6).toString('hex');
    backupCodes.push(code);
    hashedBackupCodes.push(createHash('sha256').update(code).digest('hex'));
  }

  // Encrypt secret for storage
  const encryptedSecret = encryptSecret(secret.base32, key);

  return {
    secret: secret.base32,
    uri,
    qrDataUrl,
    backupCodes,
    encryptedSecret,
    hashedBackupCodes,
  };
}

// ── Validation ──

export function validateTotpCode(
  encryptedSecret: string,
  code: string,
  config: TotpConfig,
): { valid: boolean; delta: number | null } {
  // A secret stored before 2026-10-09 may be plain base32, or under the TOTP key on a node that
  // has the general key now: secretFromStored reads all three.
  const secretBase32 = secretFromStored(encryptedSecret, config);

  const totp = new TOTP({
    issuer: config.issuer,
    algorithm: config.algorithm,
    digits: config.digits,
    period: config.period,
    secret: Secret.fromBase32(secretBase32),
  });

  const delta = totp.validate({ token: code, window: config.window });
  return { valid: delta !== null, delta };
}

// ── Backup Code Validation ──

export function validateBackupCode(
  code: string,
  hashedCodes: string[],
): { valid: boolean; index: number } {
  // SECURITY: Use timing-safe comparison to prevent timing attacks
  const hashedBuf = createHash('sha256').update(code).digest();

  for (let i = 0; i < hashedCodes.length; i++) {
    const storedBuf = Buffer.from(hashedCodes[i], 'hex');
    if (hashedBuf.length === storedBuf.length && timingSafeEqual(hashedBuf, storedBuf)) {
      return { valid: true, index: i };
    }
  }
  return { valid: false, index: -1 };
}

// ── AES-256-GCM encryption/decryption ──

function encryptSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(data: string, key: Buffer): string {
  const [ivHex, authTagHex, ciphertextHex] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

// ── Boot step: encrypt a secret stored in plain text ──

/**
 * At start, encrypt every TOTP secret stored in plain text, when the node has a key. Until
 * 2026-10-09 a node without AIMEAT_TOTP_ENCRYPTION_KEY stored the base32 secret as it was, even
 * with AIMEAT_ENCRYPTION_KEY set (secrets audit 2026-10-09, S4).
 *
 * ON POSITIVE EVIDENCE ONLY (CLAUDE.md, Backend): a value is rewritten when it is base32 and nothing
 * else, and the rewrite is read back through the same path a sign-in takes before it is stored. A
 * value that is neither base32 nor the encrypted form is counted in `left` and not touched. Without
 * a key nothing changes. It never throws: the node boots whatever this finds.
 */
export async function sealPlaintextTotpSecrets(
  storage: Pick<Storage, 'listGHIIs' | 'updateGHII'>,
  config: TotpKeyConfig,
): Promise<{ sealed: number; left: number }> {
  const keys = totpKeysOf(config);
  if (!keys.write) return { sealed: 0, left: 0 };
  const readConfig = { decryptionKeys: keys.read } as TotpConfig;
  let sealed = 0;
  let left = 0;
  try {
    for (const g of await storage.listGHIIs()) {
      const stored = g.totpSecret;
      if (!stored || stored.includes(':')) continue;
      if (!isPlainBase32Secret(stored)) { left++; continue; }
      try {
        const next = encryptSecret(stored, keys.write);
        if (secretFromStored(next, readConfig) !== stored) { left++; continue; }
        await storage.updateGHII(g.ghii, { totpSecret: next });
        sealed++;
      } catch (err) {
        left++;
        logger.warn('totp: a stored secret could not be encrypted at start; it stays as it was', { ghii: g.ghii, error: String(err) });
      }
    }
  } catch (err) {
    logger.error('totp: the start-up pass over stored secrets failed; nothing else changed', { error: String(err) });
  }
  if (sealed > 0) logger.info(`totp: encrypted ${sealed} two-step sign-in secret(s) that were stored in plain text`);
  if (left > 0) logger.warn(`totp: ${left} stored two-step sign-in secret(s) are not in a form this server recognises and were left as they are`);
  return { sealed, left };
}

// ── Generate new backup codes ──

export function generateBackupCodes(count: number): { plain: string[]; hashed: string[] } {
  const plain: string[] = [];
  const hashed: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = randomBytes(6).toString('hex');
    plain.push(code);
    hashed.push(createHash('sha256').update(code).digest('hex'));
  }
  return { plain, hashed };
}
