/**
 * @file src/commerce/membership-stripe.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A membership sold on the app owner's OWN Stripe (a Payment Link, a pricing table, a
 *   Stripe Checkout of their own), reported by the seller's own signed webhook
 *   (POST /v1/commerce/webhooks/stripe/:owner, routes/commerce-webhooks.ts). The owner names the Stripe
 *   Price ids that sell a role in the carry plan (`sale[role].stripePrices`); this file maps an event to
 *   that role, among the webhook owner's own apps only, so one seller's webhook never reaches another
 *   seller's app.
 *
 *   EVENTS
 *   - `invoice.paid`: a subscription period was paid. The payer (the invoice's customer email) is a
 *     member to the end of the period the invoice line names, and renews while the Stripe
 *     subscription runs. Stripe renews; this node only follows.
 *   - `checkout.session.completed` in payment mode, paid: a one-time purchase. The lines are read back
 *     from Stripe with the seller's own key (the event does not carry them); the payer is a member for
 *     the role's period. A subscription-mode session is left to its `invoice.paid`.
 *   - `customer.subscription.deleted`, and `customer.subscription.updated` with `cancel_at_period_end`:
 *     the membership no longer renews and ends at the end of the paid period, by the clock.
 *   - `charge.refunded` is commerce/membership-end.ts's, the same for every membership.
 *
 *   The payer is delivered by commerce/membership-deliver.ts: a verified account at once, any other
 *   address an invitation carrying the paid term.
 *
 *   IDEMPOTENT: the event ids this seller's webhook handled are kept (the newest 500, one record under
 *   the seller), and a redelivery answers `membership_event_seen` without acting again. Acting twice
 *   would also be harmless: each event sets a date or a flag, never adds a period.
 * @structure STRIPE_EVENTS_KEY · priceRoles · handleMembershipStripeEvent
 * @usage const r = await handleMembershipStripeEvent(storage, config, sellerGhii, event); // null: not a membership event
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-sovelluksen-j-senyyden-voi-myyd-maksu-uusinta-ja-p-ttyminen-).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { listOwnerSalePlans, listMembers, updateMemberRow, type AppCarryPlan } from '../services/app/members.js';
import { listInvites, putInvite } from '../services/app/member-invites.js';
import { localAccountName } from '../utils/gaii.js';
import { updateRecord, UNCHANGED } from '../services/record-cas.js';
import { stripeApi, sellerKey } from './stripe-handler.js';
import { deliverPaidMembership } from './membership-deliver.js';
import { logger } from '../utils/logger.js';

/** The event ids this seller's webhook handled for memberships, newest last. Service-owned. */
export const STRIPE_EVENTS_KEY = 'commerce.membership.stripe-events';
const KEEP_EVENTS = 500;
const DAY_MS = 86_400_000;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const isoOfUnix = (v: unknown): string | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? new Date(v * 1000).toISOString() : null);

/** The role each Stripe Price id of this seller sells: price id → { appId, role, days }. */
export async function priceRoles(storage: Storage, sellerOwner: string): Promise<Map<string, { appId: string; role: string; days: number | null }>> {
  const out = new Map<string, { appId: string; role: string; days: number | null }>();
  for (const plan of await listOwnerSalePlans(storage, sellerOwner)) {
    for (const [role, s] of Object.entries(plan.sale)) {
      for (const price of s.stripePrices) {
        if (!out.has(price)) out.set(price, { appId: plan.appId, role, days: termDays(plan, role) });
      }
    }
  }
  return out;
}

function termDays(plan: AppCarryPlan, role: string): number | null {
  const d = plan.terms?.[role]?.days;
  return typeof d === 'number' && d > 0 ? d : null;
}

/** The Price id of an invoice line, in the shape of the API version the seller's endpoint uses. */
function linePrice(line: Obj): string | null {
  return str(obj(line.price).id) ?? str(obj(obj(line.pricing).price_details).price) ?? str(obj(line.plan).id) ?? str(line.price);
}

/** The Stripe subscription an invoice belongs to, in either API version's shape. */
function invoiceSubscription(invoice: Obj): string | null {
  return str(invoice.subscription) ?? str(obj(invoice.subscription).id)
    ?? str(obj(obj(invoice.parent).subscription_details).subscription);
}

/** Has this seller's webhook handled `eventId` for a membership already? Marks it when not. */
async function firstTime(storage: Storage, sellerGhii: string, eventId: string): Promise<boolean> {
  let first = false;
  await updateRecord<{ ids: string[] } | null>(storage, sellerGhii, STRIPE_EVENTS_KEY,
    v => (v && Array.isArray((v as { ids?: unknown }).ids) ? v as { ids: string[] } : null),
    cur => {
      first = false;
      if (cur?.ids.includes(eventId)) return UNCHANGED;
      first = true;
      return { ids: [...(cur?.ids ?? []), eventId].slice(-KEEP_EVENTS) };
    }, { tag: 'commerce' });
  return first;
}

