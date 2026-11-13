/**
 * @file test/unit/password-check-count-first.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A password or second-factor attempt is counted before it is compared
 *   (secaudit2026oct31w2, W2-10, password-check.ts:second-factor-compare-before-count).
 *
 *   Every route reads the account record at the start of the request and hands that snapshot to the
 *   check. Requests sent at the same moment all hold a snapshot from before the lock was written.
 *   The check decided the lock from the snapshot and counted only after the compare, so such a
 *   request was compared whatever the count had reached, and a right guess past the limit passed.
 *   Here each call gets its own copy of one snapshot read before any guess, which is what those
 *   requests hold, so the order of the calls does not matter and the result is deterministic.
 * @usage cd aimeat && pnpm exec vitest run test/unit/password-check-count-first.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit2026oct31w2 round 10, W2-10).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { checkPassword, checkSecondFactor, checkTotpManagementCode } from '../../src/services/password-check.js';
import { hashPassword } from '../../src/services/password.js';
import { accountSecurityDefaults } from '../../src/config/types-account-security.js';
import type { GHIIRecord } from '../../src/storage/interface.js';

const NODE = 'aimeat-local-001-dev';
const config = {
  totpIssuer: 'T', totpPeriod: 30, totpWindow: 1, totpBackupCodeCount: 10,
  totpSecretEncryptionKey: null, encryptionKey: null, totpMaxFailedAttempts: 5, totpLockoutSeconds: 300,
  passwordLockoutAttempts: 5, passwordLockoutMinutes: 15, signInLockout: 'on',
} as never;
/** The same node with the lockout off, the default (auth.sign_in_lockout; Jouni, 2026-11-02 08.02). */
const lockoutOff = { ...(config as object), signInLockout: 'off' } as never;

let storage: SqliteStorage;
let secret = '';
const ghii = `pc@${NODE}`;
const codeAt = (offsetPeriods = 0) =>
  new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).generate({ timestamp: Date.now() + offsetPeriods * 30_000 });

beforeEach(async () => {
  storage = new SqliteStorage(':memory:');
  secret = new Secret({ size: 20 }).base32;
  const now = new Date().toISOString();
  await storage.createOwner({ name: 'pc', displayName: 'PC', publicKey: 'x', roles: ['owner'], createdAt: now });
  await storage.createGHII({
    username: 'pc', nodeId: NODE, ghii, displayName: 'PC', ownerName: 'pc', verificationLevel: 0,
    totpEnabled: true, totpSecret: secret, passwordHash: await hashPassword('Right-Password-1234'),
    createdAt: now, updatedAt: now,
  } as GHIIRecord);
});
afterEach(() => { storage.close(); });

/** The account as a request read it before any guess was answered. */
async function snapshot(): Promise<() => GHIIRecord> {
  const rec = (await storage.getGHII(ghii))!;
  return () => structuredClone(rec);
}

describe('with the lockout off, the default, nothing locks an account', () => {
  it('a node with no setting has the lockout off', () => {
    expect(accountSecurityDefaults('https://x.example', 'X').signInLockout).toBe('off');
  });

  it('password: many wrong ones answer wrong, count nothing, and the right one still signs in', async () => {
    for (let i = 0; i < 12; i++) {
      const r = await checkPassword(storage, lockoutOff, (await storage.getGHII(ghii))!, 'wrong-password');
      expect(r.ok ? '' : r.code).toBe('AUTH_REQUIRED');
    }
    const rec = (await storage.getGHII(ghii))!;
    expect(rec.passwordFailedAttempts ?? 0).toBe(0);
    expect(rec.passwordLockedUntil ?? null).toBe(null);
    expect((await checkPassword(storage, lockoutOff, rec, 'Right-Password-1234')).ok).toBe(true);
  });

  it('a lock left from when it was on does not hold', async () => {
    await storage.updateGHII(ghii, { passwordFailedAttempts: 5, passwordLockedUntil: new Date(Date.now() + 3_600_000).toISOString() });
    const rec = (await storage.getGHII(ghii))!;
    expect((await checkPassword(storage, config, rec, 'Right-Password-1234')).ok, 'with the lockout on it does hold').toBe(false);
    expect((await checkPassword(storage, lockoutOff, rec, 'Right-Password-1234')).ok).toBe(true);
  });

  it('two-step code: many wrong ones answer wrong and count nothing, and the right one passes', async () => {
    for (let i = 0; i < 12; i++) {
      const r = await checkSecondFactor(storage, lockoutOff, (await storage.getGHII(ghii))!, { totp_code: codeAt(-20 - i) });
      expect(r.ok ? '' : r.code).toBe('INVALID_TOTP');
    }
    const rec = (await storage.getGHII(ghii))!;
    expect(rec.totpFailedAttempts ?? 0).toBe(0);
    expect((await checkSecondFactor(storage, lockoutOff, rec, { totp_code: codeAt() })).ok).toBe(true);
  });

  it('with the setting on, the lock still works: the fifth wrong password locks', async () => {
    let last = await checkPassword(storage, config, (await storage.getGHII(ghii))!, 'wrong-password');
    for (let i = 0; i < 5; i++) last = await checkPassword(storage, config, (await storage.getGHII(ghii))!, 'wrong-password');
    expect(last.ok ? '' : last.code).toBe('PASSWORD_LOCKED');
  });
});

