/**
 * @file src/services/package-sale-checkout.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A package sold through this node's ordinary checkout (docs/specs/package-sale-design.md,
 *   section 3): the `package` sellable kind, and the act that carries a paid (or granted) sale out on
 *   the package repository.
 *
 *   THE LINE. `{ kind: 'package', agent: <repository node id>, app: <group id>, offer_id: 'buy' |
 *   'renew:<node id>', input: { node?: { node_id, url, public_key }, auto_renew?: boolean } }`. Only
 *   kind, agent, offer_id and app survive the checkout's re-resolution; `input` rides on the line to
 *   fulfilment.
 *
 *   RESOLVE. The price is the selling node's own (package-sale-catalogue.ts): the catalogue's price for
 *   a purchase, the renewal price the buyer accepted for a renewal, nothing for an offer that grants on
 *   approval or at once. The author's terms are read from the repository by the signed seller request
 *   on every resolve, so a paused or ended offer, or a node that stopped being a seller, refuses before
 *   any money moves. The line's seller is the seller of record, and the money lands on that account's
 *   own payment account (commerce.psp), as for every sale on this node.
 *
 *   FULFIL (after the money is collected; a throw refunds it). A purchase with the buyer's node grants
 *   that node on the repository, with the end of updates the author's terms include and the terms id;
 *   without a node it asks for a claim code. An approval offer files a request for the seller of
 *   record instead. A renewal moves the date by the accepted period. The result names the seller of
 *   record, the supplier and the supplier's price: the seller's cost, not a share of the buyer's
 *   payment ("the platform records who sold, who supplied, and the amounts").
 * @structure packageSellableResolver() · carryOutSale() · parsePackageLine() · readOfferAsSeller() ·
 *   decideSaleRequest() · reviewSale()
 * @version-history
 *   v1.2.0 — 2026-10-05 — A sale naming a node another buyer on this node holds is refused with
 *     NODE_HELD, and the payment is refunded; the first sale to a node records its buyer (secaudit
 *     2026-10, PKG-2).
 *   v1.1.0 — 2026-10-02 — Review on a selling node: a new sale waits until the operator reviewed what
 *     the version on sale can do (reviewSale; NEEDS_REVIEW), and the buyer's view says `needs_review`.
 *     A renewal goes on. Package sale design, phase 5.
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 3).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import type { SellableResolver } from '../commerce/sellable-resolvers.js';
import type { Sellable } from '../commerce/types.js';
import { CommerceError } from '../commerce/errors.js';
import { listPaymentHandlers } from '../commerce/payment-handlers.js';
import { saleOffer, saleGrant, saleClaim } from './package-sale-client.js';
import {
    catalogueEntry, subscriptionFor, putSubscription, putRequest, readRequests, recordReview, nodeHolder, putNodeHolder,
    type CatalogueEntry, type Subscription, type SaleRequest,
} from './package-sale-catalogue.js';
import { notify } from './notify.js';

type Deps = { storage: Storage; config: AimeatConfig; peers: Map<string, PeerInfo> };

interface OfferTermsView {
    id: string; grant: 'payment' | 'approval' | 'automatic';
    price: { amount: number; currency: string } | null;
    updates: { included_days: number; renewal: { amount: number; currency: string; period_days: number } | null };
    channel: 'stable' | 'beta';
}
interface OfferView {
    group_id: string; author: string; state: 'on_sale' | 'paused' | 'ended'; terms: OfferTermsView | null; all_terms: OfferTermsView[];
    /** What the version on sale can do (package-offer.ts offerCapabilities), for the seller's review. */
    latest?: { version: string; items: string[]; hash: string } | null;
}

/** Whether the operator reviewed what the version on sale now can do. */
function reviewCurrent(entry: CatalogueEntry, offer: OfferView): boolean {
    return !!entry.reviewed && !!offer.latest && entry.reviewed.capabilities_hash === offer.latest.hash;
}

export interface PackageLineInput { node?: { node_id: string; url: string; public_key: string }; auto_renew?: boolean }

