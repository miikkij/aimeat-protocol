/**
 * @file src/services/totp.ts
 * @description TOTP (RFC 6238) two-factor auth helpers: generates a secret + otpauth URI + QR data
 *   URL and backup codes on setup, validates codes/backup codes (timing-safe), and encrypts the
 *   secret at rest with AES-256-GCM.
 *
 * @structure
 *   - setupTotp(): create secret, QR, and hashed/encrypted material for storage
 *   - validateTotpCode() / validateBackupCode(): verify a submitted code (timing-safe backup compare)
 *   - generateBackupCodes(): mint a fresh set of plain + hashed backup codes
 *   - encryptSecret() / decryptSecret(): internal AES-256-GCM (iv:authTag:ciphertext) at-rest crypto
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
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
  encryptionKey?: Buffer;
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
  const encryptedSecret = config.encryptionKey
    ? encryptSecret(secret.base32, config.encryptionKey)
    : secret.base32;

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
  const secretBase32 = config.encryptionKey
    ? decryptSecret(encryptedSecret, config.encryptionKey)
    : encryptedSecret;

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
