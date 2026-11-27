/**
 * @file src/commerce/membership-sale.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Selling a role of an app's member plan: the checkout line kind `membership`, and the
 *   subscription source that renews it.
 *
 *   THE PRICE is the app owner's: the carry plan's `sale[role]` (services/app/members.ts RoleSale), with
 *   the period in `terms[role].days`. The seller is the app's owner, paid on their own payment setup,
 *   as every priced line is.
 *
 *   A PURCHASE is a checkout line `{ kind: 'membership', app: 'owner/file.html', tool: <role> }`, with
 *   `input.auto_renew` (default true; a one-time role never renews). Completing it writes the buyer's
 *   subscription record (commerce/subscriptions.ts, ext `app~<app key segment>`, plan = the role) and
 *   approves the buyer into the role through the roster's own approval (services/app/member-approve.ts:
 *   the seat cap, the carry plan's grants, the notice, the audit row) with the end date the record
 *   holds. A purchase made while a term of the same role runs continues from its end. The buyer never
 *   names a date: both come from the record this file writes.
 *
 *   RENEWAL, CANCEL, A FAILED CHARGE AND A RAISED PRICE are commerce/subscriptions.ts's, the same as for
 *   an extension's plan: this file is the `membership` source it reads. A renewal moves the member's
 *   end date in the same transaction as the period, so the two are one date. A cancel marks the
 *   membership as not renewing; the paid period runs to its end, and the clock ends the membership.
 *
 *   NO PLATFORM FEE: a person selling a membership of their own app to a person is not traffic between
 *   agents (the operator's line of 2026-11-23), so the line says `platformFee: false` and the renewal's
 *   source is fee-free.
 * @structure MEMBERSHIP_EXT_PREFIX · membershipExt · appIdOfMembershipExt · readSoldRole ·
 *   grantPaidMembership · membershipSellableResolver · membershipSource · startPaidMembership
 * @usage
 *   registerSellableResolver(membershipSellableResolver());
 *   registerSubscriptionSource('membership', membershipSource);
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-sovelluksen-j-senyyden-voi-myyd-maksu-uusinta-ja-p-ttyminen-).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Sellable, SavedPayment } from './types.js';
import type { SellableResolver } from './sellable-resolvers.js';
import { CommerceError } from './errors.js';
import { listPaymentHandlers } from './payment-handlers.js';
import { integerMicros } from './money.js';
import {
  updateSubscription, subscriptionKey, withCharge,
  type SubscriptionRecord, type SubscriptionPlan, type SubscriptionSource,
} from './subscriptions.js';
import {
  getCarryPlan, getMember, getMemberRow, seatsTaken, accountOf, updateMemberRow, type RoleSale,
} from '../services/app/members.js';
import { approveMember } from '../services/app/member-approve.js';
import type { PaidInvite } from '../services/app/member-invites.js';
import { appKeySegment } from '../services/app/record-keys.js';
import { appDisplayName, resolveOwnerAppRef } from '../services/app/app-ref.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { emitChange } from '../services/event-bus.js';
import { UNCHANGED } from '../services/record-cas.js';

const DAY_MS = 86_400_000;
const OWNER_RE = /^[A-Za-z0-9_-]{1,60}$/;
const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

/** The subscription record's `ext` for a membership of an app. `~` is in no extension name. */
export const MEMBERSHIP_EXT_PREFIX = 'app~';
export const membershipExt = (appId: string): string => `${MEMBERSHIP_EXT_PREFIX}${appKeySegment(appId)}`;

/** The app (`owner/file.html`) a membership record's `ext` names, or null for another ext. */
export function appIdOfMembershipExt(ext: string): string | null {
  const m = /^app~v2-([0-9a-f]+)$/.exec(ext);
  if (!m) return null;
  const id = Buffer.from(m[1]!, 'hex').toString('utf8');
  return id.includes('/') ? id : null;
}

/** A role the owner sells on this node's checkout, read whole. */
export interface SoldRole {
  appId: string; owner: string; filename: string; role: string;
  sale: RoleSale & { amount: number; currency: string };
  days: number;
  /** The role as a subscription plan: what the renewal charges and extends by. */
  plan: SubscriptionPlan;
  sellerGhii: string;
}