/** What a package line asks for, read from its offer_id. */
export function parsePackageLine(offerId: string | undefined): { act: 'buy' } | { act: 'renew'; nodeId: string } {
    if (offerId && offerId.startsWith('renew:') && offerId.length > 6) return { act: 'renew', nodeId: offerId.slice(6) };
    return { act: 'buy' };
}

/** The author's offer, as the repository answers this node as a seller. */
export async function readOfferAsSeller(deps: Deps, repository: string, groupId: string): Promise<OfferView> {
    const out = await saleOffer(deps, repository, groupId);
    if (!out.ok) throw new CommerceError(out.code, out.status, out.message);
    const body = out.body as { ok?: boolean; data?: OfferView; error?: { code?: string; message?: string } };
    if (out.status >= 300 || !body?.data) {
        throw new CommerceError(body?.error?.code ?? 'OFFER_UNAVAILABLE', out.status >= 400 ? out.status : 502, body?.error?.message ?? `${repository} did not answer the offer of ${groupId}.`);
    }
    return body.data;
}

const days = (n: number): number => n * 86_400_000;

/** The `package` sellable: a package of a repository this node sells, priced from its catalogue. */
export function packageSellableResolver(peers: Map<string, PeerInfo>): SellableResolver {
    return {
        kind: 'package',
        async resolve(storage, config, ref, buyerOwner): Promise<Sellable> {
            const deps: Deps = { storage, config, peers };
            const repository = ref.agent ?? '';
            const groupId = ref.app ?? '';
            if (!repository || !groupId) throw new CommerceError('INVALID_ITEM', 400, 'A package line names agent (the repository node id) and app (the package group id).');
            const line = parsePackageLine(ref.offer_id);
            const entry = await catalogueEntry(storage, repository, groupId);
            if (!entry || entry.state === 'ended' || (line.act === 'buy' && entry.state !== 'on_sale')) {
                throw new CommerceError('NOT_FOR_SALE', 404, `This node does not sell ${groupId} now.`);
            }
            const offer = await readOfferAsSeller(deps, repository, groupId);
            if (offer.state === 'ended' || (line.act === 'buy' && offer.state !== 'on_sale') || !offer.terms) {
                throw new CommerceError('NOT_FOR_SALE', 409, `The author of ${groupId} does not sell it now.`);
            }
            // The seller of record answers for what it sells: a new sale waits until the operator has
            // reviewed what the version on sale can do. A renewal goes on, as the buyer already has it.
            if (line.act === 'buy' && !reviewCurrent(entry, offer)) {
                throw new CommerceError('NEEDS_REVIEW', 409, `This node's operator has not reviewed what the version of ${groupId} on sale can do, so it is not sold now. Ask again later.`);
            }
            let unitPrice = 0;
            let currency = entry.price?.currency ?? entry.renewal?.currency ?? 'EUR';
            if (line.act === 'renew') {
                const sub = await subscriptionFor(storage, buyerOwner, repository, groupId, line.nodeId);
                if (!sub?.renewal) throw new CommerceError('NO_RENEWAL', 404, `There is no renewal of ${groupId} for ${line.nodeId} on your account here.`);
                unitPrice = sub.renewal.amount;
                currency = sub.renewal.currency;
            } else if (offer.terms.grant === 'payment') {
                if (!entry.price) throw new CommerceError('NOT_FOR_SALE', 409, `This node has not priced ${groupId}.`);
                unitPrice = entry.price.amount;
                currency = entry.price.currency;
            }
            const asked = ref.currency ?? 'morsel';
            if (asked !== currency) throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `${groupId} is sold in ${currency}; open the checkout with currency ${currency}.`);
            if (!listPaymentHandlers().some(h => h.currencies.includes(currency))) {
                throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `No payment handler on this node settles ${currency}.`);
            }
            const sellerGhii = `${entry.seller_of_record}@${config.nodeId}`;
            const psp = (await storage.getMemory(sellerGhii, 'commerce.psp'))?.value ?? undefined;
            return {
                kind: 'package', agentGaii: repository, agentName: groupId, offerId: ref.offer_id ?? 'buy',
                title: line.act === 'renew' ? `${entry.title ?? groupId}: updates renewed` : (entry.title ?? groupId),
                sellerOwner: entry.seller_of_record, sellerGhii, priceMorsels: unitPrice, psp,
                async fulfill(ctx, { session, item, payment }) {
                    const input = (item.input ?? {}) as PackageLineInput;
                    const result = await carryOutSale(deps, {
                        entry, offer, line, buyer: session.buyerOwner, order: session.id, input,
                        paid: { amount: session.total, currency: session.currency }, payment,
                    });
                    void ctx;
                    return { result };
                },
            };
        },
    };
}

