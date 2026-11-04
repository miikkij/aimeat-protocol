/**
 * @file src/services/exchange-party-buy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An OUTSIDE BUYER of a data package (plan doc-mvwxcas3dom3, D5.4): a person or a program
 *   with no AIMEAT account buys a datapackage offering and becomes an outside party of the provider
 *   (services/parties/), with a key, a contract and a named share. Wish
 *   wish-exchange-lisatestaus-ulkopuolinen-ostaja point 5: a client outside AIMEAT uses an offer.
 *
 *   WHY A RAIL OF ITS OWN. The node's checkouts price for a buyer that is an account (commerce/
 *   session-service.ts) or for an AI shopping platform's guest with a shared payment token
 *   (commerce/ucp-guest-checkout.ts). A party is neither, so this is a small checkout over the same
 *   money handlers: Stripe's hosted card page on the provider's own Stripe account
 *   (`com.stripe.checkout`), or the test double (`test.money`) on a node that runs it. The seller's
 *   side is booked with settleSessionlessSale, as every sale without an account is.
 *
 *   TWO STEPS. openPartyPurchase prices the purchase from the listing (never from the request) and
 *   keeps it, open, for an hour; with the card page it answers the page's address. completePartyPurchase
 *   claims the open purchase, collects the payment, and only then makes the party (or finds it, on a
 *   renewal), its key, its contract and its share. A failure after the collect refunds and reopens.
 *
 *   PAID IN ADVANCE. A party has no balance to charge per read, so the contract is prepaid: `per_month`
 *   buys whole months (a subscription whose period runs to the end of what was bought), `per_read` a
 *   block of reads (a bundle). Every read inside it settles at 0 (services/metered-access.ts); the next
 *   one past it is 402 PREPAID_ENDED, and the party buys again with its own credential, which tops up
 *   the same contract and keeps the same key.
 *
 *   THE SHARE is a consent record like any named share (services/parties/shares.ts), bound to the
 *   purchase by node-written metadata `contract`; the buyer accepted the usage terms by buying, which
 *   the share records as its terms acceptance. Its reads go through the read gate, the read log and the
 *   per-party rate limit that exist; nothing here keeps a second log or a second limit.
 *
 *   WHERE IT LIVES. One record per provider per month, `party-purchases.<yyyy-mm>` (service-owned,
 *   utils/reserved-keys.ts), written on its version; the purchase id names the provider and the month,
 *   so a later call finds it without an index. A month takes at most 2000 purchases that are paid or
 *   still waiting for their payment; an opening that expired unpaid does not count, and the record
 *   keeps only the newest 500 of those.
 *
 *   A FAILED DELIVERY. When a step after the collect fails, what this attempt wrote is undone (the
 *   contract goes back to what it was, a share it made ends, a party it made is removed), the payment
 *   goes back through the account checkout's refund helper with the seller's payment settings, and the
 *   buyer reads what the rail did (commerce/undelivered-payment.ts). A refunded payment is kept on the
 *   purchase, so the same payment cannot complete it again. The sale is booked for the seller only
 *   after the last write that can fail, so a returned payment never shows as a sale.
 *
 *   PAID ON THE CARD PAGE. The buyer pays on Stripe's page before calling complete, so for the card
 *   page the payment is read back before anything is refused: a buyer who paid inside the hour and
 *   comes back after it gets the purchase, and an offering that cannot be sold any more refunds the
 *   payment. The seller's Stripe webhook completes a purchase whose buyer never comes back
 *   (completePartyPurchaseFromStripe, called by commerce/stripe-checkout-complete.ts), through the
 *   same completion; nobody reads that answer, so the buyer's next complete with the same card page
 *   receives it once (handOver), with a new party's first key made at that moment.
 * @structure PartyPurchase · PURCHASE_TTL_MS · openPartyPurchase · completePartyPurchase · readPartyPurchase ·
 *   isPartyPurchaseId · completePartyPurchaseFromStripe
 * @usage
 *   const opened = await openPartyPurchase(deps, offeringId, body, renewalCtx);
 *   const done = await completePartyPurchase(deps, purchaseId, { handler: 'test.money', instrument: 'x' });
 *   const r = await completePartyPurchaseFromStripe(deps, sellerGhii, purchaseId, stripeSessionId);
 * @version-history
 *   2026-11-04 — The completion write and the sale's booking commit in one transaction
 *     (settleSessionlessSale, commerce/settle-purchase.ts; codebase analysis 2026-11-03, item B2).
 *   v1.2.0 — 2026-11-03 — secaudit2026nov02d round 13b: a card page purchase paid inside its hour and
 *     completed after it is delivered (or refunded when the offering cannot be sold any more), an
 *     unpaid expired one still answers 410; the seller's Stripe webhook completes a party purchase
 *     through the same completion, and the buyer's next complete with the same card page receives the
 *     answer and a new party's key once; the sale is booked after the last write that can fail, so a
 *     failed delivery leaves no booked sale behind its refund.
 *   v1.1.0 — 2026-11-02 — secaudit2026nov02d round 13: a failed delivery undoes the contract top-up, the
 *     share and the party it made; the refund goes through refundCollected with the seller's payment
 *     settings, the buyer is told it was refunded only when it was, and an unreturned payment is
 *     recorded for the seller and the operator; a refunded payment does not complete the purchase
 *     again; an opening that expired unpaid does not count toward the month's cap.
 *   v1.0.1 — 2026-11-01 — The card page handler is refused with 409 PROVIDER_TAKES_NO_CARD before
 *     anything is written when the provider has no Stripe account (it answered 500 and left an open
 *     purchase); a card page Stripe refuses removes the purchase and answers Stripe's refusal (WP10d).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D5.4).
 */