/** Mark the memberships and open invitations a Stripe subscription renews as no longer renewing (or renewing again). */
async function setRenews(storage: Storage, sellerOwner: string, stripeSubscription: string, renews: boolean): Promise<number> {
  let n = 0;
  for (const plan of await listOwnerSalePlans(storage, sellerOwner)) {
    for (const m of await listMembers(storage, plan.appId)) {
      if (m.paid?.stripeSubscription !== stripeSubscription || m.paid.renews === renews) continue;
      await updateMemberRow(storage, plan.appId, m.owner, cur => (cur?.paid
        ? { ...cur, paid: { ...cur.paid, renews }, updatedAt: new Date().toISOString() } : UNCHANGED));
      n++;
    }
    for (const inv of await listInvites(storage, plan.appId)) {
      if (inv.paid?.stripeSubscription !== stripeSubscription || inv.paid.renews === renews) continue;
      await putInvite(storage, {
        appId: plan.appId, emailHash: inv.emailHash, emailShown: inv.emailShown, role: inv.role, note: inv.note,
        invitedBy: inv.invitedBy, paid: { ...inv.paid, renews },
      });
      n++;
    }
  }
  return n;
}

/**
 * Act on one verified Stripe event of `sellerGhii` when it concerns a membership the seller sells.
 * Answers the action taken, or null when the event names no role of this seller (the caller goes on
 * with its other handling).
 */
export async function handleMembershipStripeEvent(
  storage: Storage, config: AimeatConfig, sellerGhii: string, event: { id: string; type: string; data?: { object?: Obj } },
): Promise<{ action: string; detail?: string } | null> {
  const sellerOwner = localAccountName(sellerGhii);
  const o = obj(event.data?.object);
  const type = event.type;
  if (type !== 'invoice.paid' && type !== 'checkout.session.completed'
    && type !== 'customer.subscription.deleted' && type !== 'customer.subscription.updated') return null;
  const roles = await priceRoles(storage, sellerOwner);
  if (!roles.size) return null;

  if (type === 'customer.subscription.deleted' || type === 'customer.subscription.updated') {
    const id = str(o.id);
    if (!id) return null;
    const renews = type === 'customer.subscription.updated' && o.cancel_at_period_end !== true && o.status !== 'canceled';
    if (!(await firstTime(storage, sellerGhii, event.id))) return { action: 'membership_event_seen' };
    const n = await setRenews(storage, sellerOwner, id, renews);
    return n ? { action: renews ? 'membership_renews' : 'membership_ends_at_period_end', detail: String(n) } : { action: 'membership_unchanged' };
  }

  if (type === 'invoice.paid') {
    const lines = Array.isArray(obj(o.lines).data) ? (obj(o.lines).data as unknown[]).map(obj) : [];
    const hit = lines.map(l => ({ line: l, role: roles.get(linePrice(l) ?? '') })).find(x => x.role);
    if (!hit) return null;
    const email = str(o.customer_email);
    if (!email) {
      logger.warn('membership-stripe: a paid invoice for a membership names no customer email; nothing was granted', { seller: sellerGhii, invoice: str(o.id) });
      return { action: 'membership_no_email' };
    }
    if (!(await firstTime(storage, sellerGhii, event.id))) return { action: 'membership_event_seen' };
    const subscription = invoiceSubscription(o);
    const days = hit.role!.days ?? 30;
    const until = isoOfUnix(obj(hit.line.period).end) ?? new Date(Date.now() + days * DAY_MS).toISOString();
    // What a refund of this payment names: the PaymentIntent and the Charge (older API versions carry
    // them on the invoice, newer ones in its `payments` list), and the invoice itself.
    const paymentsList = Array.isArray(obj(o.payments).data) ? (obj(o.payments).data as unknown[]).map(p => obj(obj(p).payment)) : [];
    const charges = [
      str(o.payment_intent), str(o.charge), str(o.id),
      ...paymentsList.flatMap(p => [str(p.payment_intent), str(p.charge)]),
    ].filter((c): c is string => !!c);
    const out = await deliverPaidMembership(storage, config, {
      appId: hit.role!.appId, role: hit.role!.role, email,
      paid: { via: 'stripe', until, renews: !!subscription, charges, ...(subscription ? { stripeSubscription: subscription } : {}) },
    });
    return { action: `membership_${out.outcome}`, ...(out.detail ? { detail: out.detail } : {}) };
  }

  // checkout.session.completed: a one-time payment. A subscription-mode session is paid by its invoice.
  if (o.mode !== 'payment') return null;
  if (o.payment_status !== 'paid') return null;
  const id = str(o.id);
  if (!id) return null;
  const psp = (await storage.getMemory(sellerGhii, 'commerce.psp'))?.value ?? undefined;
  let items: Obj[];
  try {
    const page = await stripeApi(sellerKey(config, { psp }), 'GET', `checkout/sessions/${encodeURIComponent(id)}/line_items?limit=20`);
    items = Array.isArray(page.data) ? (page.data as unknown[]).map(obj) : [];
  } catch (err) {
    logger.warn('membership-stripe: the lines of a paid checkout could not be read from Stripe; no membership was granted', { seller: sellerGhii, session: id, error: String(err) });
    return null;
  }
  const role = items.map(l => roles.get(str(obj(l.price).id) ?? '')).find(Boolean);
  if (!role) return null;
  const email = str(obj(o.customer_details).email) ?? str(o.customer_email);
  if (!email) return { action: 'membership_no_email' };
  if (!(await firstTime(storage, sellerGhii, event.id))) return { action: 'membership_event_seen' };
  const until = new Date(Date.now() + (role.days ?? 30) * DAY_MS).toISOString();
  const charges = [str(o.payment_intent), id].filter((c): c is string => !!c);
  const out = await deliverPaidMembership(storage, config, {
    appId: role.appId, role: role.role, email, paid: { via: 'stripe', until, renews: false, charges },
  });
  return { action: `membership_${out.outcome}`, ...(out.detail ? { detail: out.detail } : {}) };
}
