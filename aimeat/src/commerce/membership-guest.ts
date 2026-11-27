/**
 * @file src/commerce/membership-guest.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A membership bought by somebody with no account on this node: the sign-up and the
 *   payment are one path, and at its end the person is a member and the app opens.
 *
 *   1. openGuestPurchase (POST /v1/apps/:owner/:filename/membership/guest): the person gives the role
 *      and an email address; the node keeps a purchase record (`gm_…`, platform namespace
 *      `app-member-purchase`, private) and opens Stripe's own card page on the app owner's Stripe
 *      account for exactly the role's price, with the address filled in.
 *   2. completeGuestPurchase: when the person comes back (POST …/membership/guest/complete with the
 *      Stripe session id) or, when they never do, from the seller's webhook (stripe-checkout-complete.ts
 *      on `checkout.session.completed`). The payment is read back from Stripe (the card page handler's
 *      collect: paid, for this purchase, in this amount), never taken from the request.
 *   3. The paid membership goes to the address (commerce/membership-deliver.ts): a verified account is a
 *      member at once; any other address gets an invitation carrying the paid term and the kept card,
 *      and the account its link makes is a member and renews. The answer is the same in both cases,
 *      so the page tells nobody whether an address has an account here.
 *
 *   A purchase is an invitation: it is refused in registration mode `closed` and works in open,
 *   invite and oauth (decision-app-membership-sale-a-purchase-is-an-invitation-closed-regis).
 *
 *   A node that runs the test money rail (utils/test-money-guard.ts) completes a purchase with it, so
 *   the path is proven end to end in E2E without Stripe.
 *
 *   LIFECYCLE: an open purchase lives a day; sweepGuestPurchases (the hourly member sweep) deletes
 *   open ones past that and delivered ones after 30 days.
 * @structure NS_PURCHASE · GuestPurchase · isGuestMembershipId · openGuestPurchase ·
 *   completeGuestPurchase · sweepGuestPurchases
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-sovelluksen-j-senyyden-voi-myyd-maksu-uusinta-ja-p-ttyminen-).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CheckoutSessionRecord } from './types.js';
import { CommerceError } from './errors.js';
import { getPaymentHandler } from './payment-handlers.js';
import { STRIPE_CHECKOUT_HANDLER_ID, openStripeCheckout } from './stripe-checkout.js';
import { TEST_MONEY_HANDLER_ID } from './test-money-handler.js';
import { readSoldRole } from './membership-sale.js';
import { deliverPaidMembership } from './membership-deliver.js';
import { refundCollected, recordUndeliveredPayment } from './undelivered-payment.js';
import { inviteEmailHash } from '../services/invitations.js';
import { registrationRefusal } from '../services/owner/provisioning.js';
import { updateRecord, UNCHANGED } from '../services/record-cas.js';
import { equalAppId } from '../services/app/record-keys.js';
import { logger } from '../utils/logger.js';

export const NS_PURCHASE = 'app-member-purchase';
const KEY_PREFIX = 'appmempur.';
const OPEN_MS = 24 * 3_600_000;
const KEEP_DELIVERED_MS = 30 * 86_400_000;
const DAY_MS = 86_400_000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export interface GuestPurchase {
  id: string;
  appId: string;
  role: string;
  emailHash: string;
  /** The address as typed: the delivery mails it. Private, never answered back. */
  emailShown: string;
  amount: number;
  currency: string;
  days: number;
  renews: boolean;
  status: 'open' | 'delivered';
  /** The Stripe card pages the node opened for this purchase; only these complete it. */
  cardPages: string[];
  trackingCode?: string;
  outcome?: string;
  createdAt: string;
  expiresAt: string;
  deliveredAt?: string;
}

export const isGuestMembershipId = (id: string): boolean => /^gm_[a-f0-9]{24}$/.test(id);
const keyOf = (id: string) => `${KEY_PREFIX}${id}`;
const parse = (v: unknown): GuestPurchase | null => {
  const p = v as GuestPurchase | undefined;
  return p && typeof p.id === 'string' && typeof p.appId === 'string' ? p : null;
};

/** The purchase as Stripe's card page reads a checkout: the amount, the title, the metadata. */
function asCheckout(p: GuestPurchase, title: string): CheckoutSessionRecord {
  return {
    id: p.id, status: 'open', total: p.amount, currency: p.currency, buyerGhii: `guest:${p.id}`,
    items: [{ kind: 'membership', agent: p.appId, offerId: p.role, quantity: 1, title, unitPrice: p.amount, ...(p.renews ? { input: { auto_renew: true } } : {}) }],
    expiresAt: p.expiresAt, updatedAt: p.createdAt, createdAt: p.createdAt,
  } as unknown as CheckoutSessionRecord;
}

