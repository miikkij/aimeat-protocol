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
 *   side is booked with bookSessionlessSale, as every sale without an account is.
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
 *   so a later call finds it without an index. A month keeps at most 2000 purchases.
 * @structure PartyPurchase · PURCHASE_TTL_MS · openPartyPurchase · completePartyPurchase · readPartyPurchase
 * @usage
 *   const opened = await openPartyPurchase(deps, offeringId, body, renewalCtx);
 *   const done = await completePartyPurchase(deps, purchaseId, { handler: 'test.money', instrument: 'x' });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D5.4).
 */
import { randomBytes } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { CheckoutSessionRecord } from '../commerce/types.js';
import { getOffering, type Offering } from './exchange-market.js';
import { createEntitlement, readContractForCall, type PricingSpec, type DatapackageSurface } from './metered-entitlements.js';
import { PER_MONTH_SECONDS } from './exchange-datapackage.js';
import { updateRecord, UNCHANGED } from './record-cas.js';
import { getPaymentHandler } from '../commerce/payment-handlers.js';
import { percentFee } from '../commerce/money.js';
import { commerceFeePercent } from './marketplace-fee.js';
import { bookSessionlessSale } from '../commerce/session-service.js';
import { openStripeCheckout, STRIPE_CHECKOUT_HANDLER_ID } from '../commerce/stripe-checkout.js';
import { TEST_MONEY_HANDLER_ID } from '../commerce/test-money-handler.js';
import { readPsp } from '../commerce/psp-record.js';
import { isValidEmail } from '../utils/email-validator.js';
import { grantConsent } from './consent-write.js';
import { PARTY_NAME_RE, partyRefOf, partyView, type PartyKind, type PartyRecord } from './parties/contract.js';
import { newPartyKey, newPartyKeyId, newPartyUid } from './parties/keys.js';
import { insertParty, findPartyByUid } from './parties/store.js';
import { connectionFileOf, isLiveShare, partySharesOf, setShareMeta, sharePatternOf, shareMetaOf, shareView } from './parties/shares.js';
import type { PartyContext } from './parties/verify.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

/** How long an open purchase waits for its payment. */
export const PURCHASE_TTL_MS = 60 * 60 * 1000;
const MAX_PER_MONTH = 2000;
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
}

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
        if (cur.purchases.length >= MAX_PER_MONTH) { full = true; return UNCHANGED; }
        return { purchases: [...cur.purchases, purchase] };
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
        const page = await openStripeCheckout(config, asSession, (await readPsp(storage, o.providerGhii)), returnUrl);
        pay = { ...pay, card_page_url: page.url, note: 'Pay on the card page; you come back with stripe_session, which you POST to complete_url as the instrument.' };
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

/**
 * Collect the payment of an open purchase and deliver it: the party (new, with its key), the prepaid
 * contract and the named share bound to it, and the connection file. A completed purchase answers 409
 * ALREADY_COMPLETED; its key was in the first answer only.
 */