/**
 * The role `role` of the app `appRef` (`owner/file.html`, or `owner/file`) as its owner sells it now,
 * or the refusal: 404 APP_NOT_FOUND, 404 ROLE_NOT_FOR_SALE (no price on this node's checkout, or no period).
 */
export async function readSoldRole(storage: Storage, config: AimeatConfig, appRef: string, role: string): Promise<SoldRole> {
  const resolved = await resolveOwnerAppRef(storage, String(appRef ?? ''));
  const slash = resolved.indexOf('/');
  const owner = slash > 0 ? resolved.slice(0, slash) : '';
  const filename = slash > 0 ? resolved.slice(slash + 1) : '';
  if (!OWNER_RE.test(owner) || !FILENAME_RE.test(filename)) {
    throw new CommerceError('INVALID_ITEM', 400, 'membership items need app: "<owner>/<app file>" and tool: "<role>"');
  }
  const ownerGhii = await resolveGhii(storage, owner, config);
  if (!(await storage.getApp(ownerGhii, filename))) throw new CommerceError('APP_NOT_FOUND', 404, `No app ${owner}/${filename} on this node.`);
  const appId = `${owner}/${filename}`;
  const plan = await getCarryPlan(storage, appId);
  const sale = plan?.sale?.[role];
  const days = plan?.terms?.[role]?.days;
  if (!sale || typeof sale.amount !== 'number' || !sale.currency || !(typeof days === 'number' && days > 0)) {
    throw new CommerceError('ROLE_NOT_FOR_SALE', 404, `${appDisplayName(filename)} does not sell the role "${role}" on this node.`);
  }
  const title = `${appDisplayName(filename)} · ${role}`;
  return {
    appId, owner, filename, role, days, sellerGhii: ownerGhii,
    sale: { ...sale, amount: sale.amount, currency: sale.currency },
    plan: { id: role, title, amount: sale.amount, currency: sale.currency, period_days: days },
  };
}

/** What grantPaidMembership was given. */
export interface PaidMembershipArgs {
  sold: SoldRole;
  buyerGhii: string;
  /** The principal that bought (a person's GHII, or an agent's GAII the renewals are held to). */
  buyerIdentity?: string;
  autoRenew: boolean;
  keptPayment?: { handler: string } & SavedPayment;
  /** The payment reference a refund will name. */
  charge?: string;
  /** Where it was bought: `checkout:<id>`, `guest:<id>`. */
  order: string;
  /** The end of the paid period when the payment already fixed it (a paid invitation); else one period from the running end. */
  until?: string;
}

/**
 * Write the buyer's subscription record and approve them into the role until its end. The approval's
 * refusal (every seat taken) puts the record back as it was and is answered, so the checkout refunds.
 */