import { randomBytes } from 'node:crypto';
import type { Storage, ConsentRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { CheckoutSessionRecord } from '../commerce/types.js';
import { getOffering, type Offering } from './exchange-market.js';
import {
    createEntitlement, readContractForCall, persistEntitlement, revokeEntitlement,
    type MeteredEntitlement, type PricingSpec, type DatapackageSurface,
} from './metered-entitlements.js';
import { PER_MONTH_SECONDS } from './exchange-datapackage.js';
import { updateRecord, UNCHANGED } from './record-cas.js';
import { getPaymentHandler, PaymentError } from '../commerce/payment-handlers.js';
import { sellerKey } from '../commerce/stripe-handler.js';
import { percentFee } from '../commerce/money.js';
import { commerceFeePercent } from './marketplace-fee.js';
import { settleSessionlessSale } from '../commerce/session-service.js';
import { openStripeCheckout, STRIPE_CHECKOUT_HANDLER_ID } from '../commerce/stripe-checkout.js';
import { TEST_MONEY_HANDLER_ID } from '../commerce/test-money-handler.js';
import { readPsp } from '../commerce/psp-record.js';
import { refundCollected, refundSentence, recordUndeliveredPayment } from '../commerce/undelivered-payment.js';
import { isValidEmail } from '../utils/email-validator.js';
import { grantConsent } from './consent-write.js';
import { PARTY_NAME_RE, partyRefOf, partyView, type PartyKind, type PartyRecord } from './parties/contract.js';
import { newPartyKey, newPartyKeyId, newPartyUid } from './parties/keys.js';
import { insertParty, findPartyByUid, removeParty, changeParty } from './parties/store.js';
import { connectionFileOf, isLiveShare, partySharesOf, setShareMeta, sharePatternOf, shareMetaOf, shareView } from './parties/shares.js';
import type { PartyContext } from './parties/verify.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

/** How long an open purchase waits for its payment. */
export const PURCHASE_TTL_MS = 60 * 60 * 1000;
const MAX_PER_MONTH = 2000;
/** How many openings that expired unpaid a month's record keeps (the newest); they do not count toward MAX_PER_MONTH. */
const EXPIRED_KEPT = 500;
const HANDLERS = [STRIPE_CHECKOUT_HANDLER_ID, TEST_MONEY_HANDLER_ID];

export interface PartyPurchase {
    id: string;
    offeringId: string;
    providerGhii: string;
    providerOwner: string;
    packageName: string;
    party: { name: string; displayName: string; kind: PartyKind; contact?: string };
    /** Set on a renewal: the party (uid) whose contract this purchase tops up. */
    renewalOf?: string;
    model: 'per_month' | 'per_read';
    /** Months bought (per_month) or reads bought (per_read). */
    quantity: number;
    /** What is paid, in 6-decimal micro-units, and in which currency. */
    amount: number;
    currency: string;
    handler: string;
    status: 'open' | 'completing' | 'completed';
    createdAt: string;
    expiresAt: string;
    completedAt?: string;
    trackingCode?: string;
    partyUid?: string;
    entitlementId?: string;
    shareId?: string;
    /** Tracking codes of payments refunded after a failed delivery: a collect that answers one again is not a payment. */
    refundedTrackingCodes?: string[];
    /** The Stripe card pages the node opened for this purchase: the webhook completes it only from one of them. */
    cardPages?: string[];
    /** The card page (Stripe session id) whose payment the webhook completed the purchase with. */
    paidWith?: string;
    /**
     * Set when the webhook completed the purchase and no buyer has read the answer yet: the buyer's
     * next complete with the same card page receives it once, and a new party's key is made then.
     */
    handover?: { keyPending: boolean };
}

/** How a completion was asked for. */
export interface CompleteOptions {
    /** The seller's Stripe webhook completes it: no buyer reads this answer (see handOver). */
    unattended?: boolean;
}

/** Whether a purchase takes one of the month's slots: paid (or being paid), or open and still waiting for its payment. */
const holdsSlot = (p: PartyPurchase, nowMs: number): boolean => p.status !== 'open' || Date.parse(p.expiresAt) > nowMs;

type Refusal = { ok: false; status: number; code: string; message: string };
const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });

const b64u = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
const monthOf = (iso: string): string => iso.slice(0, 7);
const recordKey = (month: string): string => `party-purchases.${month}`;

/** The provider and the month a purchase id names, or null for an id this node did not mint. */
function locate(id: string, nodeId: string): { providerGhii: string; month: string } | null {
    const m = /^pp_([A-Za-z0-9_-]{1,120})_(\d{4})(\d{2})_[0-9a-f]{32}$/.exec(id);
    if (!m) return null;
    const owner = Buffer.from(m[1]!, 'base64url').toString('utf8');
    if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(owner)) return null;
    return { providerGhii: `${owner}@${nodeId}`, month: `${m[2]}-${m[3]}` };
}

const parseRecord = (v: unknown): { purchases: PartyPurchase[] } => ({
    purchases: Array.isArray((v as { purchases?: unknown })?.purchases) ? (v as { purchases: PartyPurchase[] }).purchases : [],
});

/** The purchase as its buyer and the provider read it. */
function purchaseView(p: PartyPurchase): Record<string, unknown> {
    return {
        id: p.id, offering_id: p.offeringId, package: `pkg:${p.providerOwner}/${p.packageName}`, model: p.model, quantity: p.quantity,
        amount: p.amount, currency: p.currency, handler: p.handler, status: p.status, created_at: p.createdAt, expires_at: p.expiresAt,
        ...(p.completedAt ? { completed_at: p.completedAt } : {}), ...(p.renewalOf ? { renewal: true } : {}),
    };
}

