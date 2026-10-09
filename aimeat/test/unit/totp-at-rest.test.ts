/**
 * @file test/unit/totp-at-rest.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The TOTP secret is never stored in plain text (services/totp.ts). Secrets audit
 *   2026-10-09, auth S4: with AIMEAT_TOTP_ENCRYPTION_KEY unset the base32 secret was stored as it
 *   is, although the node's general key (AIMEAT_ENCRYPTION_KEY) was there to encrypt it.
 *
 *   What is held here: the general key encrypts, the TOTP key is the fallback; a node with neither
 *   refuses to set the factor up; a secret stored before (plain, or under the TOTP key) still
 *   validates; and the boot step encrypts a stored plain secret when a key exists, and leaves
 *   anything it cannot prove is a plain secret alone.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { TOTP, Secret } from 'otpauth';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import { loadConfig } from '../../src/config.js';
import { provisionOwner } from '../../src/services/owner-provisioning.js';
import {
  setupTotp, validateTotpCode, totpConfigOf, sealPlaintextTotpSecrets, TotpEncryptionUnavailableError,
} from '../../src/services/totp.js';
import { encrypt } from '../../src/services/encryption.js';

const NODE_ID = 'aimeat-local-001-dev';
const GENERAL = randomBytes(32).toString('hex');
const TOTP_KEY = randomBytes(32).toString('hex');

const cfg = (encryptionKey: string | null, totpSecretEncryptionKey: string | null): AimeatConfig =>
  ({ ...loadConfig().config, nodeId: NODE_ID, totpEnabled: true, encryptionKey, totpSecretEncryptionKey });

const codeOf = (base32: string) => new TOTP({ secret: Secret.fromBase32(base32), algorithm: 'SHA1', digits: 6, period: 30 }).generate();

describe('the TOTP secret at rest', () => {
  it('the general key encrypts it when the TOTP key is unset', async () => {
    const config = cfg(GENERAL, null);
    const t = await setupTotp('alice', totpConfigOf(config));
    expect(t.encryptedSecret).not.toBe(t.secret);
    expect(t.encryptedSecret.split(':')).toHaveLength(3);
    expect(validateTotpCode(t.encryptedSecret, codeOf(t.secret), totpConfigOf(config)).valid).toBe(true);
  });

  it('a node with neither key refuses to set it up rather than store it in plain text', async () => {
    const err = await setupTotp('alice', totpConfigOf(cfg(null, null))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TotpEncryptionUnavailableError);
    expect((err as TotpEncryptionUnavailableError).code).toBe('ENCRYPTION_NOT_CONFIGURED');
  });

  it('a secret stored under the TOTP key still validates once the general key is set too', () => {
    const base32 = new Secret({ size: 20 }).base32;
    const stored = encrypt(base32, Buffer.from(TOTP_KEY, 'hex'));
    expect(validateTotpCode(stored, codeOf(base32), totpConfigOf(cfg(GENERAL, TOTP_KEY))).valid).toBe(true);
  });

  it('a plain secret stored before still validates on a node that has a key', () => {
    const base32 = new Secret({ size: 20 }).base32;
    expect(validateTotpCode(base32, codeOf(base32), totpConfigOf(cfg(GENERAL, null))).valid).toBe(true);
    expect(validateTotpCode(base32, codeOf(base32), totpConfigOf(cfg(null, null))).valid).toBe(true);
  });
});

describe('the boot step that encrypts a stored plain secret', () => {
  let storage: SqliteStorage;
  const plain = new Secret({ size: 20 }).base32;

  async function withSecret(name: string, totpSecret: string): Promise<string> {
    const { ghii } = await provisionOwner(storage, cfg(GENERAL, null), { via: 'direct', username: name, displayName: name });
    await storage.updateGHII(ghii.ghii, { totpSecret, totpEnabled: true });
    return ghii.ghii;
  }

  beforeAll(() => { storage = new SqliteStorage(':memory:'); });

  it('without a key it changes nothing and does not throw', async () => {
    const id = await withSecret('nokey', plain);
    expect(await sealPlaintextTotpSecrets(storage, cfg(null, null))).toEqual({ sealed: 0, left: 0 });
    expect((await storage.getGHII(id))?.totpSecret).toBe(plain);
  });

  it('with a key it encrypts a plain base32 secret, which then validates, and leaves the rest alone', async () => {
    const id = await withSecret('plainone', plain);
    const already = encrypt(plain, Buffer.from(GENERAL, 'hex'));
    const enc = await withSecret('encone', already);
    const odd = await withSecret('oddone', 'not a base32 secret!');
    const config = cfg(GENERAL, null);
    const r = await sealPlaintextTotpSecrets(storage, config);
    expect(r.sealed).toBeGreaterThanOrEqual(1);
    const after = (await storage.getGHII(id))?.totpSecret ?? '';
    expect(after).not.toBe(plain);
    expect(after.split(':')).toHaveLength(3);
    expect(validateTotpCode(after, codeOf(plain), totpConfigOf(config)).valid).toBe(true);
    expect((await storage.getGHII(enc))?.totpSecret).toBe(already);
    expect((await storage.getGHII(odd))?.totpSecret).toBe('not a base32 secret!');
    // A second boot finds nothing left to do.
    expect((await sealPlaintextTotpSecrets(storage, config)).sealed).toBe(0);
  });
});
