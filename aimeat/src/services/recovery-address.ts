/**
 * @file src/services/recovery-address.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which address of an account is proven, for the mails that open the account without a
 *   sign-in: the password reset code and the username reminder (secaudit2026oct26,
 *   email-confirm-binds-hash-not-current-recovery-address).
 *
 *   An account holds two fields: notificationEmail, the address mails go to, and emailHash with
 *   emailVerifiedAt, the address a code or link proved. They were bound only when notificationEmail
 *   was written, so a code confirmed after the address changed marked the new, unproven address as
 *   proven, and the reset mailed it. Here they are compared every time: a confirmation binds only
 *   the address that is the recovery address now, and the senders mail only an address whose hash
 *   is the proven one. The sign-in link already compared them (services/login-link.ts).
 * @structure EMAIL_CHANGED_MESSAGE · recoveryAddressIs · provenRecoveryAddress
 * @usage
 *   if (!(await recoveryAddressIs(storage, ghii, row.emailHash))) refuse 409 EMAIL_CHANGED
 *   const to = provenRecoveryAddress(ghiiRecord); if (to) send(to, ...)
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import type { Storage, GHIIRecord } from '../storage/interface.js';
import { emailHashOf } from './owner-provisioning.js';

/** The refusal when a code arrives for an address that is no longer the account's recovery address. */
export const EMAIL_CHANGED_MESSAGE = 'The address changed after this code was sent, so the code no longer proves it. '
  + 'Send a new code to the address you want to keep, and confirm that one.';

/**
 * Whether a code sent to the address with hash `emailHash` may mark the account's address proven:
 * true when the account's recovery address is that address, or the account has none to compare.
 */
export async function recoveryAddressIs(storage: Pick<Storage, 'getGHII'>, ghii: string, emailHash: string): Promise<boolean> {
  const rec = await storage.getGHII(ghii);
  if (!rec?.notificationEmail) return true;
  return emailHashOf(rec.notificationEmail) === emailHash;
}

/**
 * The recovery address when it is the address a code or link proved (its hash is emailHash), or
 * null: the only address an unauthenticated mail goes to. The reset asks emailVerifiedAt besides.
 */
export function provenRecoveryAddress(rec: Pick<GHIIRecord, 'notificationEmail' | 'emailHash'> | null | undefined): string | null {
  if (!rec?.notificationEmail || !rec.emailHash) return null;
  return emailHashOf(rec.notificationEmail) === rec.emailHash ? rec.notificationEmail : null;
}
