/**
 * @file src/services/totp-recovery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one thing an operator can do about a person locked out of their own second
 *   factor: remove it, so they can sign in with their password and set it up again.
 *
 *   WHY THIS EXISTS. Removing two-step sign-in through /v1/ghii/totp needs a current code or an
 *   unused backup code, which is exactly what the locked-out person does not have. Until now there
 *   was no other door, so losing the phone and the backup codes ended the account: the knowledge
 *   stayed and nobody could reach it. That is a worse outcome than the one the factor prevents.
 *
 *   WHAT IT IS NOT. It does not sign anyone in and it hands nothing to the operator. The password
 *   still stands; this only takes the second step away. An operator who wanted the account could
 *   already deactivate it, so this adds no power they did not have — but it is loud where that one
 *   is quiet, because a factor disappearing without the owner's knowledge is precisely the thing a
 *   factor is meant to make impossible.
 *
 *   IT LEAVES A TRACE THE OWNER READS. An account event on the TARGET, naming the operator, plus a
 *   warning in the node's log. The event is written before the response, so a reset that the person
 *   is never told about cannot be reported as done.
 *
 *   AND NEVER ON YOURSELF. The owner's own door asks for a code; this one does not. An operator who
 *   could use it on their own account would hold a no-code removal of their own second factor,
 *   which is the factor not existing. Another operator resets them, or their backup codes do. Same
 *   line the deactivation door draws, and for the same reason.
 *
 * @structure
 *   - eraseTotp(storage, ghii): what "the factor is gone" means, for BOTH removal doors
 *   - TotpResetResult: ok, or the refusal with the status the door should answer
 *   - resetTotpByOperator(storage, target, byOwner, byGaii): the act, its refusals, and the record
 * @usage const r = await resetTotpByOperator(storage, 'alice', req.auth!.owner, identity);
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial. Closes the lock-out the TOTP routes shipped with in July 2026.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { recordAccountEvent } from './account-events.js';
import { logger } from '../utils/logger.js';

/**
 * Erase the second factor. ONE definition of what that means, because there are two doors to it —
 * the person's own removal, which asks for a code, and the operator reset below, which does not —
 * and a door that erased less than the other would leave an account somebody else can re-arm.
 *
 * Every field the factor is made of goes, not only the flag. Cleared with `null` rather than
 * `undefined`: postgres-kysely drops an undefined key from the UPDATE and would leave the secret in
 * the row, which is the trap in docs/pitfalls.md §7 that this same feature already walked into once.
 */
export async function eraseTotp(storage: Storage, ghii: string): Promise<void> {
  await storage.updateGHII(ghii, {
    totpEnabled: false,
    totpSecret: null,
    totpBackupCodes: null,
    totpLastUsedCode: null,
    totpLastUsedAt: null,
    totpFailedAttempts: 0,
    totpLockedUntil: null,
  } as unknown as Parameters<typeof storage.updateGHII>[1]);
}

export type TotpResetResult =
  | { ok: true; ghii: string }
  | { ok: false; status: number; code: string; message: string };

/** Take two-step sign-in off `target`'s account, on an operator's authority and without a code. */
export async function resetTotpByOperator(
  storage: Storage,
  target: string,
  byOwner: string,
  byGaii: string,
  config?: Pick<AimeatConfig, 'accountEventWindow'>,
): Promise<TotpResetResult> {
  if (target === byOwner) {
    return {
      ok: false, status: 400, code: 'INVALID_INPUT',
      message: 'You cannot reset your own two-step sign-in here. Use a backup code, or ask another operator.',
    };
  }

  const ghiiRecord = await storage.getGHIIByOwner(target);
  if (!ghiiRecord) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: `No account found for ${target}` };
  }

  if (!ghiiRecord.totpEnabled && !ghiiRecord.totpSecret) {
    return {
      ok: false, status: 400, code: 'TOTP_NOT_ENABLED',
      message: `${target} does not use two-step sign-in, so there is nothing to reset.`,
    };
  }

  await eraseTotp(storage, ghiiRecord.ghii);

  // Loud on purpose, in both places an operator's act can be read afterwards.
  logger.warn('Operator reset two-step sign-in', { target: ghiiRecord.ghii, by: byGaii });
  await recordAccountEvent(storage, {
    ownerGhii: ghiiRecord.ghii,
    kind: 'two_factor_reset_by_operator',
    actorGaii: byGaii,
    data: { operator: byOwner },
    link: '/v1/profile?tab=security',
    subject: 'two-factor',
  }, config);

  return { ok: true, ghii: ghiiRecord.ghii };
}
