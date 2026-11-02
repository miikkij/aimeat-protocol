/**
 * @file src/services/owner-mail-address.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The address the node may mail an account's own content to: its notification address
 *   when the account proved it (emailVerifiedAt). Any principal of the owner holding
 *   memory:write-reserved may set notification_email, and a new address arrives unverified
 *   (routes/ghii/profile.ts), so an unverified address can be somebody else's. A mail that carries
 *   text a principal wrote (a task result, an automation report, a living document's stop reason, an
 *   agreement step) goes only to the proven address, as notification-create.ts mailOwner,
 *   permission-ask-notice.ts and notification-sweeps.ts already required (secaudit2026nov02d round 13).
 * @structure verifiedNotificationEmail · notificationEmailUnverified
 * @usage const to = verifiedNotificationEmail(await storage.getGHII(ghii)); if (to) send(to, ...)
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (secaudit2026nov02d round 13, delivery group).
 */
import type { GHIIRecord } from '../storage/interface.js';

type AddressFields = Pick<GHIIRecord, 'notificationEmail' | 'emailVerifiedAt'>;

/** The notification address when the account proved it, else null. */
export function verifiedNotificationEmail(rec: Partial<AddressFields> | null | undefined): string | null {
  return rec?.notificationEmail && rec.emailVerifiedAt ? rec.notificationEmail : null;
}

/** True when the account names a notification address it has not proved yet. */
export function notificationEmailUnverified(rec: Partial<AddressFields> | null | undefined): boolean {
  return !!rec?.notificationEmail && !rec.emailVerifiedAt;
}
