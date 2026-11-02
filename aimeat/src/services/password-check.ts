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
 *   checkTotpManagementCode(storage, config, record, codes, wrongMessage) ·
 *   checkEnrolmentCode(storage, config, record, pendingSecret, code)
 * @usage
 *   const pw = await checkPassword(storage, config, ghiiRecord, password);
 *   if (!pw.ok) { res.status(pw.status).json(error(config.nodeId, pw.code, pw.message)); return; }
 * @version-history
 *   2026-11-02 — checkEnrolmentCode: the first code of a required two-step enrolment, against the
 *     pending secret, with the TOTP lock (IT review, required two-step sign-in).
 *   2026-10-31 — An attempt is counted BEFORE the password or code is compared (reserveAttempt), in one
 *     conditional write on the attempts record, which now also carries the lock it set; the lock was
 *     read from the account record the request read at its start and the count written after the
 *     compare, so guesses sent at the same moment were each compared past the lock. A count that
 *     cannot be written is a refusal, not an uncounted compare (secaudit2026oct31w2 round 10, W2-10).
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
import { logger } from '../utils/logger.js';

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

/**
 * The attempts record: the count, and since 2026-10-31 the lock it set (`lockedUntil`, ISO). A
 * record written before then has no lock; its lock is the account record's, read by the caller.
 */
type Attempts = { count: number | null; lockedUntil: string | null };
const parseAttempts = (v: unknown): Attempts => {
  const until = (v as { lockedUntil?: unknown } | null | undefined)?.lockedUntil;
  return { count: parseCount(v), lockedUntil: typeof until === 'string' && until ? until : null };
};
const lockHolds = (until: string | null, now: number): boolean => !!until && now < new Date(until).getTime();

/** What reserveAttempt answers: the count with this attempt (and the lock it wrote, if any), or the lock that holds. */
type Reservation = { reserved: number; lockedUntil: string | null } | { locked: string };

/**
 * Count one attempt BEFORE the secret is compared, in one conditional write on the attempts record,
 * and answer whether it may be compared: `{ reserved: count }`, or `{ locked: until }` when the lock
 * holds or this attempt is past the limit. Requests sent at the same moment each write on the
 * record's version, so the limit bounds the attempts that are compared, not only the ones counted
 * afterwards (secaudit2026oct31w2, W2-10). The attempt that reaches the limit writes the lock and is
 * still compared, as the last allowed guess always was. A count that could not be written after
 * every retry is answered as locked: an attempt that was not counted is not compared.
 */
async function reserveAttempt(
  storage: Storage, ns: string, ghii: string, seed: number | undefined, max: number, lockMs: number,
): Promise<Reservation> {
  let outcome: Reservation = { locked: '' };
  try {
    await updateRecord(storage, ns, ghii, parseAttempts, (cur) => {
      const now = Date.now();
      if (cur.lockedUntil && lockHolds(cur.lockedUntil, now)) { outcome = { locked: cur.lockedUntil }; return UNCHANGED; }
      // A lock of this record that has run out starts the count again.
      const base = cur.lockedUntil ? 0 : (cur.count ?? seed ?? 0);
      const lockedUntil = new Date(now + lockMs).toISOString();
      if (base >= max) { outcome = { locked: lockedUntil }; return { count: base, lockedUntil }; }
      const lock = base + 1 >= max ? lockedUntil : null;
      outcome = { reserved: base + 1, lockedUntil: lock };
      return { count: base + 1, lockedUntil: lock };
    }, { tag: ns });
  } catch (err) {
    // updateRecord gave up after CAS_ATTEMPTS conflicts: other attempts are being counted right now.
    // The answer is a refusal, so the attempt that could not be counted is not compared either.
    logger.warn('password-check: an attempt could not be counted and was refused', { ns, ghii, error: String(err) });
    return { locked: new Date(Date.now() + 1000).toISOString() };
  }
  return outcome;
}

async function clearAttempts(storage: Storage, ns: string, ghii: string): Promise<void> {
  await updateRecord(storage, ns, ghii, parseAttempts,
    cur => (cur.count || cur.lockedUntil ? { count: 0, lockedUntil: null } : UNCHANGED), { tag: ns });
}

/**
 * Clear the count after the account record's lock ran out, unless the attempts record holds a lock
 * of its own that has not: the account record the caller read may be older than that lock.
 */
async function clearExpiredAttempts(storage: Storage, ns: string, ghii: string): Promise<void> {
  await updateRecord(storage, ns, ghii, parseAttempts,
    cur => (lockHolds(cur.lockedUntil, Date.now()) || (!cur.count && !cur.lockedUntil) ? UNCHANGED : { count: 0, lockedUntil: null }), { tag: ns });
}

async function resetAttempts(storage: Storage, ghii: string): Promise<void> {
  await clearAttempts(storage, ATTEMPTS_NS, ghii);
}

