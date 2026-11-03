/**
 * @file src/services/owner-mail-address.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one answer to "is this owner's address proven": the address the node may mail an
 *   account's own content to. Any principal of the owner holding memory:write-reserved may set
 *   notification_email, and a new address arrives unverified (routes/ghii/profile.ts), so an unproven
 *   address can be somebody else's. Every mail to the owner asks here: a mail that carries text a
 *   principal wrote (a task result, an automation report, a workflow report, a living document's stop
 *   reason, an agreement step) and the node's own mails on a cadence (the inactivity nudge, the
 *   onboarding rescue).
 *
 *   PROVEN means two things agree. The flag (emailVerifiedAt) says a code or link was confirmed, and
 *   the hash (emailHash) says which address it confirmed; the address the account names now must be
 *   that one, as services/recovery-address.ts provenRecoveryAddress compares them for the reset. Every
 *   path that sets the flag writes the hash in the same update (routes/ghii/web-verify.ts,
 *   routes/ghii/recovery.ts, services/owner-provisioning.ts), so a record with the flag and no hash
 *   is not written today; it is read on the flag alone, as before.
 *
 *   NOT THE ACCOUNT LEVEL. verificationLevel says how the account was verified (a code, a bank ID, an
 *   EUDI wallet, the operator), and a change of address leaves it as it was. A mail gate that reads it
 *   mails a new, unproven address (codebase analysis 2026-11-03, item A9); scripts/check-single-entry.ts
 *   rule verification-level-gate keeps such a gate from coming back.
 * @structure provenOwnerAddress · notificationEmailUnverified
 * @usage const to = provenOwnerAddress(await storage.getGHII(ghii)); if (to) send(to, ...)
 * @version-history
 *   v1.1.0 — 2026-11-04 — provenOwnerAddress replaces verifiedNotificationEmail and also compares the
 *     address with the proven hash; the inactivity nudge, the onboarding rescue, the digest sweep, the
 *     permission-ask notice, the extension mail and the workflow report ask it (codebase analysis
 *     2026-11-03, items A2 and A9).
 *   v1.0.0 — 2026-11-02 — Initial (secaudit2026nov02d round 13, delivery group).
 */
import { createHash } from 'node:crypto';
import type { GHIIRecord } from '../storage/interface.js';

type AddressFields = Pick<GHIIRecord, 'notificationEmail' | 'emailVerifiedAt' | 'emailHash'>;

/**
 * The hash the confirm paths store, as owner-provisioning.ts emailHashOf makes it. Written here
 * rather than imported: owner-provisioning.ts reaches most of the services, and every mail sender
 * imports this file, so the import closes dependency cycles (pnpm check:deps).
 */
const hashOf = (email: string): string => createHash('sha256').update(email.toLowerCase().trim()).digest('hex');

/**
 * The notification address when the account proved it (the flag is set, and the address is the one
 * the hash names), else null.
 */
export function provenOwnerAddress(rec: Partial<AddressFields> | null | undefined): string | null {
  if (!rec?.notificationEmail || !rec.emailVerifiedAt) return null;
  if (rec.emailHash && hashOf(rec.notificationEmail) !== rec.emailHash) return null;
  return rec.notificationEmail;
}

/** True when the account names a notification address it has not proved. */
export function notificationEmailUnverified(rec: Partial<AddressFields> | null | undefined): boolean {
  return !!rec?.notificationEmail && !provenOwnerAddress(rec);
}