export async function grantPaidMembership(
  storage: Storage, config: AimeatConfig, a: PaidMembershipArgs,
): Promise<{ ok: true; until: string; autoRenew: boolean } | { ok: false; status: number; code: string; message: string }> {
  const { sold } = a;
  const account = accountOf(a.buyerGhii);
  const ext = membershipExt(sold.appId);
  const now = Date.now();
  const member = await getMember(storage, sold.appId, account);
  const at = new Date(now).toISOString();
  // Written on the record's version: two purchases of one role at the same moment each add a period.
  let before: SubscriptionRecord | null = null;
  const rec = (await updateSubscription(storage, a.buyerGhii, ext, sold.role, (cur) => {
    before = cur;
    const running = cur && !cur.refunded_at ? cur : null;
    // A term of the same role that still runs is continued from its end, whichever wrote it.
    const ends = [now,
      running ? Date.parse(running.active_until) : 0,
      member && member.role === sold.role && member.expiresAt ? Date.parse(member.expiresAt) : 0,
    ].filter(Number.isFinite);
    const until = a.until ?? new Date(Math.max(...ends) + sold.days * DAY_MS).toISOString();
    const kept = a.keptPayment ?? running?.kept_payment;
    return {
      kind: 'membership', app: sold.appId, role: sold.role,
      ext, plan: sold.role, title: sold.plan.title, seller_ghii: sold.sellerGhii, buyer_ghii: a.buyerGhii,
      amount: sold.sale.amount, currency: sold.sale.currency, period_days: sold.days,
      started_at: running ? running.started_at : at,
      active_until: until, auto_renew: a.autoRenew && !!kept,
      ...(a.buyerIdentity && a.buyerIdentity.includes('#') ? { bought_by: a.buyerIdentity } : {}),
      ...(kept ? { kept_payment: kept } : {}),
      last_order: a.order,
      charges: a.charge ? withCharge(cur?.charges, a.charge) : (cur?.charges ?? []),
      updated_at: at,
    };
  }))!;
  const until = rec.active_until;
  const approved = await approveMember(storage, config.nodeId, {
    appId: sold.appId, owner: sold.owner, filename: sold.filename, account, role: sold.role,
    approvedBy: sold.owner.toLowerCase(), by: a.buyerIdentity || a.buyerGhii, ownerGhii: sold.sellerGhii,
    expiresAt: until, notice: 'purchased',
    paid: { via: 'checkout', until, renews: rec.auto_renew, charges: rec.charges ?? [], at },
    auditDetail: { via: 'purchase', order: a.order },
  });
  if (!approved.ok) {
    // Nothing of the purchase stays: the record goes back to what it was, and the checkout refunds.
    const prior = before as SubscriptionRecord | null;
    if (prior) await updateSubscription(storage, a.buyerGhii, ext, sold.role, () => prior);
    else await storage.deleteMemory(a.buyerGhii, subscriptionKey(ext, sold.role));
    return { ok: false, status: approved.status, code: approved.code, message: approved.message };
  }
  emitChange('commerce', a.buyerGhii);
  return { ok: true, until, autoRenew: rec.auto_renew };
}

/** The refusals a buyer meets before anything is collected: the owner, a full role, another paid role. */
async function buyerRefusal(storage: Storage, sold: SoldRole, buyerAccount: string): Promise<CommerceError | null> {
  if (buyerAccount === sold.owner.toLowerCase()) {
    return new CommerceError('MEMBER_IS_OWNER', 409, 'You own this app, so you reach everything in it already.');
  }
  const live = await getMember(storage, sold.appId, buyerAccount);
  if (live && live.role !== sold.role && live.paid?.renews) {
    return new CommerceError('ROLE_HELD', 409, `You hold a renewing membership as ${live.role}. Cancel its renewal first, then buy ${sold.role}.`);
  }
  const cap = (await getCarryPlan(storage, sold.appId))?.seats?.[sold.role];
  if (typeof cap === 'number' && !(live && live.role === sold.role) && (await seatsTaken(storage, sold.appId, sold.role)) >= cap) {
    return new CommerceError('SEATS_FULL', 409, `Every "${sold.role}" seat of ${appDisplayName(sold.filename)} is taken.`);
  }
  return null;
}

/** The checkout line kind `membership`: one period of a role the app's owner sells. */
export function membershipSellableResolver(): SellableResolver {
  return {
    kind: 'membership',
    async resolve(storage, config, ref, buyerOwner): Promise<Sellable> {
      const role = ref.tool ?? ref.offer_id ?? '';
      if (!ref.app || !role) throw new CommerceError('INVALID_ITEM', 400, 'membership items need app: "<owner>/<app file>" and tool: "<role>"');
      if ((ref.quantity ?? 1) > 1) throw new CommerceError('INVALID_ITEM', 400, 'A membership is bought one period at a time.');
      const sold = await readSoldRole(storage, config, ref.app, role);
      const currency = ref.currency && ref.currency.toLowerCase() !== 'morsel' ? ref.currency.toUpperCase() : sold.sale.currency;
      if (currency !== sold.sale.currency) throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `This membership is priced in ${sold.sale.currency}, not ${currency}`);
      if (!listPaymentHandlers().some(h => h.currencies.includes(currency))) {
        throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `No payment handler on this node settles ${currency}`);
      }
      const refused = await buyerRefusal(storage, sold, accountOf(buyerOwner));
      if (refused) throw refused;
      const psp = (await storage.getMemory(sold.sellerGhii, 'commerce.psp'))?.value ?? undefined;
      return {
        kind: 'membership', agentGaii: sold.appId, agentName: sold.filename, offerId: role,
        title: `${sold.plan.title} (${sold.days} days)`, sellerOwner: sold.owner, sellerGhii: sold.sellerGhii,
        unitPrice: integerMicros(sold.sale.amount), tollMorsels: 0, psp,
        platformFee: false,
        async fulfill(ctx, { session, item, payment }) {
          const asked = (item.input as { auto_renew?: unknown } | undefined)?.auto_renew;
          const out = await grantPaidMembership(ctx.storage, ctx.config, {
            sold, buyerGhii: session.buyerGhii, buyerIdentity: session.buyerIdentity,
            autoRenew: sold.sale.renews && asked !== false,
            ...(payment?.saved ? { keptPayment: { handler: payment.handler, ...payment.saved } } : {}),
            ...(payment?.trackingCode ? { charge: payment.trackingCode } : {}),
            order: `checkout:${session.id}`,
          });
          if (!out.ok) throw new CommerceError(out.code, out.status, out.message);
          const membership = { app: sold.appId, role, until: out.until, auto_renew: out.autoRenew };
          return { result: { membership }, sellerResult: { membership } };
        },
      };
    },
  };
}