/**
 * Carry a sale out on the repository: grant the node, ask for a claim code, file an approval request,
 * or move a renewal's date. Throws on a refusal there, which refunds a paid checkout.
 */
export async function carryOutSale(
    deps: Deps,
    args: {
        entry: CatalogueEntry; offer: OfferView; line: ReturnType<typeof parsePackageLine>; buyer: string; order: string;
        input: PackageLineInput; paid: { amount: number; currency: string }; approved?: boolean;
        /** The handler that collected, and the card it kept when the buyer turned automatic renewal on. */
        payment?: { handler: string; saved?: { customer?: string; payment_method?: string } };
    },
): Promise<Record<string, unknown>> {
    const { entry, offer, line, buyer, order, input } = args;
    const terms = offer.terms!;
    const record = {
        seller_of_record: { node_id: deps.config.nodeId, account: entry.seller_of_record },
        supplier: { repository: entry.repository, author: offer.author, group_id: entry.group_id, terms_id: terms.id },
        supplier_cost: line.act === 'renew' ? terms.updates.renewal : terms.price,
        paid: args.paid,
    };
    const fromRepository = (out: Awaited<ReturnType<typeof saleGrant>>, what: string): Record<string, unknown> => {
        if (!out.ok) throw new CommerceError(out.code, out.status, out.message);
        const body = out.body as { data?: Record<string, unknown>; error?: { code?: string; message?: string } };
        if (out.status >= 300 || !body?.data) throw new CommerceError(body?.error?.code ?? 'SALE_REFUSED', 502, body?.error?.message ?? `${entry.repository} refused the ${what}.`);
        return body.data;
    };

    if (line.act === 'renew') {
        const sub = await subscriptionFor(deps.storage, buyer, entry.repository, entry.group_id, line.nodeId);
        if (!sub?.renewal) throw new CommerceError('NO_RENEWAL', 404, 'There is no renewal to move.');
        const from = Math.max(Date.now(), sub.updates_until ? Date.parse(sub.updates_until) : Date.now());
        const until = new Date(from + days(sub.renewal.period_days)).toISOString();
        const data = fromRepository(await saleGrant(deps, entry.repository, entry.group_id, line.nodeId, { updates_until: until, note: `renewed, order ${order}` }), 'renewal');
        await putSubscription(deps.storage, { ...sub, updates_until: until, last_order: order, updatedAt: new Date().toISOString() });
        return { ...record, renewed: true, updates_until: until, entitlement: data.entitlement };
    }

    if (terms.grant === 'approval' && !args.approved) {
        const req = await putRequest(deps.storage, {
            buyer, repository: entry.repository, group_id: entry.group_id, order, state: 'waiting',
            ...(input.node ? { node: input.node } : {}),
        });
        return { ...record, request_id: req.id, status: 'awaiting_seller', next_step: 'The seller approves or refuses this request; you are told when it is decided.' };
    }

    const until = new Date(Date.now() + days(terms.updates.included_days)).toISOString();
    let granted: Record<string, unknown>;
    let nodeId: string | null = null;
    if (input.node?.node_id) {
        nodeId = input.node.node_id;
        // A node another buyer on this node holds is theirs: the repository cannot tell our buyers
        // apart, so this is the one place that can refuse (secaudit 2026-10, PKG-2). A throw here
        // refunds the payment.
        const holder = await nodeHolder(deps.storage, entry.repository, entry.group_id, nodeId);
        if (holder && holder !== buyer) {
            throw new CommerceError('NODE_HELD', 409, `${nodeId} already holds this package through another buyer. Buy for a node of your own, or without a node for a claim code.`);
        }
        const data = fromRepository(await saleGrant(deps, entry.repository, entry.group_id, nodeId, {
            node: { url: input.node.url, public_key: input.node.public_key },
            updates_until: until, channel: terms.channel, terms_id: terms.id, note: `order ${order}`,
        }), 'grant');
        granted = { entitlement: data.entitlement, peer_registered: data.peer_registered, peer_pending: data.peer_pending };
        if (!holder) await putNodeHolder(deps.storage, entry.repository, entry.group_id, nodeId, buyer);
    } else {
        const data = fromRepository(await saleClaim(deps, entry.repository, entry.group_id, {
            updates_until: until, channel: terms.channel, terms_id: terms.id, note: `order ${order}`,
        }), 'claim');
        granted = { claim_code: data.claim_code, claim_expires_at: data.expires_at, redeem_with: 'aimeat_package_claim on the node that is to receive the package' };
    }
    // The renewal the buyer accepts now: the seller's own renewal price, kept for every renewal after.
    // Automatic renewal holds only when the handler kept the card; otherwise the buyer renews by hand.
    let autoRenew: boolean | undefined;
    if (entry.renewal && nodeId) {
        const now = new Date().toISOString();
        const saved = args.payment?.saved;
        autoRenew = input.auto_renew === true && !!saved;
        const sub: Subscription = {
            repository: entry.repository, group_id: entry.group_id, node_id: nodeId, buyer,
            terms_id: terms.id, renewal: entry.renewal, updates_until: until, auto_renew: autoRenew,
            ...(saved && args.payment ? { payment: { handler: args.payment.handler, ...saved } } : {}),
            last_order: order, createdAt: now, updatedAt: now,
        };
        await putSubscription(deps.storage, sub);
    }
    return {
        ...record, updates_until: until, ...granted,
        ...(autoRenew !== undefined ? { auto_renew: autoRenew } : {}),
        ...(input.auto_renew === true && autoRenew === false ? { auto_renew_note: 'This payment method cannot be kept for later charges, so you renew by hand.' } : {}),
    };
}