const passwordLocked = (until: string): CheckRefusal => ({ ok: false, status: 429, code: 'PASSWORD_LOCKED',
  message: `Account temporarily locked due to too many failed login attempts. Try again after ${until}` });

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
    if (Date.now() < lockExpires) return passwordLocked(rec.passwordLockedUntil);
    await storage.updateGHII(rec.ghii, { passwordFailedAttempts: 0, passwordLockedUntil: null });
    await clearExpiredAttempts(storage, ATTEMPTS_NS, rec.ghii);
    rec.passwordFailedAttempts = 0;
    rec.passwordLockedUntil = undefined;
  }

  // The attempt is counted before the verify, so guesses sent at the same moment are bounded by the
  // lock too; a right password clears the count below.
  const slot = await reserveAttempt(storage, ATTEMPTS_NS, rec.ghii, rec.passwordFailedAttempts,
    config.passwordLockoutAttempts, config.passwordLockoutMinutes * 60_000);
  if ('locked' in slot) return passwordLocked(slot.locked);

  if (!await verifyPassword(password, rec.passwordHash)) {
    const update: Record<string, unknown> = { passwordFailedAttempts: slot.reserved };
    if (slot.lockedUntil) update.passwordLockedUntil = slot.lockedUntil;
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

  if (!totp_code && !backup_code) {
    return { ok: false, status: 401, code: 'TOTP_REQUIRED',
      message: 'This account uses two-step sign-in. Enter the code from your app, or one of your backup codes.' };
  }
  // Replay protection: reject if same code was just used
  if (totp_code && rec.totpLastUsedCode === totp_code) {
    return { ok: false, status: 401, code: 'TOTP_REPLAY', message: 'This TOTP code has already been used. Wait for the next code.' };
  }

  const slot = await reserveTotpAttempt(storage, config, rec);
  if ('locked' in slot) return totpLocked(slot.locked);

  let verified = false;

  if (totp_code) {
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

  return totpWrongCode(storage, rec, slot, 'Invalid TOTP code or backup code.');
}

const totpLocked = (until: string): CheckRefusal => ({ ok: false, status: 429, code: 'TOTP_LOCKED',
  message: `Account temporarily locked due to too many failed TOTP attempts. Try again after ${until}` });

/** The refusal while the account's TOTP lock holds, or null; a lock that has run out is cleared. */
async function totpLockRefusal(storage: Storage, rec: GHIIRecord): Promise<CheckRefusal | null> {
  if (!rec.totpLockedUntil) return null;
  if (Date.now() < new Date(rec.totpLockedUntil).getTime()) return totpLocked(rec.totpLockedUntil);
  // Lock expired — reset counters
  await storage.updateGHII(rec.ghii, { totpFailedAttempts: 0, totpLockedUntil: null });
  await clearExpiredAttempts(storage, TOTP_ATTEMPTS_NS, rec.ghii);
  rec.totpFailedAttempts = 0;
  rec.totpLockedUntil = undefined;
  return null;
}

/**
 * Clear the wrong-code count and its lock, for the removal of the factor (services/totp-recovery.ts
 * eraseTotp): a factor armed again starts with no count, as the account record's fields always did.
 */
export async function clearTotpAttempts(storage: Storage, ghii: string): Promise<void> {
  await clearAttempts(storage, TOTP_ATTEMPTS_NS, ghii);
}

/** Count one code before it is compared (reserveAttempt), with the TOTP limit and lock length. */
function reserveTotpAttempt(storage: Storage, config: TotpCheckConfig, rec: GHIIRecord): Promise<Reservation> {
  return reserveAttempt(storage, TOTP_ATTEMPTS_NS, rec.ghii, rec.totpFailedAttempts,
    config.totpMaxFailedAttempts, config.totpLockoutSeconds * 1000);
}

/**
 * Answer a wrong code that was counted before the compare: TOTP_LOCKED when it reached the limit,
 * else INVALID_TOTP with `message`. The account record's fields are written from the count, for
 * every reader of the account.
 */
async function totpWrongCode(
  storage: Storage, rec: GHIIRecord, slot: { reserved: number; lockedUntil: string | null }, message: string,
): Promise<CheckRefusal> {
  const lockUntil = slot.lockedUntil ?? undefined;
  await storage.updateGHII(rec.ghii, { totpFailedAttempts: slot.reserved, totpLockedUntil: lockUntil });
  if (lockUntil) {
    return { ok: false, status: 429, code: 'TOTP_LOCKED',
      message: `Too many wrong codes, so this account is paused until ${lockUntil}. Wait until then and try again.` };
  }
  return { ok: false, status: 401, code: 'INVALID_TOTP', message };
}

/**
 * The first code of a required two-step enrolment (routes/ghii/login-two-step.ts), checked against
 * the secret the setup made (`pendingSecret`, encrypted), with the account's TOTP lock: a wrong code
 * counts toward it, and while it holds no code is accepted. No code answers INVALID_INPUT and counts
 * nothing.
 */
export async function checkEnrolmentCode(
  storage: Storage, config: TotpCheckConfig, rec: GHIIRecord, pendingSecret: string, code: unknown,
): Promise<CheckResult> {
  if (typeof code !== 'string' || !code.trim()) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'code is required: the six digits your authenticator app shows.' };
  const locked = await totpLockRefusal(storage, rec);
  if (locked) return locked;
  const slot = await reserveTotpAttempt(storage, config, rec);
  if ('locked' in slot) return totpLocked(slot.locked);
  if (!validateTotpCode(pendingSecret, code.trim(), totpConfigOf(config)).valid) {
    return totpWrongCode(storage, rec, slot, 'That code does not match. Check the app and try again.');
  }
  if (rec.totpFailedAttempts) await storage.updateGHII(rec.ghii, { totpFailedAttempts: 0, totpLockedUntil: null });
  await clearAttempts(storage, TOTP_ATTEMPTS_NS, rec.ghii);
  return { ok: true };
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
  const slot = await reserveTotpAttempt(storage, config, rec);
  if ('locked' in slot) return totpLocked(slot.locked);
  const verified = (!!code && !!rec.totpSecret && validateTotpCode(rec.totpSecret, code, totpConfigOf(config)).valid)
    || (!!backup && !!rec.totpBackupCodes && validateBackupCode(backup, rec.totpBackupCodes).valid);
  if (!verified) return totpWrongCode(storage, rec, slot, wrongMessage);
  if (rec.totpFailedAttempts) await storage.updateGHII(rec.ghii, { totpFailedAttempts: 0, totpLockedUntil: null });
  await clearAttempts(storage, TOTP_ATTEMPTS_NS, rec.ghii);
  return { ok: true };
}