/** A party name from a display name: a slug and a short random tail, so two buyers named alike do not collide. */
function partyNameFor(asked: unknown, displayName: string): string | null {
    if (typeof asked === 'string' && asked.trim()) return PARTY_NAME_RE.test(asked.trim()) ? asked.trim() : null;
    const slug = displayName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'buyer';
    return `${slug}-${randomBytes(3).toString('hex')}`;
}

/** Whether the provider's payment settings hold a Stripe key the card page can use (the check sellerKey makes). */
function sellerTakesCards(config: AimeatConfig, psp: unknown): boolean {
    try {
        return !!sellerKey(config, { psp });
    } catch (err) {
        if (err instanceof PaymentError && err.code === 'PSP_NOT_CONFIGURED') return false;
        throw err;
    }
}

/** The datapackage offering a party may buy, or the refusal. */
async function buyable(storage: Storage, offeringId: string): Promise<{ ok: true; o: Offering; surface: DatapackageSurface } | Refusal> {
    const o = await getOffering(storage, offeringId);
    if (!o || o.state !== 'listed') return refuse(404, 'NOT_FOUND', 'No such listed offering.');
    if (o.kind !== 'datapackage' || o.surface?.kind !== 'datapackage') return refuse(409, 'NOT_SOLD_TO_PARTIES', 'Only a data package is sold to a buyer without an AIMEAT account. Sign in to an account to buy this.');
    if (o.unit !== 'money') return refuse(409, 'NOT_SOLD_TO_PARTIES', 'This data package has no money price, so a buyer without an account cannot pay for it. Ask the provider to share it with you by name.');
    return { ok: true, o, surface: o.surface };
}

/**
 * Price and keep an open purchase of a datapackage offering. `renewal` is the verified party of the
 * provider buying again; without it the body names the new party. With the card page handler the
 * answer carries its address (`return_url` is where the buyer comes back with `stripe_session`).
 */