/**
 * What a buyer signed in on this node would buy: this node's price and renewal, the author's terms
 * read for the buyer node to node, and the checkout line to open. The buyer never fetches the offer
 * from the repository themselves (Jouni, 2026-10-01). GET /v1/package-sales/offer and
 * aimeat_package_buy action offer.
 */
export async function buyerOfferView(
    deps: Deps, repository: string, groupId: string,
): Promise<{ ok: true; view: Record<string, unknown> } | { ok: false; status: number; code: string; message: string }> {
    const entry = await catalogueEntry(deps.storage, repository, groupId);
    if (!entry || entry.state === 'ended') return { ok: false, status: 404, code: 'NOT_FOR_SALE', message: `This node does not sell ${groupId}.` };
    try {
        const offer = await readOfferAsSeller(deps, repository, groupId);
        const t = offer.terms as (OfferTermsView & { licence?: unknown; tax?: unknown; support?: unknown }) | null;
        return {
            ok: true,
            view: {
                repository, group_id: groupId, title: entry.title ?? groupId,
                state: entry.state === 'on_sale' && offer.state === 'on_sale' ? (reviewCurrent(entry, offer) ? 'on_sale' : 'needs_review') : 'paused',
                grant: t?.grant ?? null, price: t?.grant === 'payment' ? entry.price : null, renewal: entry.renewal,
                updates_included_days: t?.updates.included_days ?? null, channel: t?.channel ?? null,
                licence: t?.licence ?? null, tax: t?.tax ?? null, support: t?.support ?? null, author: offer.author,
                seller_of_record: { node_id: deps.config.nodeId, account: entry.seller_of_record },
                buy: { kind: 'package', agent: repository, app: groupId, offer_id: 'buy', currency: entry.price?.currency ?? entry.renewal?.currency ?? 'EUR' },
            },
        };
    } catch (err) {
        const e = err as { code?: string; status?: number; message?: string };
        return { ok: false, status: e.status ?? 502, code: e.code ?? 'OFFER_UNAVAILABLE', message: e.message ?? String(err) };
    }
}

