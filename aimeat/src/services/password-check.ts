/**
 * @file src/services/password-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one check of an account's password, and of its second factor, for every route that
 *   takes a password: the password sign-in (routes/ghii/register-login.ts), the email completion for
 *   an account short of verification (routes/ghii/attach-email.ts), and the home node's answer to a
 *   federated sign-in elsewhere (routes/federation-auth.ts).
 *
 *   Until 2026-10-05 the sign-in route and attach-email each wrote the lock out by hand, and the
 *   federation route checked the password with no lock and no second factor at all: it answered a
 *   wrong password 401 and a right one without consent 403, to any caller, as often as its per-IP
 *   limit allowed, and an account with two-step sign-in got a signed attestation on its password
 *   alone (secaudit 2026-10, D1). One function now holds the rule, so a door cannot be added that
 *   checks a password without the lock.
 *
 *   checkPassword(): no hash, the lock, the verify, the failed-attempt count and the lock it sets, the
 *   reset on success, and the move of an old scrypt hash to the current parameters.
 *   checkSecondFactor(): the TOTP lock, the TOTP code with replay protection, a backup code (spent
 *   when used), the failed-attempt count. An account without TOTP passes.
 *   Each answers `{ ok: true }` or a refusal the route sends as it is: status, code, message.
 * @structure CheckRefusal · checkPassword(storage, config, record, password) ·
 *   checkSecondFactor(storage, config, record, codes)
 * @usage
 *   const pw = await checkPassword(storage, config, ghiiRecord, password);
 *   if (!pw.ok) { res.status(pw.status).json(error(config.nodeId, pw.code, pw.message)); return; }
 * @version-history
 *   v1.0.1 — 2026-10-09 — The TOTP check reads the node's general key too (services/totp.ts reads a
 *     secret under either key; secrets audit 2026-10-09, S4).
 *   v1.0.0 — 2026-10-05 — Initial: the sign-in route's password and TOTP blocks, moved here unchanged,
 *     and the attach-email copy of the lock (secaudit 2026-10, D1 and C1).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord } from '../storage/interface.js';
import { hashPassword, verifyPassword, isLegacyHash } from './password.js';
import { validateTotpCode, validateBackupCode, totpConfigOf } from './totp.js';

export type CheckRefusal = { ok: false; status: number; code: string; message: string };
export type CheckResult = { ok: true } | CheckRefusal;

type PasswordConfig = Pick<AimeatConfig, 'passwordLockoutAttempts' | 'passwordLockoutMinutes'>;
type TotpCheckConfig = Pick<AimeatConfig, 'totpIssuer' | 'totpPeriod' | 'totpWindow' | 'totpBackupCodeCount'
  | 'totpSecretEncryptionKey' | 'encryptionKey' | 'totpMaxFailedAttempts' | 'totpLockoutSeconds'>;

const WRONG: CheckRefusal = { ok: false, status: 401, code: 'AUTH_REQUIRED', message: 'Invalid username or password' };

/**
 * Check `password` against the account's hash, with the per-account lock. An account with no
 * password answers NO_PASSWORD (400), which a route that must not say so maps to its own answer.
 */
export async function checkPassword(storage: Storage, config: PasswordConfig, rec: GHIIRecord, password: string): Promise<CheckResult> {
  if (!rec.passwordHash) {
    return { ok: false, status: 400, code: 'NO_PASSWORD', message: 'This account has no password set. Password login is not available.' };
  }

  // Per-account password lockout (brute-force protection)
  if (rec.passwordLockedUntil) {
    const lockExpires = new Date(rec.passwordLockedUntil).getTime();
    if (Date.now() < lockExpires) {
      return { ok: false, status: 429, code: 'PASSWORD_LOCKED',
        message: `Account temporarily locked due to too many failed login attempts. Try again after ${rec.passwordLockedUntil}` };
    }
    await storage.updateGHII(rec.ghii, { passwordFailedAttempts: 0, passwordLockedUntil: null });
    rec.passwordFailedAttempts = 0;
    rec.passwordLockedUntil = undefined;
  }

  if (!await verifyPassword(password, rec.passwordHash)) {
    const attempts = (rec.passwordFailedAttempts ?? 0) + 1;
    const update: Record<string, unknown> = { passwordFailedAttempts: attempts };
    if (attempts >= config.passwordLockoutAttempts) {
      update.passwordLockedUntil = new Date(Date.now() + config.passwordLockoutMinutes * 60_000).toISOString();
    }
    await storage.updateGHII(rec.ghii, update);
    return WRONG;
  }

  // Reset failed attempts on success
  if (rec.passwordFailedAttempts) {
    await storage.updateGHII(rec.ghii, { passwordFailedAttempts: 0, passwordLockedUntil: null });
  }

  // Transparent scrypt parameter upgrade (v1 -> v2)
  if (isLegacyHash(rec.passwordHash)) {
    await storage.updateGHII(rec.ghii, { passwordHash: await hashPassword(password) });
  }
  return { ok: true };
}