/** The subscription source of kind `membership` (commerce/subscriptions.ts). */
export const membershipSource: SubscriptionSource = {
  feeFree: true,
  async offer(storage, config, sub) {
    if (!sub.app || !sub.role || sub.refunded_at) return null;
    // A member the owner removed, or whose role changed, is not charged for the role any more.
    const row = await getMemberRow(storage, sub.app, sub.buyer_ghii);
    if (!row || row.role !== sub.role) return null;
    try {
      const sold = await readSoldRole(storage, config, sub.app, sub.role);
      return { plan: sold.plan, sellerOwner: sold.owner };
    } catch (err) {
      // The role is no longer sold, or the app is gone: nothing to renew. Anything else is a fault.
      if (err instanceof CommerceError && (err.code === 'ROLE_NOT_FOR_SALE' || err.code === 'APP_NOT_FOUND')) return null;
      throw err;
    }
  },
  async extended(storage, sub) {
    await updateMemberRow(storage, sub.app!, sub.buyer_ghii, cur => (cur && cur.role === sub.role ? {
      ...cur, expiresAt: sub.active_until, updatedAt: new Date().toISOString(),
      paid: { via: 'checkout', ...(cur.paid ?? {}), until: sub.active_until, renews: sub.auto_renew, charges: sub.charges ?? [], at: new Date().toISOString() },
    } : UNCHANGED));
  },
  async cancelled(storage, sub) {
    await updateMemberRow(storage, sub.app!, sub.buyer_ghii, cur => (cur?.paid && cur.role === sub.role
      ? { ...cur, paid: { ...cur.paid, renews: false }, updatedAt: new Date().toISOString() } : UNCHANGED));
  },
};

/**
 * A paid invitation became a membership (services/app/member-invites.ts): a purchase made without an
 * account that renews gets its subscription record for the new account, so the kept card renews it.
 * The membership itself is already approved to the paid end.
 */
export async function startPaidMembership(
  storage: Storage, config: AimeatConfig, args: { appId: string; role: string; account: string; paid: PaidInvite },
): Promise<void> {
  const { paid } = args;
  if (paid.via !== 'checkout' || !paid.keptPayment || typeof paid.amount !== 'number' || !paid.currency || !paid.periodDays) return;
  const buyerGhii = `${args.account}@${config.nodeId}`;
  const sellerGhii = await resolveGhii(storage, args.appId.split('/')[0] ?? '', config);
  const at = new Date().toISOString();
  await updateSubscription(storage, buyerGhii, membershipExt(args.appId), args.role, () => ({
    kind: 'membership', app: args.appId, role: args.role, ext: membershipExt(args.appId), plan: args.role,
    title: `${appDisplayName(args.appId.split('/')[1] ?? '')} · ${args.role}`,
    seller_ghii: sellerGhii, buyer_ghii: buyerGhii,
    amount: paid.amount!, currency: paid.currency!, period_days: paid.periodDays!,
    started_at: at, active_until: paid.until, auto_renew: paid.renews,
    kept_payment: paid.keptPayment!, last_order: `guest:${paid.purchase ?? ''}`, charges: paid.charges, updated_at: at,
  }));
  emitChange('commerce', buyerGhii);
}
