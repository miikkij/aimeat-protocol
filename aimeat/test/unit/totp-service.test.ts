import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { setupTotp, validateTotpCode, validateBackupCode, generateBackupCodes } from '../../src/services/totp.js';
import type { TotpConfig } from '../../src/services/totp.js';

const BASE_CONFIG: TotpConfig = {
  issuer: 'AIMEAT-Test',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  window: 1,
  backupCodeCount: 10,
};

const CONFIG_WITH_KEY: TotpConfig = {
  ...BASE_CONFIG,
  encryptionKey: randomBytes(32),
};

describe('setupTotp', () => {
  it('returns setup result with all fields', async () => {
    const result = await setupTotp('testuser', BASE_CONFIG);
    expect(result.secret).toBeTruthy();
    expect(result.uri).toContain('otpauth://totp/');
    expect(result.qrDataUrl).toContain('data:image/png;base64,');
    expect(result.backupCodes).toHaveLength(10);
    expect(result.hashedBackupCodes).toHaveLength(10);
    expect(result.encryptedSecret).toBeTruthy();
  });

  it('generates unique backup codes', async () => {
    const result = await setupTotp('testuser', BASE_CONFIG);
    const uniqueCodes = new Set(result.backupCodes);
    expect(uniqueCodes.size).toBe(result.backupCodes.length);
  });

  it('backup codes are 12 hex characters', async () => {
    const result = await setupTotp('testuser', BASE_CONFIG);
    for (const code of result.backupCodes) {
      expect(code).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  it('hashed backup codes are SHA-256 hex', async () => {
    const result = await setupTotp('testuser', BASE_CONFIG);
    for (const hash of result.hashedBackupCodes) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('encrypts secret when encryption key provided', async () => {
    const result = await setupTotp('testuser', CONFIG_WITH_KEY);
    // Encrypted format: iv:authTag:ciphertext
    expect(result.encryptedSecret).toContain(':');
    const parts = result.encryptedSecret.split(':');
    expect(parts).toHaveLength(3);
    // Secret should be different from encryptedSecret
    expect(result.encryptedSecret).not.toBe(result.secret);
  });

  it('stores plain base32 when no encryption key', async () => {
    const result = await setupTotp('testuser', BASE_CONFIG);
    // Without encryption, encryptedSecret === secret (base32)
    expect(result.encryptedSecret).toBe(result.secret);
  });
});

describe('validateTotpCode', () => {
  it('validates correct TOTP code (without encryption)', async () => {
    const setup = await setupTotp('testuser', BASE_CONFIG);
    // Generate current code using the TOTP library
    const { TOTP, Secret } = await import('otpauth');
    const totp = new TOTP({
      issuer: BASE_CONFIG.issuer,
      algorithm: BASE_CONFIG.algorithm,
      digits: BASE_CONFIG.digits,
      period: BASE_CONFIG.period,
      secret: Secret.fromBase32(setup.secret),
    });
    const currentCode = totp.generate();

    const result = validateTotpCode(setup.encryptedSecret, currentCode, BASE_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.delta).not.toBeNull();
  });

  it('validates correct TOTP code (with encryption)', async () => {
    const setup = await setupTotp('testuser', CONFIG_WITH_KEY);
    const { TOTP, Secret } = await import('otpauth');
    const totp = new TOTP({
      issuer: CONFIG_WITH_KEY.issuer,
      algorithm: CONFIG_WITH_KEY.algorithm,
      digits: CONFIG_WITH_KEY.digits,
      period: CONFIG_WITH_KEY.period,
      secret: Secret.fromBase32(setup.secret),
    });
    const currentCode = totp.generate();

    const result = validateTotpCode(setup.encryptedSecret, currentCode, CONFIG_WITH_KEY);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid TOTP code', async () => {
    const setup = await setupTotp('testuser', BASE_CONFIG);
    const result = validateTotpCode(setup.encryptedSecret, '000000', BASE_CONFIG);
    expect(result.valid).toBe(false);
    expect(result.delta).toBeNull();
  });
});

describe('validateBackupCode', () => {
  it('validates correct backup code', async () => {
    const setup = await setupTotp('testuser', BASE_CONFIG);
    const firstCode = setup.backupCodes[0];
    const result = validateBackupCode(firstCode, setup.hashedBackupCodes);
    expect(result.valid).toBe(true);
    expect(result.index).toBe(0);
  });

  it('validates last backup code', async () => {
    const setup = await setupTotp('testuser', BASE_CONFIG);
    const lastCode = setup.backupCodes[9];
    const result = validateBackupCode(lastCode, setup.hashedBackupCodes);
    expect(result.valid).toBe(true);
    expect(result.index).toBe(9);
  });

  it('rejects invalid backup code', async () => {
    const setup = await setupTotp('testuser', BASE_CONFIG);
    const result = validateBackupCode('invalid_code', setup.hashedBackupCodes);
    expect(result.valid).toBe(false);
    expect(result.index).toBe(-1);
  });
});

describe('generateBackupCodes', () => {
  it('generates requested number of codes', () => {
    const result = generateBackupCodes(10);
    expect(result.plain).toHaveLength(10);
    expect(result.hashed).toHaveLength(10);
  });

  it('generates 12-char hex codes', () => {
    const result = generateBackupCodes(5);
    for (const code of result.plain) {
      expect(code).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  it('generates SHA-256 hashes', () => {
    const result = generateBackupCodes(5);
    for (const hash of result.hashed) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('plain codes validate against hashed codes', () => {
    const result = generateBackupCodes(5);
    for (let i = 0; i < result.plain.length; i++) {
      const validation = validateBackupCode(result.plain[i], result.hashed);
      expect(validation.valid).toBe(true);
      expect(validation.index).toBe(i);
    }
  });
});