describe('an attempt is counted before it is compared (W2-10)', () => {
  it('second factor at sign-in: past the limit, a right code from a request that read the account earlier is refused', async () => {
    const early = await snapshot();
    for (let i = 0; i < 5; i++) await checkSecondFactor(storage, config, early(), { totp_code: codeAt(-20 - i) });
    const late = await checkSecondFactor(storage, config, early(), { totp_code: codeAt() });
    expect(late.ok, 'SECURITY: a code was compared past the lock').toBe(false);
    expect(late.ok ? '' : late.code).toBe('TOTP_LOCKED');
  });

  it('second factor on its own routes: the same', async () => {
    const early = await snapshot();
    for (let i = 0; i < 5; i++) await checkTotpManagementCode(storage, config, early(), { code: codeAt(-20 - i) }, 'wrong');
    const late = await checkTotpManagementCode(storage, config, early(), { code: codeAt() }, 'wrong');
    expect(late.ok, 'SECURITY: a code was compared past the lock').toBe(false);
    expect(late.ok ? '' : late.code).toBe('TOTP_LOCKED');
  });

  it('password: the same', async () => {
    const early = await snapshot();
    for (let i = 0; i < 5; i++) await checkPassword(storage, config, early(), `wrong-${i}`);
    const late = await checkPassword(storage, config, early(), 'Right-Password-1234');
    expect(late.ok, 'SECURITY: a password was compared past the lock').toBe(false);
    expect(late.ok ? '' : late.code).toBe('PASSWORD_LOCKED');
  });

  it('usage: four mistakes and then the right code or password pass, and the count starts again', async () => {
    for (let i = 0; i < 4; i++) {
      const r = await checkTotpManagementCode(storage, config, (await storage.getGHII(ghii))!, { code: codeAt(-20 - i) }, 'wrong');
      expect(r.ok ? '' : r.code).toBe('INVALID_TOTP');
    }
    expect((await checkSecondFactor(storage, config, (await storage.getGHII(ghii))!, { totp_code: codeAt() })).ok).toBe(true);
    for (let i = 0; i < 4; i++) {
      const r = await checkTotpManagementCode(storage, config, (await storage.getGHII(ghii))!, { code: codeAt(-30 - i) }, 'wrong');
      expect(r.ok ? '' : r.code).toBe('INVALID_TOTP');
    }
    for (let i = 0; i < 4; i++) {
      const r = await checkPassword(storage, config, (await storage.getGHII(ghii))!, `wrong-${i}`);
      expect(r.ok ? '' : r.code).toBe('AUTH_REQUIRED');
    }
    expect((await checkPassword(storage, config, (await storage.getGHII(ghii))!, 'Right-Password-1234')).ok).toBe(true);
    const again = await checkPassword(storage, config, (await storage.getGHII(ghii))!, 'wrong-again');
    expect(again.ok ? '' : again.code).toBe('AUTH_REQUIRED');
  });

  it('usage: the fifth wrong code answers TOTP_LOCKED, and the lock refuses the right code until it runs out', async () => {
    for (let i = 0; i < 4; i++) await checkTotpManagementCode(storage, config, (await storage.getGHII(ghii))!, { code: codeAt(-20 - i) }, 'wrong');
    const fifth = await checkTotpManagementCode(storage, config, (await storage.getGHII(ghii))!, { code: codeAt(-40) }, 'wrong');
    expect(fifth.ok ? '' : fifth.code).toBe('TOTP_LOCKED');
    const right = await checkSecondFactor(storage, config, (await storage.getGHII(ghii))!, { totp_code: codeAt() });
    expect(right.ok ? '' : right.code).toBe('TOTP_LOCKED');
  });
});
