/**
 * @file src/commerce/membership-end.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A refund ends the membership it paid for. The seller refunds in their own Stripe
 *   dashboard, and Stripe reports `charge.refunded` to the seller's own webhook
 *   (routes/commerce-webhooks.ts), which calls endMembershipsByCharge with the payment references the
 *   event names. Every membership one of them paid for, and only among this seller's sales, ends now:
 *
 *   - a membership bought on this node's checkout (commerce/membership-sale.ts): its subscription
 *     stops renewing and ends today, marked `refunded_at`, and the member row goes with its grants;
 *   - a membership sold on the seller's own Stripe (commerce/membership-stripe.ts): the member row
 *     whose paid term names the payment goes with its grants;
 *   - an invitation that carries a paid term the payment bought, which nobody accepted yet: it is deleted.
 *
 *   The member is told the membership ended because the payment was refunded, and the app's audit log
 *   gets the removal. The seller who refunded is the one webhook that can reach this, so a seller's
 *   refund never touches another seller's members.
 * @structure removePaidMember · endMembershipsByCharge
 * @usage const ended = await endMembershipsByCharge(storage, config, sellerGhii, ['pi_…', 'ch_…']);
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-sovelluksen-j-senyyden-voi-myyd-maksu-uusinta-ja-p-ttyminen-).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { SUBSCRIPTION_PREFIX, updateSubscription, type SubscriptionRecord } from './subscriptions.js';
import { MEMBERSHIP_EXT_PREFIX } from './membership-sale.js';
import { listOwnerSalePlans, listMembers, removeMember, accountOf, type AppMemberRecord } from '../services/app/members.js';
import { listInvites, removeInvite } from '../services/app/member-invites.js';
import { syncGrantsForMember } from '../services/grant-sync.js';
import { sendMemberNotice } from '../services/app/member-notices.js';
import { memberAddress, appDeepLink, appStem } from '../services/app/member-approve.js';
import { recordAppAudit } from '../services/app/audit.js';
import { localAccountName } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { UNCHANGED } from '../services/record-cas.js';
import { logger } from '../utils/logger.js';

/**
 * Remove a member whose payment came back: the row, the grants it carried, a notice and an audit row.
 * Answers whether there was a row to remove.
 */
export async function removePaidMember(
  storage: Storage, config: AimeatConfig, appId: string, principal: string, why: { by: string; reference: string },
): Promise<boolean> {
  const [owner = '', filename = ''] = appId.split('/');
  const gone: AppMemberRecord | null = await removeMember(storage, appId, principal);
  if (!gone) return false;
  const account = accountOf(principal);
  await syncGrantsForMember(storage, {
    providerOwner: owner.toLowerCase(), providerGhii: `${owner}@${config.nodeId}`,
    consumer: memberAddress(account, config.nodeId), appId, role: gone.role, offeringIds: [],
    note: 'membership payment refunded',
  });
  await sendMemberNotice(storage, memberAddress(account, config.nodeId), 'refunded', { app: appStem(filename), role: gone.role }, { link: appDeepLink(appId) });
  await recordAppAudit(storage, {
    ownerGhii: `${owner}@${config.nodeId}`, filename, by: why.by, action: 'member.removed',
    detail: { account, from: gone.role || null, to: null, via: 'refund', reference: why.reference },
  });
  return true;
}

/**
 * End every membership one of `refs` paid for, among the sales of `sellerGhii`. Answers how many
 * ended. Never throws for one membership: each is ended or logged on its own.
 */
export async function endMembershipsByCharge(
  storage: Storage, config: AimeatConfig, sellerGhii: string, refs: string[],
): Promise<number> {
  const wanted = new Set(refs.filter(r => typeof r === 'string' && r));
  if (!wanted.size) return 0;
  const named = (charges: string[] | undefined) => (charges ?? []).find(c => wanted.has(c));
  let ended = 0;

  // Bought on this node's checkout: the buyer's subscription record names the payment.
  for (let offset = 0; ; ) {
    const page = await storage.listAllMemory({ prefix: `${SUBSCRIPTION_PREFIX}${MEMBERSHIP_EXT_PREFIX}`, limit: 1000, offset });
    for (const row of page.items) {
      const sub = row.value as SubscriptionRecord | null;
      if (!sub || sub.kind !== 'membership' || sub.seller_ghii !== sellerGhii || sub.refunded_at || !sub.app) continue;
      // Only the record the node wrote under the buyer's own identity: a value of the same shape
      // under any other namespace names nobody this refund may remove.
      if (row.ownerGaii !== sub.buyer_ghii) continue;
      const ref = named(sub.charges);
      if (!ref) continue;
      try {
        const at = new Date().toISOString();
        await updateSubscription(storage, sub.buyer_ghii, sub.ext, sub.plan, cur => (cur && !cur.refunded_at
          ? { ...cur, auto_renew: false, active_until: at, refunded_at: at, updated_at: at } : UNCHANGED));
        await removePaidMember(storage, config, sub.app, sub.buyer_ghii, { by: sellerGhii, reference: ref });
        emitChange('commerce', sub.buyer_ghii);
        ended++;
      } catch (err) {
        logger.error('membership-end: a refunded membership could not be ended', { app: sub.app, buyer: sub.buyer_ghii, error: String(err) });
      }
    }
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }

  // Sold on the seller's own Stripe: the member row's paid term names the payment; and an
  // invitation that carries a paid term nobody accepted yet.
  for (const plan of await listOwnerSalePlans(storage, localAccountName(sellerGhii))) {
    for (const m of await listMembers(storage, plan.appId)) {
      const ref = m.paid?.via === 'stripe' ? named(m.paid.charges) : undefined;
      if (!ref) continue;
      try {
        if (await removePaidMember(storage, config, plan.appId, m.owner, { by: sellerGhii, reference: ref })) ended++;
      } catch (err) {
        logger.error('membership-end: a refunded outside sale could not be ended', { app: plan.appId, member: m.owner, error: String(err) });
      }
    }
    for (const inv of await listInvites(storage, plan.appId)) {
      if (!inv.paid || !named(inv.paid.charges)) continue;
      await removeInvite(storage, plan.appId, inv.emailHash);
      ended++;
    }
  }
  return ended;
}
