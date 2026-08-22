/**
 * @file init-wizard-secrets.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Unit tests for the wizard's per-instance at-rest encryption secrets
 *   (ensureEncryptionSecrets): each instance gets its own TOTP key + node-key passphrase, and an
 *   existing value is NEVER regenerated (regenerating would strand stored 2FA secrets and the
 *   encrypted node key). Also checks the generated .env carries both keys.
 * @version-history
 *   v1.0.0 — 2026-08-21 — Initial.
 */

import { describe, it, expect } from 'vitest';
import { ensureEncryptionSecrets } from '../../src/cli/init-wizard.js';
import { generateEnvContent } from '../../src/cli/init-wizard/generate.js';

describe('ensureEncryptionSecrets', () => {
  it('generates a 64-hex TOTP key and a url-safe passphrase on a fresh instance', () => {
    const settings: Record<string, string> = {};
    ensureEncryptionSecrets(settings, {});
    expect(settings.AIMEAT_TOTP_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(settings.AIMEAT_KEY_PASSPHRASE).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(settings.AIMEAT_KEY_PASSPHRASE.length).toBeGreaterThanOrEqual(32);
  });

  it('NEVER regenerates a value already in the environment (re-run is safe)', () => {
    const existingTotp = 'a'.repeat(64);
    const existingPass = 'EXISTING_PASSPHRASE_VALUE';
    const settings: Record<string, string> = {};
    ensureEncryptionSecrets(settings, {
      AIMEAT_TOTP_ENCRYPTION_KEY: existingTotp,
      AIMEAT_KEY_PASSPHRASE: existingPass,
    });
    expect(settings.AIMEAT_TOTP_ENCRYPTION_KEY).toBe(existingTotp);
    expect(settings.AIMEAT_KEY_PASSPHRASE).toBe(existingPass);
  });

  it('a value typed this run wins over the environment', () => {
    const settings: Record<string, string> = { AIMEAT_KEY_PASSPHRASE: 'typed-this-run' };
    ensureEncryptionSecrets(settings, { AIMEAT_KEY_PASSPHRASE: 'from-env' });
    expect(settings.AIMEAT_KEY_PASSPHRASE).toBe('typed-this-run');
  });

  it('two fresh instances get different secrets', () => {
    const a: Record<string, string> = {};
    const b: Record<string, string> = {};
    ensureEncryptionSecrets(a, {});
    ensureEncryptionSecrets(b, {});
    expect(a.AIMEAT_TOTP_ENCRYPTION_KEY).not.toBe(b.AIMEAT_TOTP_ENCRYPTION_KEY);
    expect(a.AIMEAT_KEY_PASSPHRASE).not.toBe(b.AIMEAT_KEY_PASSPHRASE);
  });

  it('the generated .env carries both secrets under the Security section', () => {
    const settings: Record<string, string> = { AIMEAT_NODE_ID: 'n1' };
    ensureEncryptionSecrets(settings, {});
    const env = generateEnvContent(settings);
    expect(env).toContain('Security (encryption at rest)');
    expect(env).toMatch(/AIMEAT_TOTP_ENCRYPTION_KEY="/);
    expect(env).toMatch(/AIMEAT_KEY_PASSPHRASE="/);
  });
});