export async function openPartyPurchase(
    deps: { storage: Storage; config: AimeatConfig }, offeringId: string, body: Record<string, unknown>, renewal: PartyContext | null,
): Promise<{ ok: true; purchase: Record<string, unknown>; pay: Record<string, unknown> } | Refusal> {
    const { storage, config } = deps;
    const found = await buyable(storage, offeringId);
    if (!found.ok) return found;
    const { o, surface } = found;
    if (renewal && renewal.owner !== o.providerOwner) return refuse(403, 'FORBIDDEN', 'Your party key belongs to another provider. Buy without it to become this provider\'s party.');
    const handlerId = typeof body.handler === 'string' ? body.handler : TEST_MONEY_HANDLER_ID;
    const handler = HANDLERS.includes(handlerId) ? getPaymentHandler(handlerId) : undefined;
    if (!handler || !handler.currencies.includes(o.currency ?? 'EUR')) {
        return refuse(422, 'UNKNOWN_PAYMENT_HANDLER', `Pay with ${HANDLERS.filter(h => getPaymentHandler(h)).join(' or ') || 'a card'}: this node has no handler "${handlerId}" for ${o.currency}.`);
    }
    // The card page is the provider's own Stripe account. Without one nothing can be paid, so the
    // purchase is refused here, before anything is written.
    const psp = handler.id === STRIPE_CHECKOUT_HANDLER_ID ? await readPsp(storage, o.providerGhii) : null;
    if (handler.id === STRIPE_CHECKOUT_HANDLER_ID && !sellerTakesCards(config, psp)) {
        const others = HANDLERS.filter(h => h !== STRIPE_CHECKOUT_HANDLER_ID && getPaymentHandler(h)?.currencies.includes(o.currency ?? 'EUR'));
        return refuse(409, 'PROVIDER_TAKES_NO_CARD', 'The seller cannot take card payments yet, because they have not connected a Stripe account. '
            + (others.length
                ? `This node also takes ${others.join(' or ')}: buy again with "handler": "${others[0]}".`
                : 'This node has no other way to pay for it. Ask the seller to set up card payments, or to share the data with you by name.'));
    }

    // The party: the renewing one, or the new one the body names.
    let party: PartyPurchase['party'];
    if (renewal) {
        party = { name: renewal.party.name, displayName: renewal.party.displayName, kind: renewal.party.kind, ...(renewal.party.contact ? { contact: renewal.party.contact } : {}) };
    } else {
        const p = (body.party ?? {}) as Record<string, unknown>;
        const displayName = typeof p.display_name === 'string' ? p.display_name.trim().slice(0, 120) : '';
        if (!displayName) return refuse(400, 'INVALID_INPUT', 'party.display_name is who buys: a person\'s or a program\'s name.');
        const kind = (p.kind ?? 'person') as PartyKind;
        if (kind !== 'person' && kind !== 'program') return refuse(400, 'INVALID_INPUT', 'party.kind is "person" or "program".');
        const contact = typeof p.contact === 'string' ? p.contact.trim().slice(0, 320) : '';
        if (kind === 'person' && !isValidEmail(contact)) return refuse(400, 'INVALID_INPUT', 'A person buying gives an e-mail address (party.contact): the provider sends notices there, and it is personal data the provider holds.');
        if (contact && kind === 'program' && !isValidEmail(contact)) return refuse(400, 'INVALID_INPUT', 'party.contact is an e-mail address.');
        const name = partyNameFor(p.name, displayName);
        if (!name) return refuse(400, 'INVALID_INPUT', 'party.name is 1 to 40 characters: lowercase letters, digits and dashes.');
        party = { name, displayName, kind, ...(contact ? { contact } : {}) };
    }

    // The quantity and the amount, from the listing.
    let quantity: number, amount: number;
    if (surface.model === 'per_month') {
        const months = body.months === undefined ? 1 : body.months;
        if (typeof months !== 'number' || !Number.isInteger(months) || months < 1 || months > 12) return refuse(400, 'INVALID_INPUT', 'months is a whole number from 1 to 12.');
        const plan = o.plans.find(p => p.id === 'per_month');
        if (!plan || plan.model !== 'subscription') return refuse(409, 'NOT_PRICED', 'This listing has no monthly plan.');
        quantity = months; amount = plan.periodPrice * months;
    } else {
        const reads = body.reads === undefined ? 1000 : body.reads;
        if (typeof reads !== 'number' || !Number.isInteger(reads) || reads < 1 || reads > 1_000_000) return refuse(400, 'INVALID_INPUT', 'reads is a whole number of reads from 1 to 1000000.');
        quantity = reads; amount = o.basePrice * reads;
    }

    const now = new Date();
    const createdAt = now.toISOString();
    const id = `pp_${b64u(o.providerOwner)}_${createdAt.slice(0, 4)}${createdAt.slice(5, 7)}_${randomBytes(16).toString('hex')}`;
    const purchase: PartyPurchase = {
        id, offeringId: o.offeringId, providerGhii: o.providerGhii, providerOwner: o.providerOwner, packageName: surface.packageName,
        party, ...(renewal ? { renewalOf: renewal.party.uid } : {}), model: surface.model, quantity, amount, currency: o.currency ?? 'EUR',
        handler: handler.id, status: 'open', createdAt, expiresAt: new Date(now.getTime() + PURCHASE_TTL_MS).toISOString(),
    };
    let full = false;
    await updateRecord(storage, o.providerGhii, recordKey(monthOf(createdAt)), parseRecord, cur => {
        // An opening nobody paid for before it expired takes no slot, so unpaid openings cannot use
        // up the provider's month. The record keeps the newest EXPIRED_KEPT of them and drops older ones.
        const nowMs = now.getTime();
        if (cur.purchases.filter(p => holdsSlot(p, nowMs)).length >= MAX_PER_MONTH) { full = true; return UNCHANGED; }
        const expired = cur.purchases.filter(p => !holdsSlot(p, nowMs));
        const dropped = new Set(expired.slice(0, Math.max(0, expired.length - EXPIRED_KEPT)).map(p => p.id));
        return { purchases: [...cur.purchases.filter(p => !dropped.has(p.id)), purchase] };
    }, { tag: 'party-purchases' });
    if (full) return refuse(429, 'TOO_MANY_PURCHASES', 'This provider takes no more purchases this month. Try again later.');

    const completeUrl = `${config.baseUrl.replace(/\/+$/, '')}/v1/exchange/purchases/${id}/complete`;
    let pay: Record<string, unknown> = { handler: handler.id, amount, currency: purchase.currency, complete_url: completeUrl };
    if (handler.id === STRIPE_CHECKOUT_HANDLER_ID) {
        const returnUrl = typeof body.return_url === 'string' && /^https:\/\//.test(body.return_url) ? body.return_url : `${config.baseUrl.replace(/\/+$/, '')}/v1/exchange/purchases/${id}`;
        const asSession = {
            id, status: 'open', total: amount, currency: purchase.currency, buyerGhii: partyRefOf(o.providerOwner, party.name, config.nodeId),
            items: [{ title: `${o.title} (${surface.model === 'per_month' ? `${quantity} month(s)` : `${quantity} reads`})` }],
            updatedAt: createdAt, expiresAt: purchase.expiresAt,
        } as unknown as CheckoutSessionRecord;
        let page: { url: string; stripeSession: string };
        try {
            page = await openStripeCheckout(config, asSession, psp, returnUrl);
            // The webhook completes the purchase only from a card page the node opened for it, as for
            // an account checkout (commerce/stripe-checkout-complete.ts).
            const stripeSession = page.stripeSession;
            await changePurchase(storage, config.nodeId, id, p => ({ ...p, cardPages: [...(p.cardPages ?? []), stripeSession].slice(-5) }));
        } catch (err) {
            // Stripe refused the page: the purchase can never be paid, so it does not stay open.
            await updateRecord(storage, o.providerGhii, recordKey(monthOf(createdAt)), parseRecord,
                cur => cur.purchases.some(p => p.id === id) ? { purchases: cur.purchases.filter(p => p.id !== id) } : UNCHANGED,
                { tag: 'party-purchases' });
            if (err instanceof PaymentError) return refuse(err.statusCode, err.code, err.message);
            throw err;
        }
        pay ={ ...pay, card_page_url: page.url, note: 'Pay on the card page; you come back with stripe_session, which you POST to complete_url as the instrument.' };
    } else {
        pay = { ...pay, note: 'POST complete_url with { "handler": "test.money", "instrument": "<any text>" }: the test double settles with no real money.' };
    }
    return { ok: true, purchase: purchaseView(purchase), pay };
}

/** Read one purchase (its id is its bearer secret). */
export async function readPartyPurchase(storage: Storage, nodeId: string, id: string): Promise<PartyPurchase | null> {
    const at = locate(id, nodeId);
    if (!at) return null;
    const rec = await storage.getMemory(at.providerGhii, recordKey(at.month));
    return parseRecord(rec?.value).purchases.find(p => p.id === id) ?? null;
}