/**
 * The seller of record decides a sale the author's offer grants on approval: approving carries it out
 * as a paid order is carried out (a grant, or a claim code); refusing ends it. The buyer is told.
 */
export async function decideSaleRequest(
    deps: Deps, id: string, decision: unknown,
): Promise<{ ok: true; request: SaleRequest } | { ok: false; status: number; code: string; message: string }> {
    if (decision !== 'approve' && decision !== 'refuse') return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'decision is "approve" or "refuse".' };
    const req = (await readRequests(deps.storage)).find(r => r.id === id);
    if (!req) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No such request waits here.' };
    if (req.state !== 'waiting') return { ok: false, status: 409, code: 'ALREADY_DECIDED', message: `This request was ${req.state} already.` };
    const buyerGhii = `${req.buyer}@${deps.config.nodeId}`;
    if (decision === 'refuse') {
        const done = await putRequest(deps.storage, { ...req, state: 'refused' });
        await notify(deps.storage, buyerGhii, {
            type: 'package_sale_request_decided', title: `Your request for ${req.group_id} was not approved`,
            body: 'The seller did not approve this request. Nothing was installed or charged.',
            link: '/v1/profile?tab=packages', i18n: { key: 'package_sale_request_refused', vars: { name: req.group_id } },
        });
        return { ok: true, request: done };
    }
    const entry = await catalogueEntry(deps.storage, req.repository, req.group_id);
    if (!entry) return { ok: false, status: 409, code: 'NOT_FOR_SALE', message: 'This node does not sell the package any more.' };
    let outcome: Record<string, unknown>;
    try {
        const offer = await readOfferAsSeller(deps, req.repository, req.group_id);
        outcome = await carryOutSale(deps, {
            entry, offer, line: { act: 'buy' }, buyer: req.buyer, order: req.order,
            input: req.node ? { node: req.node } : {}, paid: { amount: 0, currency: entry.price?.currency ?? 'EUR' }, approved: true,
        });
    } catch (err) {
        const e = err as { code?: string; status?: number; message?: string };
        return { ok: false, status: e.status ?? 502, code: e.code ?? 'SALE_REFUSED', message: e.message ?? String(err) };
    }
    const done = await putRequest(deps.storage, { ...req, state: 'approved', outcome });
    await notify(deps.storage, buyerGhii, {
        type: 'package_sale_request_decided', title: `Your request for ${req.group_id} was approved`,
        body: outcome.claim_code ? 'The seller approved it. Your claim code is in the request: redeem it on the node that is to receive the package.' : 'The seller approved it, and your node can now take the package.',
        link: '/v1/profile?tab=packages', i18n: { key: 'package_sale_request_approved', vars: { name: req.group_id } },
    });
    return { ok: true, request: done };
}

/**
 * The operator reviews what the version on sale can do, read from the repository with this node's
 * key, and records it: new sales open while the repository's capability hash stays the reviewed one.
 * The answer carries the capabilities, so the operator's AI can say what was approved.
 */
export async function reviewSale(
    deps: Deps, reviewer: string, repository: string, groupId: string,
): Promise<{ ok: true; entry: CatalogueEntry; latest: NonNullable<OfferView['latest']> } | { ok: false; status: number; code: string; message: string }> {
    let offer: OfferView;
    try {
        offer = await readOfferAsSeller(deps, repository, groupId);
    } catch (err) {
        const e = err as { code?: string; status?: number; message?: string };
        return { ok: false, status: e.status ?? 502, code: e.code ?? 'OFFER_UNAVAILABLE', message: e.message ?? String(err) };
    }
    if (!offer.latest) return { ok: false, status: 409, code: 'NOTHING_PUBLISHED', message: `${groupId} has no published version to review.` };
    const out = await recordReview(deps.storage, repository, groupId, {
        version: offer.latest.version, capabilities_hash: offer.latest.hash, at: new Date().toISOString(), by: reviewer,
    });
    return out.ok ? { ok: true, entry: out.entry, latest: offer.latest } : out;
}