/**
 * The second factor of an account with TOTP on: a code from the app (never the same code twice in a
 * row) or one backup code, which is spent. Neither given answers TOTP_REQUIRED, so the caller can ask
 * the person for one; a wrong one counts toward the TOTP lock. An account without TOTP passes.
 */
export async function checkSecondFactor(
  storage: Storage, config: TotpCheckConfig, rec: GHIIRecord,
  codes: { totp_code?: unknown; backup_code?: unknown },
): Promise<CheckResult> {
  if (!rec.totpEnabled || !rec.totpSecret) return { ok: true };
  const totp_code = typeof codes.totp_code === 'string' && codes.totp_code ? codes.totp_code : undefined;
  const backup_code = typeof codes.backup_code === 'string' && codes.backup_code ? codes.backup_code : undefined;

  if (rec.totpLockedUntil) {
    const lockExpires = new Date(rec.totpLockedUntil).getTime();
    if (Date.now() < lockExpires) {
      return { ok: false, status: 429, code: 'TOTP_LOCKED',
        message: `Account temporarily locked due to too many failed TOTP attempts. Try again after ${rec.totpLockedUntil}` };
    }
    // Lock expired — reset counters
    await storage.updateGHII(rec.ghii, { totpFailedAttempts: 0, totpLockedUntil: null });
    rec.totpFailedAttempts = 0;
    rec.totpLockedUntil = undefined;
  }

  let verified = false;

  if (totp_code) {
    // Replay protection: reject if same code was just used
    if (rec.totpLastUsedCode === totp_code) {
      return { ok: false, status: 401, code: 'TOTP_REPLAY', message: 'This TOTP code has already been used. Wait for the next code.' };
    }
    if (validateTotpCode(rec.totpSecret, totp_code, totpConfigOf(config)).valid) {
      verified = true;
      await storage.updateGHII(rec.ghii, {
        totpLastUsedAt: new Date().toISOString(),
        totpLastUsedCode: totp_code,
        totpFailedAttempts: 0,
        totpLockedUntil: null,
      });
    }
  }

  if (!verified && backup_code && rec.totpBackupCodes) {
    const backupResult = validateBackupCode(backup_code, rec.totpBackupCodes);
    if (backupResult.valid) {
      verified = true;
      const updatedCodes = [...rec.totpBackupCodes];
      updatedCodes.splice(backupResult.index, 1);
      await storage.updateGHII(rec.ghii, { totpBackupCodes: updatedCodes, totpFailedAttempts: 0, totpLockedUntil: null });
    }
  }

  if (verified) return { ok: true };

  if (!totp_code && !backup_code) {
    return { ok: false, status: 401, code: 'TOTP_REQUIRED',
      message: 'This account uses two-step sign-in. Enter the code from your app, or one of your backup codes.' };
  }

  const attempts = (rec.totpFailedAttempts ?? 0) + 1;
  const lockUntil = attempts >= config.totpMaxFailedAttempts
    ? new Date(Date.now() + config.totpLockoutSeconds * 1000).toISOString()
    : undefined;
  await storage.updateGHII(rec.ghii, { totpFailedAttempts: attempts, totpLockedUntil: lockUntil });
  if (lockUntil) {
    return { ok: false, status: 429, code: 'TOTP_LOCKED',
      message: `Too many wrong codes, so this account is paused until ${lockUntil}. Wait until then and try again.` };
  }
  return { ok: false, status: 401, code: 'INVALID_TOTP', message: 'Invalid TOTP code or backup code.' };
}