/** Change one purchase on the record's version. Answers the purchase as written, or null. */
async function changePurchase(storage: Storage, nodeId: string, id: string, change: (p: PartyPurchase) => PartyPurchase | typeof UNCHANGED): Promise<PartyPurchase | null> {
    const at = locate(id, nodeId);
    if (!at) return null;
    let after: PartyPurchase | null = null;
    await updateRecord(storage, at.providerGhii, recordKey(at.month), parseRecord, cur => {
        const i = cur.purchases.findIndex(p => p.id === id);
        if (i < 0) return UNCHANGED;
        const next = change(cur.purchases[i]!);
        if (next === UNCHANGED) { after = cur.purchases[i]!; return UNCHANGED; }
        after = next;
        const purchases = [...cur.purchases];
        purchases[i] = next;
        return { purchases };
    }, { tag: 'party-purchases' });
    return after;
}

/** The purchase view, for the GET route. */
export { purchaseView };

/** The contract pricing a purchase buys, on top of what an earlier one of the same party left. */
function prepaidPricing(p: PartyPurchase, o: Offering, before: PricingSpec | null, nowMs: number): PricingSpec {
    if (p.model === 'per_month') {
        const plan = o.plans.find(x => x.id === 'per_month');
        const rate = plan && plan.model === 'subscription' ? plan : { periodPrice: p.amount / p.quantity, callsPerWindow: 60, windowSeconds: 60 };
        const from = before?.model === 'subscription' ? Math.max(nowMs, Date.parse(before.validUntil)) : nowMs;
        return {
            model: 'subscription', periodSeconds: PER_MONTH_SECONDS, periodPrice: rate.periodPrice,
            callsPerWindow: rate.callsPerWindow, windowSeconds: rate.windowSeconds,
            validUntil: new Date(from + p.quantity * PER_MONTH_SECONDS * 1000).toISOString(),
            windowStart: new Date(nowMs).toISOString(), windowCount: 0,
        };
    }
    const left = before?.model === 'bundle' ? before.callsRemaining : 0;
    return { model: 'bundle', blockSize: p.quantity, blockPrice: p.amount, callsRemaining: left + p.quantity };
}

const EXPIRED = (): Refusal => refuse(410, 'PURCHASE_EXPIRED', 'This purchase waited too long for its payment. Start a new one.');

/**
 * Collect the payment of an open purchase and deliver it: the party (new, with its key), the prepaid
 * contract and the named share bound to it, and the connection file. A completed purchase answers 409
 * ALREADY_COMPLETED; its key was in the first answer only, or, when the webhook completed it, in the
 * buyer's first complete after that (handOver).
 */
