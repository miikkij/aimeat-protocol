/**
 * @file src/commerce/membership-deliver.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A paid membership whose buyer is known by an email address only: a purchase made
 *   without an account (commerce/membership-guest.ts) and a sale on the owner's own Stripe
 *   (commerce/membership-stripe.ts). One function delivers both, so the two cannot drift apart.
 *
 *   An address that belongs to a VERIFIED account of this node makes that account a member at once,
 *   to the paid end. Any other address gets an app invitation that carries the paid term
 *   (services/app/member-invites.ts PaidInvite): the email's link makes an account that is a member
 *   at once, and a purchase that renews then gets its subscription for that account. A purchase is
 *   an invitation, so the link works in the registration modes open, invite and oauth; `closed`
 *   stays closed (decision-app-membership-sale-a-purchase-is-an-invitation-closed-regis).
 *
 *   A later payment for the same address while the invitation is still open updates its paid term
 *   without mailing the address again.
 * @structure deliverPaidMembership
 * @usage const out = await deliverPaidMembership(storage, config, { appId, role, email, paid });
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-sovelluksen-j-senyyden-voi-myyd-maksu-uusinta-ja-p-ttyminen-).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { inviteEmailHash } from '../services/invitations.js';
import { getMember, accountOf } from '../services/app/members.js';
import { approveMember } from '../services/app/member-approve.js';
import {
  sendAppInvite, putInvite, inviteKey, NS_INVITE, memberPaidOf, type AppMemberInvite, type PaidInvite,
} from '../services/app/member-invites.js';
import { readAppRecord } from '../services/app/record-keys.js';
import { noticeLang } from '../services/app/member-notices.js';
import { resolveAppUrls } from '../services/app/urls.js';
import { displayPrefsFor } from '../services/display-prefs.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { startPaidMembership } from './membership-sale.js';

const UNCOUNTED = 'A paid membership: the buyer paid for it with this address, and one mail goes per purchase.';

/**
 * Make the person behind `email` a member of `appId` as `role` until `paid.until`. Answers
 * `member` (a verified account), `invited` (an invitation was mailed), `updated` (the open invitation
 * took the new paid term), `owner` (the address is the app owner's own) or `refused` (the approval
 * refused, e.g. every seat taken; the payment stays the seller's to refund).
 */
export async function deliverPaidMembership(
  storage: Storage, config: AimeatConfig,
  a: { appId: string; role: string; email: string; paid: PaidInvite },
): Promise<{ outcome: 'member' | 'invited' | 'updated' | 'owner' | 'refused'; emailSent?: boolean; detail?: string }> {
  const [owner = '', filename = ''] = a.appId.split('/');
  const ownerGhii = await resolveGhii(storage, owner, config);
  const hash = inviteEmailHash(a.email);
  const ghii = await storage.getGHIIByEmailHash(hash);
  if (ghii && ghii.emailVerifiedAt) {
    const account = accountOf(ghii.ghii);
    if (account === owner.toLowerCase()) return { outcome: 'owner' };
    // A term that runs further than the one paid for (the owner gave more) is kept.
    const live = await getMember(storage, a.appId, account);
    const keep = live && live.role === a.role && live.expiresAt && Date.parse(live.expiresAt) > Date.parse(a.paid.until);
    const until = keep ? live!.expiresAt! : a.paid.until;
    const r = await approveMember(storage, config.nodeId, {
      appId: a.appId, owner, filename, account, role: a.role,
      approvedBy: owner.toLowerCase(), by: ownerGhii, ownerGhii, expiresAt: until, notice: 'purchased',
      paid: memberPaidOf({ ...a.paid, until }),
      auditDetail: { via: 'purchase', ...(a.paid.purchase ? { purchase: a.paid.purchase } : {}), ...(a.paid.stripeSubscription ? { stripe: a.paid.stripeSubscription } : {}) },
    });
    if (!r.ok) return { outcome: 'refused', detail: r.code };
    await startPaidMembership(storage, config, { appId: a.appId, role: a.role, account, paid: { ...a.paid, until } });
    return { outcome: 'member' };
  }
  // An open invitation of the same address and role takes the new paid term without another mail.
  const open = (await readAppRecord(storage, NS_INVITE, inviteKey(a.appId, hash), a.appId))?.value as AppMemberInvite | undefined;
  if (open && open.role === a.role && Date.parse(open.expiresAt) > Date.now()) {
    await putInvite(storage, {
      appId: a.appId, emailHash: hash, emailShown: open.emailShown, role: a.role, note: open.note, invitedBy: open.invitedBy,
      paid: { ...a.paid, charges: [...new Set([...(open.paid?.charges ?? []), ...a.paid.charges])].slice(-24) },
      validDays: Math.max(7, Math.ceil((Date.parse(a.paid.until) - Date.now()) / 86_400_000)),
    });
    return { outcome: 'updated' };
  }
  const urls = await resolveAppUrls(config, storage, [{ owner, filename }]);
  const lang = noticeLang((await displayPrefsFor(storage, ownerGhii)).locale);
  const displayName = (await storage.getGHII(ownerGhii))?.displayName || owner;
  const sent = await sendAppInvite(storage, config, {
    appId: a.appId, filename, email: a.email, role: a.role, invitedBy: ownerGhii, inviterName: displayName,
    appUrl: Object.values(urls)[0] ?? `${config.baseUrl}/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}?mode=inline`,
    lang, paid: a.paid, uncounted: UNCOUNTED,
  });
  return { outcome: 'invited', emailSent: sent.emailSent };
}