/** Open the purchase and its card page. `returnUrl` is where the person comes back with `stripe_session`. */
export async function openGuestPurchase(
  storage: Storage, config: AimeatConfig,
  a: { appRef: string; role: string; email: string; returnUrl: string; autoRenew?: boolean },
): Promise<{ purchase: string; url: string | null; testMoney?: true }> {
  const refusal = registrationRefusal(config, 'invitation');
  if (refusal) throw new CommerceError('REGISTRATION_CLOSED', 403, `${refusal} Sign in to buy a membership.`);
  const email = String(a.email ?? '').trim();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new CommerceError('INVALID_INPUT', 400, 'Give the email address the membership is for.');
  const sold = await readSoldRole(storage, config, a.appRef, a.role);
  const now = new Date();
  const p: GuestPurchase = {
    id: `gm_${randomUUID().replace(/-/g, '').slice(0, 24)}`, appId: sold.appId, role: sold.role,
    emailHash: inviteEmailHash(email), emailShown: email.slice(0, 254),
    amount: sold.sale.amount, currency: sold.sale.currency, days: sold.days,
    renews: sold.sale.renews && a.autoRenew !== false, status: 'open', cardPages: [],
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + OPEN_MS).toISOString(),
  };
  const psp = (await storage.getMemory(sold.sellerGhii, 'commerce.psp'))?.value ?? undefined;
  // The test money rail, where the node runs it, needs no card page: completion names the handler.
  const stripeReady = !!(psp as { secretKey?: unknown } | undefined)?.secretKey;
  if (!stripeReady && getPaymentHandler(TEST_MONEY_HANDLER_ID)) {
    await storage.setMemory(record(p));
    return { purchase: p.id, url: null, testMoney: true };
  }
  const page = await openStripeCheckout(config, asCheckout(p, `${sold.plan.title} (${sold.days} days)`), psp, a.returnUrl, { customerEmail: email });
  p.cardPages = [page.stripeSession];
  await storage.setMemory(record(p));
  return { purchase: p.id, url: page.url };
}