export async function completePartyPurchase(
    deps: { storage: Storage; config: AimeatConfig }, id: string, input: { handler?: unknown; instrument?: unknown }, opts: CompleteOptions = {},
): Promise<{ ok: true; data: Record<string, unknown> } | Refusal> {
    const { storage, config } = deps;
    const stored = await readPartyPurchase(storage, config.nodeId, id);
    if (!stored) return refuse(404, 'NOT_FOUND', 'No such purchase.');
    if (stored.status === 'completed') {
        if (stored.handover && !opts.unattended) return handOver(deps, stored, input);
        return refuse(409, 'ALREADY_COMPLETED', 'This purchase is complete. Its key was in the answer that completed it.');
    }
    // The card page is paid on Stripe before this call, so its payment is read back before the purchase
    // counts as expired or the offering as gone: a buyer who paid inside the hour and comes back after
    // it is delivered, and money paid for an offering that cannot be sold any more goes back. Any other
    // handler collects below, so nothing is paid when it is refused here.
    const card = stored.handler === STRIPE_CHECKOUT_HANDLER_ID;
    const late = stored.status === 'open' && Date.parse(stored.expiresAt) <= Date.now();
    if (late && !card) return EXPIRED();
    if (typeof input.handler === 'string' && input.handler !== stored.handler) return refuse(422, 'HANDLER_MISMATCH', `This purchase is paid with ${stored.handler}.`);
    const handler = getPaymentHandler(stored.handler);
    if (!handler) return refuse(422, 'UNKNOWN_PAYMENT_HANDLER', `This node has no handler ${stored.handler} any more.`);
    const found = await buyable(storage, stored.offeringId);
    if (!found.ok && !card) return found;

    // Claim it: one completion charges a purchase, and a second one waits for the first to finish.
    const claimed = await changePurchase(storage, config.nodeId, id, p => (p.status === 'open' ? { ...p, status: 'completing' } : UNCHANGED));
    if (!claimed || claimed.status !== 'completing') return refuse(409, 'PURCHASE_BUSY', 'This purchase is being completed by another request.');
    const reopen = () => changePurchase(storage, config.nodeId, id, p => (p.status === 'completing' ? { ...p, status: 'open' } : UNCHANGED));

    const partyName = stored.party.name;
    const ref = partyRefOf(stored.providerOwner, partyName, config.nodeId);
    const fee = percentFee(stored.amount, commerceFeePercent(config));
    // The seller's payment settings go to the collect and to a refund alike: the card rail refunds on
    // the seller's own Stripe account and has no key without them.
    const seller = { ghii: stored.providerGhii, owner: stored.providerOwner, psp: await readPsp(storage, stored.providerGhii) };
    let trackingCode: string;
    try {
        const collected = await handler.collect({ config, storage }, {
            buyerGhii: ref, amount: stored.amount, currency: stored.currency, reference: id, fee, instrument: input.instrument, seller,
        });
        trackingCode = collected.trackingCode;
    } catch (err) {
        await reopen();
        const e = err as { code?: string; statusCode?: number; message?: string };
        const status = e.statusCode ?? 402;
        // Nothing was paid: an expired purchase answers as expired, a gone offering as gone. A failure
        // on the payment provider's side keeps its own answer, so the buyer tries again.
        if (late && status < 500) return EXPIRED();
        if (!found.ok && status < 500) return found;
        return refuse(status, e.code ?? 'PAYMENT_FAILED', e.message ?? 'The payment did not go through.');
    }
    // A card page read back again answers the same payment, refunded or not: a payment this purchase
    // gave back after a failed delivery does not pay for it again.
    if ((claimed.refundedTrackingCodes ?? []).includes(trackingCode)) {
        await reopen();
        return refuse(402, 'PAYMENT_REFUNDED', 'This payment was refunded because the purchase could not be delivered, so it does not pay for it again. Start a new purchase to buy.');
    }

    // What this attempt wrote, so a failure after it can be undone.
    const made: DeliveryWrites = {};
    try {
        // A card payment for an offering that cannot be sold any more goes back (the catch refunds).
        if (!found.ok) throw Object.assign(new Error('The seller no longer sells this offering here, so the purchase cannot be delivered'), { code: found.code, statusCode: found.status });
        const { o, surface } = found;
        // The party: the renewing one, or a new one made now, with its first key. Completed by the
        // webhook, a new party gets its key when the buyer comes back (handOver): nobody reads this answer.
        let party: PartyRecord | undefined = stored.renewalOf ? await findPartyByUid(storage, stored.providerGhii, stored.renewalOf) : undefined;
        let key: string | undefined;
        if (stored.renewalOf && !party) throw Object.assign(new Error('The party this purchase renews no longer exists.'), { code: 'PARTY_NOT_FOUND', statusCode: 404 });
        if (!party) {
            const fresh = opts.unattended ? null : newPartyKey();
            const at = new Date().toISOString();
            party = {
                uid: newPartyUid(), name: partyName, displayName: stored.party.displayName, kind: stored.party.kind,
                ...(stored.party.contact ? { contact: stored.party.contact } : {}),
                status: 'active', createdAt: at, createdBy: `exchange:${o.offeringId}`,
                keys: fresh ? [{ id: newPartyKeyId(), hash: fresh.hash, createdAt: at, lastUsedAt: null }] : [], failedAttempts: 0, lastSeenAt: null,
            };
            const outcome = await insertParty(storage, stored.providerGhii, party);
            if (outcome !== 'ok') throw Object.assign(new Error(outcome === 'full' ? 'The provider holds the most outside parties one account may.' : 'A party of that name exists.'), { code: outcome === 'full' ? 'QUOTA_EXCEEDED' : 'PARTY_EXISTS', statusCode: 409 });
            made.partyName = partyName;
            key = fresh?.key;
        }

        // The prepaid contract, keyed on the party's identity like any consumer's.
        const before = await readContractForCall(storage, ref, o.ext, o.action);
        made.contract = { before, ext: o.ext, action: o.action };
        const pricing = prepaidPricing(stored, o, before?.state === 'revoked' ? null : before?.pricing ?? null, Date.now());
        const ent = await createEntitlement(storage, {
            consumerGaii: ref, providerGhii: o.providerGhii, ext: o.ext, action: o.action,
            capabilityLabel: `${surface.packageName} v${surface.ifaceVersion}`, unit: 'money', pricePerCall: o.basePrice,
            currency: stored.currency, pricing, capUnits: null, contractRef: `offering:${o.offeringId}`, surface, tollMorsels: 0,
            createdBy: `exchange:purchase:${id}`, carrySpend: before && before.state !== 'revoked' ? before : null,
        });

        // The share: the live one this party's contract has, else a new one bound to the purchase.
        let share = (await partySharesOf(storage, stored.providerGhii, party, config.nodeId))
            .find(c => isLiveShare(c) && shareMetaOf(c).contract?.offeringId === o.offeringId);
        if (!share) {
            // Granted in the provider's name: listing the package for sale is the provider's consent to
            // share it with whoever buys, under the listing's terms (the purchase is the record of it).
            const granted = await grantConsent({ storage, config }, { ownerGaii: stored.providerGhii, roles: ['owner'], scopes: [], collectionMethod: 'exchange-purchase' }, {
                recipient: ref, dataPattern: sharePatternOf(surface.packageName),
                purpose: `Bought on EXCHANGE (offering ${o.offeringId}, purchase ${id}) under its usage terms.`,
                metadata: { terms_required: false },
            });
            if (!granted.ok) throw Object.assign(new Error(granted.message), { code: granted.code, statusCode: granted.status });
            share = granted.value;
            made.share = share;
        }
        const written = await setShareMeta(storage, share, {
            contract: { offeringId: o.offeringId, entitlementId: ent.entitlementId, ifaceVersion: surface.ifaceVersion },
            termsAcceptedAt: shareMetaOf(share).termsAcceptedAt ?? new Date().toISOString(),
        });
        share = written ?? share;
        const data = await deliveryAnswer(deps, stored, o.title, party, share, { entitlementId: ent.entitlementId, pricing }, key);

        // The last write that can fail. The sale is booked in one transaction with it
        // (settleSessionlessSale), so a failure here leaves no sale on the seller's books for a payment
        // that goes back.
        const paidWith = opts.unattended && typeof input.instrument === 'string' ? input.instrument.slice(0, 200) : undefined;
        await settleSessionlessSale(storage, config, {
            gross: stored.amount, currency: stored.currency, sellerGhii: stored.providerGhii, buyerRef: ref,
            ext: o.ext, action: o.action, trackingCode, handler: handler.id, reference: id,
        }, () => changePurchase(storage, config.nodeId, id, p => ({
            ...p, status: 'completed', completedAt: new Date().toISOString(), trackingCode,
            partyUid: party!.uid, entitlementId: ent.entitlementId, shareId: share!.id,
            ...(opts.unattended ? { handover: { keyPending: !!made.partyName }, ...(paidWith ? { paidWith } : {}) } : {}),
        })));
        emitChange('consent', stored.providerGhii);
        return { ok: true, data };
    } catch (err) {
        // The money moved and the delivery did not: undo what this attempt wrote, give the money back
        // through the account checkout's refund helper, and reopen the purchase.
        const e = err as { code?: string; statusCode?: number; message?: string };
        await undoDelivery(storage, stored.providerGhii, ref, made, id);
        const refund = await refundCollected({ config, storage }, handler, { buyerGhii: ref, amount: stored.amount, trackingCode, seller });
        if (refund.outcome === 'refunded') {
            await changePurchase(storage, config.nodeId, id, p => (p.status === 'completing'
                ? { ...p, status: 'open', refundedTrackingCodes: [...(p.refundedTrackingCodes ?? []), trackingCode].slice(-20) }
                : UNCHANGED));
        } else {
            await reopen();
            if (refund.outcome === 'failed' || refund.outcome === 'not_possible') {
                await recordUndeliveredPayment({ config, storage }, {
                    session: {
                        id, buyerGhii: ref, sellerGhii: stored.providerGhii, total: stored.amount, currency: stored.currency,
                        items: [{ title: `${found.ok ? found.o.title : stored.packageName} (${stored.model === 'per_month' ? `${stored.quantity} month(s)` : `${stored.quantity} reads`})` }],
                    } as unknown as CheckoutSessionRecord,
                    trackingCode, rail: handler.id, refund, reason: e.message ?? 'unknown error',
                });
            }
        }
        const why = (e.message ?? 'The purchase could not be delivered').trim();
        const said = refund.outcome === 'refunded'
            ? `${why}; the payment was refunded.`
            : `${why}${/[.!?]$/.test(why) ? '' : '.'} ${refundSentence(refund, id)}`;
        return refuse(e.statusCode ?? 500, e.code ?? 'DELIVERY_FAILED', said);
    }
}

