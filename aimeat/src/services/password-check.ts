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
 *   checkSecondFactor(storage, config, record, codes) ·
 *   checkTotpManagementCode(storage, config, record, codes, wrongMessage)
 * @usage
 *   const pw = await checkPassword(storage, config, ghiiRecord, password);
 *   if (!pw.ok) { res.status(pw.status).json(error(config.nodeId, pw.code, pw.message)); return; }
 * @version-history
 *   2026-10-25 — checkTotpManagementCode: removing the factor and replacing its backup codes check the
 *     code with the TOTP lock, and a wrong code counts toward it. The wrong-code count is an increment
 *     on a record of its own (totp-attempts), like the password's, for the sign-in too; it was the
 *     account record's count plus one, so codes guessed at the same moment did not add up
 *     (secaudit2026oct22, totp-code-check-without-lock-or-replay).
 *   v1.1.0 — 2026-10-18 — The failed-attempt count is an increment on a record of its own, written on
 *     the record's version, and the lock is decided from the count written. It was the account
 *     record's count plus one, read before the verify, so wrong guesses sent at the same moment each
 *     wrote 1 and never reached the lock (wish-rahapolkujen-kilpatilanteet).
 *   v1.0.1 — 2026-10-09 — The TOTP check reads the node's general key too (services/totp.ts reads a
 *     secret under either key; secrets audit 2026-10-09, S4).
 *   v1.0.0 — 2026-10-05 — Initial: the sign-in route's password and TOTP blocks, moved here unchanged,
 *     and the attach-email copy of the lock (secaudit 2026-10, D1 and C1).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord } from '../storage/interface.js';
import { hashPassword, verifyPassword, isLegacyHash } from './password.js';
import { validateTotpCode, validateBackupCode, totpConfigOf } from './totp.js';
import { updateRecord, UNCHANGED } from './record-cas.js';

export type CheckRefusal = { ok: false; status: number; code: string; message: string };
export type CheckResult = { ok: true } | CheckRefusal;

type PasswordConfig = Pick<AimeatConfig, 'passwordLockoutAttempts' | 'passwordLockoutMinutes'>;
type TotpCheckConfig = Pick<AimeatConfig, 'totpIssuer' | 'totpPeriod' | 'totpWindow' | 'totpBackupCodeCount'
  | 'totpSecretEncryptionKey' | 'encryptionKey' | 'totpMaxFailedAttempts' | 'totpLockoutSeconds'>;

const WRONG: CheckRefusal = { ok: false, status: 401, code: 'AUTH_REQUIRED', message: 'Invalid username or password' };

/**
 * The failed-attempt count, one record per account in a namespace of its own that no principal can
 * address, keyed by the GHII. It is changed only by updateRecord (services/record-cas.ts), which
 * writes on the record's version and re-reads on a conflict, so two wrong guesses at the same
 * moment count two. The account record's `passwordFailedAttempts` is written from it, for every
 * reader of the account; a count started before this record existed carries on from that field.
 */
const ATTEMPTS_NS = 'password-attempts';
const parseCount = (v: unknown): number | null => {
  const n = (v as { count?: unknown } | null | undefined)?.count;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
};

/** The wrong-TOTP-code count, kept the same way, for the sign-in and the factor's own routes alike. */
const TOTP_ATTEMPTS_NS = 'totp-attempts';

/** Add one failed attempt in `ns` and answer the count as written. `seed` is the account record's count. */
async function bumpAttempts(storage: Storage, ns: string, ghii: string, seed: number | undefined): Promise<number> {
  const written = await updateRecord(storage, ns, ghii, v => ({ count: parseCount(v) }),
    cur => ({ count: (cur.count ?? seed ?? 0) + 1 }), { tag: ns });
  return written.count ?? 0;
}

async function clearAttempts(storage: Storage, ns: string, ghii: string): Promise<void> {
  await updateRecord(storage, ns, ghii, v => ({ count: parseCount(v) }),
    cur => (cur.count ? { count: 0 } : UNCHANGED), { tag: ns });
}

/** Add one failed attempt and answer the count as written. */
async function countFailedAttempt(storage: Storage, rec: GHIIRecord): Promise<number> {
  return bumpAttempts(storage, ATTEMPTS_NS, rec.ghii, rec.passwordFailedAttempts);
}