function record(p: GuestPurchase) {
  const now = new Date().toISOString();
  return {
    key: keyOf(p.id), ownerGaii: NS_PURCHASE, value: p as unknown as Record<string, unknown>, visibility: 'private' as const,
    tags: ['app-member'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  };
}

/**
 * Collect and deliver a guest purchase. `instrument` is the Stripe session id (`cs_…`), or, on a node
 * running the test money rail, that rail's instrument. Delivered already: answered as such, nothing
 * charged again. `sellerGhii`, when the seller's webhook calls, must be the app's owner.
 */
export async function completeGuestPurchase(
  storage: Storage, config: AimeatConfig, id: string, instrument: unknown, opts: { handler?: string; sellerGhii?: string; appId?: string } = {},
): Promise<{ status: 'delivered'; already: boolean }> {
  if (!isGuestMembershipId(id)) throw new CommerceError('NOT_FOUND', 404, 'No such purchase.');
  const p = parse((await storage.getMemory(NS_PURCHASE, keyOf(id)))?.value);
  if (!p) throw new CommerceError('NOT_FOUND', 404, 'No such purchase.');
  if (opts.appId && !equalAppId(opts.appId, p.appId)) throw new CommerceError('NOT_FOUND', 404, 'No such purchase.');
  if (p.status === 'delivered') return { status: 'delivered', already: true };
  if (Date.now() > Date.parse(p.expiresAt)) throw new CommerceError('PURCHASE_EXPIRED', 409, 'This purchase was opened more than a day ago. Start it again.');
  const sold = await readSoldRole(storage, config, p.appId, p.role);
  if (opts.sellerGhii && opts.sellerGhii !== sold.sellerGhii) throw new CommerceError('NOT_FOUND', 404, 'No such purchase.');
  if (sold.sale.amount !== p.amount || sold.sale.currency !== p.currency) {
    throw new CommerceError('PRICE_CHANGED', 409, 'The price changed after this purchase was opened. Start it again.');
  }
  const handlerId = opts.handler === TEST_MONEY_HANDLER_ID ? TEST_MONEY_HANDLER_ID : STRIPE_CHECKOUT_HANDLER_ID;
  const handler = getPaymentHandler(handlerId);
  if (!handler) throw new CommerceError('UNKNOWN_PAYMENT_HANDLER', 422, `Payment handler not available on this node: ${handlerId}`);
  if (handlerId === STRIPE_CHECKOUT_HANDLER_ID && !(typeof instrument === 'string' && p.cardPages.includes(instrument))) {
    throw new CommerceError('PAYMENT_MISMATCH', 409, 'That card payment was not made for this purchase.');
  }
  const psp = (await storage.getMemory(sold.sellerGhii, 'commerce.psp'))?.value ?? undefined;
  const seller = { ghii: sold.sellerGhii, owner: sold.owner, psp };
  const collected = await handler.collect({ config, storage }, {
    buyerGhii: `guest:${p.id}`, amount: p.amount, currency: p.currency, reference: p.id, fee: 0, instrument, seller,
    ...(p.renews ? { saveForLater: true } : {}),
  });
  // One completion delivers: the purchase is marked on its version before the membership is made.
  let mine = false;
  await updateRecord(storage, NS_PURCHASE, keyOf(id), parse, cur => {
    mine = false;
    if (!cur || cur.status !== 'open') return UNCHANGED;
    mine = true;
    return { ...cur, status: 'delivered' as const, trackingCode: collected.trackingCode, deliveredAt: new Date().toISOString() };
  }, { tag: 'app-member' });
  if (!mine) return { status: 'delivered', already: true };
  const renews = p.renews && !!collected.saved;
  try {
    const out = await deliverPaidMembership(storage, config, {
      appId: p.appId, role: p.role, email: p.emailShown,
      paid: {
        via: 'checkout', until: new Date(Date.now() + p.days * DAY_MS).toISOString(), renews,
        amount: p.amount, currency: p.currency, periodDays: p.days, charges: [collected.trackingCode], purchase: p.id,
        ...(collected.saved ? { keptPayment: { handler: handler.id, ...collected.saved } } : {}),
      },
    });
    if (out.outcome === 'refused' || out.outcome === 'owner') throw new Error(`the membership could not be given (${out.detail ?? out.outcome})`);
    await updateRecord(storage, NS_PURCHASE, keyOf(id), parse, cur => (cur ? { ...cur, outcome: out.outcome } : UNCHANGED), { tag: 'app-member' });
  } catch (err) {
    // Paid and not delivered: the payment goes back, or the seller holds it as undelivered.
    const refund = await refundCollected({ config, storage }, handler, { buyerGhii: `guest:${p.id}`, amount: p.amount, trackingCode: collected.trackingCode, seller });
    if (refund.outcome !== 'refunded' && refund.outcome !== 'nothing_captured') {
      await recordUndeliveredPayment({ config, storage }, {
        session: { id: p.id, buyerGhii: `guest:${p.id}`, sellerGhii: sold.sellerGhii, total: p.amount, currency: p.currency, items: [{ title: sold.plan.title }] } as unknown as CheckoutSessionRecord,
        trackingCode: collected.trackingCode, rail: handler.id, refund, reason: String(err),
      });
    }
    logger.error('membership-guest: a paid purchase was not delivered', { purchase: id, app: p.appId, refund: refund.outcome, error: String(err) });
    throw new CommerceError('FULFILLMENT_FAILED', 502, `The membership could not be given, so ${refund.outcome === 'refunded' ? 'the payment was refunded' : 'the seller was told to refund the payment'}.`);
  }
  return { status: 'delivered', already: false };
}

/** Delete open purchases past their day and delivered ones after 30 days. Answers how many went. */
export async function sweepGuestPurchases(storage: Storage, now = Date.now()): Promise<number> {
  const stale: string[] = [];
  for (let offset = 0; ; ) {
    const page = await storage.listAllMemory({ ownerPrefix: NS_PURCHASE, prefix: KEY_PREFIX, limit: 1000, offset });
    for (const r of page.items) {
      if (r.ownerGaii !== NS_PURCHASE) continue;
      const p = parse(r.value);
      const old = !p || (p.status === 'open' ? Date.parse(p.expiresAt) < now : Date.parse(p.deliveredAt ?? p.createdAt) + KEEP_DELIVERED_MS < now);
      if (old) stale.push(r.key);
    }
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }
  let n = 0;
  for (const key of stale) if (await storage.deleteMemory(NS_PURCHASE, key)) n++;
  return n;
}