/** What one completion attempt wrote before it failed. */
interface DeliveryWrites {
    /** The party it made (a renewal makes none). */
    partyName?: string;
    /** The contract as it was before this attempt topped it up (null: there was none), at its coordinate. */
    contract?: { before: MeteredEntitlement | null; ext: string; action: string };
    /** The share it granted (a renewal through a live share grants none). */
    share?: ConsentRecord;
}

/**
 * Undo what a failed completion wrote, newest first: a share it granted ends, the contract goes back
 * to what it was before (a contract this attempt made is revoked), a party it made is removed (its key
 * was never handed out). Each step is logged when it fails and never stops the buyer's answer. The sale
 * is booked in one transaction with the last write, so there is none to undo here.
 */
async function undoDelivery(storage: Storage, providerGhii: string, ref: string, made: DeliveryWrites, id: string): Promise<void> {
    const step = async (what: string, run: () => Promise<unknown>): Promise<void> => {
        try { await run(); } catch (err) { logger.error(`exchange-party-buy: undoing the ${what} of a failed delivery failed`, { purchase: id, error: String(err) }); }
    };
    if (made.share) {
        const share = made.share;
        await step('share', () => setShareMeta(storage, share, { endedReason: 'The purchase that made this share could not be delivered.' }, 'revoked'));
    }
    if (made.contract) {
        const { before, ext, action } = made.contract;
        await step('contract', () => (before ? persistEntitlement(storage, before) : revokeEntitlement(storage, ref, ext, action)));
    }
    if (made.partyName) {
        const name = made.partyName;
        await step('party', () => removeParty(storage, providerGhii, name));
    }
}

/** The answer a completed purchase gives its buyer: the party, the share, the contract and the connection file. */
async function deliveryAnswer(
    deps: { storage: Storage; config: AimeatConfig }, stored: PartyPurchase, title: string, party: PartyRecord, share: ConsentRecord,
    contract: { entitlementId: string; pricing: PricingSpec | null }, key: string | undefined,
): Promise<Record<string, unknown>> {
    const { pricing } = contract;
    const until = pricing?.model === 'subscription' ? `until ${pricing.validUntil.slice(0, 10)}` : `for ${pricing?.model === 'bundle' ? pricing.callsRemaining : stored.quantity} reads`;
    return {
        purchase: purchaseView({ ...stored, status: 'completed' }),
        party: partyView(party, partyRefOf(stored.providerOwner, party.name, deps.config.nodeId)),
        share: shareView(share),
        contract: { entitlement_id: contract.entitlementId, model: stored.model, pricing },
        connection: await connectionFileOf(deps, stored.providerGhii, party, share, key),
        ...(key ? { key_note: 'The key is in the connection file and is shown once. Keep it: buying again with it tops up the same contract.' } : {}),
        say: `${party.displayName} can read "${title}" ${until}. Copies taken stay with the buyer; new reads stop when the purchase is used up.`,
    };
}

/**
 * The buyer's first complete after the webhook completed the purchase: the answer the buyer would
 * have had, once, with a new party's first key made now (the webhook made the party without one, as
 * nobody could read it). Only the card page that paid hands it over. A second call finds it handed
 * over and answers ALREADY_COMPLETED, as any completed purchase does.
 */