export async function completePartyPurchase(
    deps: { storage: Storage; config: AimeatConfig }, id: string, input: { handler?: unknown; instrument?: unknown },
): Promise<{ ok: true; data: Record<string, unknown> } | Refusal> {
    const { storage, config } = deps;
    const stored = await readPartyPurchase(storage, config.nodeId, id);
    if (!stored) return refuse(404, 'NOT_FOUND', 'No such purchase.');
    if (stored.status === 'completed') return refuse(409, 'ALREADY_COMPLETED', 'This purchase is complete. Its key was in the answer that completed it.');
    if (Date.parse(stored.expiresAt) <= Date.now() && stored.status === 'open') return refuse(410, 'PURCHASE_EXPIRED', 'This purchase waited too long for its payment. Start a new one.');
    if (typeof input.handler === 'string' && input.handler !== stored.handler) return refuse(422, 'HANDLER_MISMATCH', `This purchase is paid with ${stored.handler}.`);
    const handler = getPaymentHandler(stored.handler);
    if (!handler) return refuse(422, 'UNKNOWN_PAYMENT_HANDLER', `This node has no handler ${stored.handler} any more.`);
    const found = await buyable(storage, stored.offeringId);
    if (!found.ok) return found;
    const { o, surface } = found;

    // Claim it: one completion charges a purchase, and a second one waits for the first to finish.
    const claimed = await changePurchase(storage, config.nodeId, id, p => (p.status === 'open' ? { ...p, status: 'completing' } : UNCHANGED));
    if (!claimed || claimed.status !== 'completing') return refuse(409, 'PURCHASE_BUSY', 'This purchase is being completed by another request.');
    const reopen = () => changePurchase(storage, config.nodeId, id, p => (p.status === 'completing' ? { ...p, status: 'open' } : UNCHANGED));

    const partyName = stored.party.name;
    const ref = partyRefOf(stored.providerOwner, partyName, config.nodeId);
    const fee = percentFee(stored.amount, commerceFeePercent(config));
    let trackingCode: string;
    try {
        const collected = await handler.collect({ config, storage }, {
            buyerGhii: ref, amount: stored.amount, currency: stored.currency, reference: id, fee, instrument: input.instrument,
            seller: { ghii: stored.providerGhii, owner: stored.providerOwner, psp: await readPsp(storage, stored.providerGhii) },
        });
        trackingCode = collected.trackingCode;
    } catch (err) {
        await reopen();
        const e = err as { code?: string; statusCode?: number; message?: string };
        return refuse(e.statusCode ?? 402, e.code ?? 'PAYMENT_FAILED', e.message ?? 'The payment did not go through.');
    }

    try {
        // The party: the renewing one, or a new one made now, with its first key.
        let party: PartyRecord | undefined = stored.renewalOf ? await findPartyByUid(storage, stored.providerGhii, stored.renewalOf) : undefined;
        let key: string | undefined;
        if (stored.renewalOf && !party) throw Object.assign(new Error('The party this purchase renews no longer exists.'), { code: 'PARTY_NOT_FOUND', statusCode: 404 });
        if (!party) {
            const fresh = newPartyKey();
            const at = new Date().toISOString();
            party = {
                uid: newPartyUid(), name: partyName, displayName: stored.party.displayName, kind: stored.party.kind,
                ...(stored.party.contact ? { contact: stored.party.contact } : {}),
                status: 'active', createdAt: at, createdBy: `exchange:${o.offeringId}`,
                keys: [{ id: newPartyKeyId(), hash: fresh.hash, createdAt: at, lastUsedAt: null }], failedAttempts: 0, lastSeenAt: null,
            };
            const outcome = await insertParty(storage, stored.providerGhii, party);
            if (outcome !== 'ok') throw Object.assign(new Error(outcome === 'full' ? 'The provider holds the most outside parties one account may.' : 'A party of that name exists.'), { code: outcome === 'full' ? 'QUOTA_EXCEEDED' : 'PARTY_EXISTS', statusCode: 409 });
            key = fresh.key;
        }

        // The prepaid contract, keyed on the party's identity like any consumer's.
        const before = await readContractForCall(storage, ref, o.ext, o.action);
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
        }
        const written = await setShareMeta(storage, share, {
            contract: { offeringId: o.offeringId, entitlementId: ent.entitlementId, ifaceVersion: surface.ifaceVersion },
            termsAcceptedAt: shareMetaOf(share).termsAcceptedAt ?? new Date().toISOString(),
        });
        share = written ?? share;

        await bookSessionlessSale(storage, config, {
            gross: stored.amount, currency: stored.currency, sellerGhii: stored.providerGhii, buyerRef: ref,
            ext: o.ext, action: o.action, trackingCode, handler: handler.id, reference: id,
        });
        await changePurchase(storage, config.nodeId, id, p => ({
            ...p, status: 'completed', completedAt: new Date().toISOString(), trackingCode,
            partyUid: party!.uid, entitlementId: ent.entitlementId, shareId: share!.id,
        }));
        emitChange('consent', stored.providerGhii);
        const until = pricing.model === 'subscription' ? `until ${pricing.validUntil.slice(0, 10)}` : `for ${pricing.model === 'bundle' ? pricing.callsRemaining : stored.quantity} reads`;
        return {
            ok: true, data: {
                purchase: purchaseView({ ...stored, status: 'completed' }),
                party: partyView(party, ref),
                share: shareView(share),
                contract: { entitlement_id: ent.entitlementId, model: stored.model, pricing },
                connection: await connectionFileOf(deps, stored.providerGhii, party, share, key),
                ...(key ? { key_note: 'The key is in the connection file and is shown once. Keep it: buying again with it tops up the same contract.' } : {}),
                say: `${party.displayName} can read "${o.title}" ${until}. Copies taken stay with the buyer; new reads stop when the purchase is used up.`,
            },
        };
    } catch (err) {
        // The money moved and the delivery did not: give it back and reopen the purchase.
        try { await handler.refund({ config, storage }, { buyerGhii: ref, amount: stored.amount, trackingCode, seller: { ghii: stored.providerGhii, owner: stored.providerOwner } }); }
        catch (refundErr) { logger.error('exchange-party-buy: a refund after a failed delivery failed', { purchase: id, error: String(refundErr) }); }
        await reopen();
        const e = err as { code?: string; statusCode?: number; message?: string };
        return refuse(e.statusCode ?? 500, e.code ?? 'DELIVERY_FAILED', `${e.message ?? 'The purchase could not be delivered'}; the payment was refunded.`);
    }
}
