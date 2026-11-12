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
 *
 *   An account made from an emailed invitation starts with the invited address unproven (APP-2: the
 *   inviter can be handed the link, so opening it proves nothing). A person who never typed the code
 *   that was mailed then had no way back in after a forgotten password. invitedRecoveryAddress names
 *   that address as a second one a reset code and the username may go to: the code reaches the
 *   mailbox the invitation was sent to, so whoever opened the link gets nothing from it, and the
 *   code coming back is the proof the account was missing.
 * @structure EMAIL_CHANGED_MESSAGE · recoveryAddressIs · provenRecoveryAddress · invitedRecoveryAddress ·
 *   accountsInvitedAt
 * @usage
 *   if (!(await recoveryAddressIs(storage, ghii, row.emailHash))) refuse 409 EMAIL_CHANGED
 *   const to = provenRecoveryAddress(ghiiRecord) ?? await invitedRecoveryAddress(storage, ghiiRecord); if (to) send(to, ...)
 * @version-history
 *   v1.1.0 — 2026-11-12 — invitedRecoveryAddress and accountsInvitedAt: an account made from an
 *     invitation recovers through the invited address it never confirmed (reported from an
 *     organisation node on 4.3.0).
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

type InvitationReads = Pick<Storage, 'listInvitationsByEmailHash' | 'getGHIIByEmailHash'>;

/**
 * The recovery address when an emailed invitation link that made this account was sent to it, or
 * null. The evidence is a link invitation to exactly this address, accepted by this account no
 * earlier than the account was made. Nothing else writes that record: an existing account accepts
 * only with this address already proven, and an address written onto the account later (PUT /v1/ghii
 * takes one from any principal of the owner) has no such invitation, so it never qualifies. Null too
 * when another account holds the address, which stays that account's.
 *
 * A code key never qualifies: its minter chose the address and knows the key, and the holder's own
 * credentials must not be reachable from the minter's side (secaudit2026nov08,
 * attach-email:pending-code-key-accepts-any-address).
 *
 * ACCEPTED RISK (Jouni, 2026-11-12): an inviter who invites an address of their own and hands the
 * link to someone else can reset the account that person makes, while its address stays unproven.
 * The accept page shows the invited address, and asks for its code before it leaves.
 */
export async function invitedRecoveryAddress(
  storage: InvitationReads,
  rec: Pick<GHIIRecord, 'notificationEmail' | 'username' | 'ghii' | 'createdAt'> | null | undefined,
): Promise<string | null> {
  if (!rec?.notificationEmail) return null;
  const hash = emailHashOf(rec.notificationEmail);
  const invitations = await storage.listInvitationsByEmailHash(hash, { status: 'accepted' });
  // The account's own invitation: a name freed by an erased account and taken again does not
  // inherit the invitation the erased account accepted.
  const madeAt = Date.parse(rec.createdAt);
  const madeBy = invitations.some(inv => inv.type !== 'code' && inv.acceptedBy === rec.username
    && !!inv.acceptedAt && Date.parse(inv.acceptedAt) >= madeAt);
  if (!madeBy) return null;
  const holder = await storage.getGHIIByEmailHash(hash);
  if (holder && holder.ghii !== rec.ghii) return null;
  return rec.notificationEmail;
}

/**
 * The accounts that invitedRecoveryAddress names `email` for: the accounts accepted invitations to it
 * made, each still naming it unproven. The username reminder finds an account by its proven address
 * hash, which these accounts do not have yet.
 */
export async function accountsInvitedAt(
  storage: InvitationReads & Pick<Storage, 'getGHII'>, nodeId: string, email: string,
): Promise<GHIIRecord[]> {
  const invitations = await storage.listInvitationsByEmailHash(emailHashOf(email), { status: 'accepted' });
  const names = [...new Set(invitations.map(inv => inv.acceptedBy).filter((n): n is string => !!n))].slice(0, 5);
  const found: GHIIRecord[] = [];
  for (const name of names) {
    const rec = await storage.getGHII(`${name}@${nodeId}`);
    if (rec && await invitedRecoveryAddress(storage, rec)) found.push(rec);
  }
  return found;
}