async function handOver(
    deps: { storage: Storage; config: AimeatConfig }, stored: PartyPurchase, input: { instrument?: unknown },
): Promise<{ ok: true; data: Record<string, unknown> } | Refusal> {
    const { storage, config } = deps;
    if (stored.paidWith && input.instrument !== stored.paidWith) {
        return refuse(409, 'ALREADY_COMPLETED', 'This purchase was paid on another card page and is complete. '
            + 'Send the stripe_session value from the address the card page sent you back to, and you receive the key once.');
    }
    // One handover: the call that takes the mark makes the answer, and a call at the same moment finds none.
    let pending: PartyPurchase['handover'];
    await changePurchase(storage, config.nodeId, stored.id, p => {
        pending = p.handover;
        if (!pending) return UNCHANGED;
        const rest: PartyPurchase = { ...p };
        delete rest.handover;
        return rest;
    });
    const taken = pending;
    if (!taken) return refuse(409, 'ALREADY_COMPLETED', 'This purchase is complete. Its key was in the answer that completed it.');
    const putBack = () => changePurchase(storage, config.nodeId, stored.id, p => (p.handover ? UNCHANGED : { ...p, handover: taken }));
    // The mark stays, so every later call reads the same answer rather than "complete".
    const gone = async (what: string): Promise<Refusal> => {
        await putBack();
        return refuse(404, 'PURCHASE_ENDED', `The seller removed the ${what} this purchase made, so it cannot be handed over. `
            + `Contact the seller and give them the purchase id ${stored.id}.`);
    };

    let key: string | undefined;
    let keyId: string | undefined;
    let partyName: string | undefined;
    try {
        const party = stored.partyUid ? await findPartyByUid(storage, stored.providerGhii, stored.partyUid) : undefined;
        if (!party) return await gone('outside party');
        partyName = party.name;
        const share = stored.shareId ? (await partySharesOf(storage, stored.providerGhii, party, config.nodeId)).find(c => c.id === stored.shareId) : undefined;
        if (!share) return await gone('share');
        const o = await getOffering(storage, stored.offeringId);
        const ref = partyRefOf(stored.providerOwner, party.name, config.nodeId);
        const contract = o ? await readContractForCall(storage, ref, o.ext, o.action) : null;
        let holder = party;
        if (taken.keyPending) {
            const fresh = newPartyKey();
            const id = newPartyKeyId();
            const written = await changeParty(storage, stored.providerGhii, party.name, p => ({
                ...p, keys: [...p.keys, { id, hash: fresh.hash, createdAt: new Date().toISOString(), lastUsedAt: null }],
            }));
            if (!written) return await gone('outside party');
            holder = written; key = fresh.key; keyId = id;
        }
        const data = await deliveryAnswer(deps, stored, o?.title ?? stored.packageName, holder, share,
            { entitlementId: stored.entitlementId ?? contract?.entitlementId ?? '', pricing: contract?.pricing ?? null }, key);
        return { ok: true, data };
    } catch (err) {
        // Nothing was handed over: a key made for this answer goes again, and the next call tries anew.
        logger.error('exchange-party-buy: handing a completed purchase over failed', { purchase: stored.id, error: String(err) });
        if (keyId && partyName) {
            const made = keyId;
            try {
                await changeParty(storage, stored.providerGhii, partyName, p => ({ ...p, keys: p.keys.filter(k => k.id !== made) }));
            } catch (undoErr) {
                logger.error('exchange-party-buy: removing a key made for an answer that failed did not work', { purchase: stored.id, key: made, error: String(undoErr) });
            }
        }
        await putBack();
        return refuse(503, 'TRY_AGAIN', 'The purchase is paid and complete, and its answer could not be made just now. Send the same request again in a minute.');
    }
}

/** Whether an AIMEAT session id a card page carries is a party purchase's (the card page names it in its metadata). */
export const isPartyPurchaseId = (id: string): boolean => id.startsWith('pp_');

/**
 * Complete a party purchase from the seller's signed Stripe webhook (checkout.session.completed), for a
 * buyer who paid on the card page and did not come back. The same completion as the buyer's return,
 * with the Stripe session as the payment, so the payment is read back from Stripe and the delivery is
 * only a reason to look; whichever comes first completes it and the other finds it complete. Only a
 * card page the node opened for the purchase completes it, as for an account checkout. Answers in the
 * words completeFromStripeCheckout uses for an account checkout.
 */
export async function completePartyPurchaseFromStripe(
    deps: { storage: Storage; config: AimeatConfig }, sellerGhii: string, id: string, stripeSession: string,
): Promise<'checkout_completed' | 'checkout_already_closed' | 'checkout_not_found' | 'checkout_not_completed'> {
    const stored = await readPartyPurchase(deps.storage, deps.config.nodeId, id);
    if (!stored || stored.providerGhii !== sellerGhii || stored.handler !== STRIPE_CHECKOUT_HANDLER_ID || !stripeSession) return 'checkout_not_found';
    if (stored.status === 'completed') return 'checkout_already_closed';
    if (stored.cardPages && !stored.cardPages.includes(stripeSession)) {
        logger.warn('exchange-party-buy: a webhook named a Stripe session the node did not open for this purchase; not completed', { purchase: id, seller: sellerGhii, stripeSession });
        return 'checkout_not_found';
    }
    const r = await completePartyPurchase(deps, id, { handler: stored.handler, instrument: stripeSession }, { unattended: true });
    if (r.ok) return 'checkout_completed';
    if (r.code === 'ALREADY_COMPLETED' || r.code === 'PURCHASE_BUSY') return 'checkout_already_closed';
    logger.warn('exchange-party-buy: a paid card page did not complete its purchase from the webhook', { purchase: id, seller: sellerGhii, code: r.code });
    return 'checkout_not_completed';
}