async function resetAttempts(storage: Storage, ghii: string): Promise<void> {
  await clearAttempts(storage, ATTEMPTS_NS, ghii);
}

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
    await resetAttempts(storage, rec.ghii);
    rec.passwordFailedAttempts = 0;
    rec.passwordLockedUntil = undefined;
  }

  if (!await verifyPassword(password, rec.passwordHash)) {
    // The count is the one written by the increment, not the account record read before the
    // verify: wrong guesses sent at the same moment each add one, and the one that reaches the
    // limit sets the lock.
    const attempts = await countFailedAttempt(storage, rec);
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
  await resetAttempts(storage, rec.ghii);

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

  const locked = await totpLockRefusal(storage, rec);
  if (locked) return locked;

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
      await clearAttempts(storage, TOTP_ATTEMPTS_NS, rec.ghii);
    }
  }

  if (!verified && backup_code && rec.totpBackupCodes) {
    const backupResult = validateBackupCode(backup_code, rec.totpBackupCodes);
    if (backupResult.valid) {
      verified = true;
      const updatedCodes = [...rec.totpBackupCodes];
      updatedCodes.splice(backupResult.index, 1);
      await storage.updateGHII(rec.ghii, { totpBackupCodes: updatedCodes, totpFailedAttempts: 0, totpLockedUntil: null });
      await clearAttempts(storage, TOTP_ATTEMPTS_NS, rec.ghii);
    }
  }

  if (verified) return { ok: true };

  if (!totp_code && !backup_code) {
    return { ok: false, status: 401, code: 'TOTP_REQUIRED',
      message: 'This account uses two-step sign-in. Enter the code from your app, or one of your backup codes.' };
  }

  return totpWrongCode(storage, config, rec, 'Invalid TOTP code or backup code.');
}

/** The refusal while the account's TOTP lock holds, or null; a lock that has run out is cleared. */
async function totpLockRefusal(storage: Storage, rec: GHIIRecord): Promise<CheckRefusal | null> {
  if (!rec.totpLockedUntil) return null;
  if (Date.now() < new Date(rec.totpLockedUntil).getTime()) {
    return { ok: false, status: 429, code: 'TOTP_LOCKED',
      message: `Account temporarily locked due to too many failed TOTP attempts. Try again after ${rec.totpLockedUntil}` };
  }
  // Lock expired — reset counters
  await storage.updateGHII(rec.ghii, { totpFailedAttempts: 0, totpLockedUntil: null });
  await clearAttempts(storage, TOTP_ATTEMPTS_NS, rec.ghii);
  rec.totpFailedAttempts = 0;
  rec.totpLockedUntil = undefined;
  return null;
}

/**
 * Count one wrong code and answer it: TOTP_LOCKED when this one reached the limit, else INVALID_TOTP
 * with `message`. The count is the one written by the increment (bumpAttempts), so wrong codes sent at
 * the same moment each add one.
 */
async function totpWrongCode(storage: Storage, config: TotpCheckConfig, rec: GHIIRecord, message: string): Promise<CheckRefusal> {
  const attempts = await bumpAttempts(storage, TOTP_ATTEMPTS_NS, rec.ghii, rec.totpFailedAttempts);
  const lockUntil = attempts >= config.totpMaxFailedAttempts
    ? new Date(Date.now() + config.totpLockoutSeconds * 1000).toISOString()
    : undefined;
  await storage.updateGHII(rec.ghii, { totpFailedAttempts: attempts, totpLockedUntil: lockUntil });
  if (lockUntil) {
    return { ok: false, status: 429, code: 'TOTP_LOCKED',
      message: `Too many wrong codes, so this account is paused until ${lockUntil}. Wait until then and try again.` };
  }
  return { ok: false, status: 401, code: 'INVALID_TOTP', message };
}

/**
 * The code that removes the second factor (`code` or `backup_code`) or replaces its backup codes
 * (`code` only), with the sign-in's TOTP lock: a wrong code counts toward it, and while it holds no
 * code is accepted (secaudit2026oct22, totp-code-check-without-lock-or-replay). No replay test: the
 * person who has just signed in with a code may remove the factor with the same code
 * (test/e2e-totp-lifecycle.ts). A backup code is not spent here, because the removal erases them all.
 * Neither code given answers INVALID_TOTP with `wrongMessage` and counts nothing.
 */
export async function checkTotpManagementCode(
  storage: Storage, config: TotpCheckConfig, rec: GHIIRecord,
  codes: { code?: unknown; backup_code?: unknown }, wrongMessage: string,
): Promise<CheckResult> {
  const code = typeof codes.code === 'string' && codes.code ? codes.code : undefined;
  const backup = typeof codes.backup_code === 'string' && codes.backup_code ? codes.backup_code : undefined;
  if (!code && !backup) return { ok: false, status: 401, code: 'INVALID_TOTP', message: wrongMessage };
  const locked = await totpLockRefusal(storage, rec);
  if (locked) return locked;
  const verified = (!!code && !!rec.totpSecret && validateTotpCode(rec.totpSecret, code, totpConfigOf(config)).valid)
    || (!!backup && !!rec.totpBackupCodes && validateBackupCode(backup, rec.totpBackupCodes).valid);
  if (!verified) return totpWrongCode(storage, config, rec, wrongMessage);
  if (rec.totpFailedAttempts) await storage.updateGHII(rec.ghii, { totpFailedAttempts: 0, totpLockedUntil: null });
  await clearAttempts(storage, TOTP_ATTEMPTS_NS, rec.ghii);
  return { ok: true };
}
